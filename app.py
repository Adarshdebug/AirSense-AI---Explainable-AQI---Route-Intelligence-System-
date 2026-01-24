from dotenv import load_dotenv
load_dotenv()

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
import joblib
import requests
import os
from datetime import datetime

# ---------------- API KEYS ----------------
OPENWEATHER_KEY = os.getenv("OPENWEATHER_API_KEY")
ORS_KEY = os.getenv("ORS_API_KEY")

if not OPENWEATHER_KEY:
    raise RuntimeError("OPENWEATHER_API_KEY not set")

if not ORS_KEY:
    raise RuntimeError("ORS_API_KEY not set")

# ---------------- APP ----------------
app = Flask(__name__)
CORS(app)

# ---------------- LOAD ML ASSETS ----------------
model = joblib.load("aqi_elastic_model.pkl")
scaler = joblib.load("aqi_scaler.pkl")
le = joblib.load("city_encoder.pkl")
feature_order = joblib.load("feature_order.pkl")

# ---------------- CPCB AQI FORMULA ----------------
AQI_BREAKPOINTS = {
    "PM2.5": [(0,30,0,50),(31,60,51,100),(61,90,101,200),(91,120,201,300),(121,250,301,400),(251,500,401,500)],
    "NO2": [(0,40,0,50),(41,80,51,100),(81,180,101,200),(181,280,201,300),(281,400,301,400),(401,1000,401,500)],
    "SO2": [(0,40,0,50),(41,80,51,100),(81,380,101,200),(381,800,201,300),(801,1600,301,400),(1601,3000,401,500)],
    "O3": [(0,50,0,50),(51,100,51,100),(101,168,101,200),(169,208,201,300),(209,748,301,400),(749,1000,401,500)]
}

def sub_index(cp, pollutant):
    for bp_lo, bp_hi, i_lo, i_hi in AQI_BREAKPOINTS[pollutant]:
        if bp_lo <= cp <= bp_hi:
            return ((i_hi - i_lo) / (bp_hi - bp_lo)) * (cp - bp_lo) + i_lo
    return 0

def calculate_aqi(pollutants):
    return int(max(sub_index(v, p) for p, v in pollutants.items()))

# ---------------- ML REASON ----------------
def ml_reason(model, input_df):
    input_df = input_df[feature_order]
    impact = np.abs(model.coef_ * input_df.values[0])

    df = pd.DataFrame({
        "feature": feature_order,
        "impact": impact
    })
    df["percent"] = (df["impact"] / df["impact"].sum()) * 100
    return df.sort_values("percent", ascending=False).head(3)

# ---------------- PAGES ----------------
@app.route("/")
def home():
    return render_template("index.html")

@app.route("/route")
def route_page():
    return render_template("route.html")

# ---------------- AQI PREDICTION ----------------
@app.route("/predict", methods=["POST"])
def predict():
    try:
        city = request.json.get("city")

        if city not in le.classes_:
            return jsonify({"error": "City not supported"}), 400

        geo = requests.get(
            "https://api.openweathermap.org/geo/1.0/direct",
            params={"q": city, "limit": 1, "appid": OPENWEATHER_KEY}
        ).json()

        if not geo:
            return jsonify({"error": "City not found"}), 404

        lat, lon = geo[0]["lat"], geo[0]["lon"]

        pollution = requests.get(
            "http://api.openweathermap.org/data/2.5/air_pollution",
            params={"lat": lat, "lon": lon, "appid": OPENWEATHER_KEY}
        ).json()

        comp = pollution["list"][0]["components"]

        pm25, no, no2, so2, o3 = (
            comp["pm2_5"], comp["no"], comp["no2"], comp["so2"], comp["o3"]
        )
        co = comp["co"] / 1000

        formula_aqi = calculate_aqi({
            "PM2.5": pm25,
            "NO2": no2,
            "SO2": so2,
            "O3": o3
        })

        now = datetime.now()
        city_encoded = le.transform([city])[0]

        input_df = pd.DataFrame([{
            "City": city_encoded,
            "PM2.5": pm25,
            "NO": no,
            "NO2": no2,
            "CO": co,
            "SO2": so2,
            "O3": o3,
            "day": now.day,
            "month": now.month,
            "year": now.year
        }])

        ml_pred = model.predict(
            scaler.transform(input_df[feature_order])
        )[0]

        reasons = [
            {"pollutant": r["feature"], "impact_percent": round(r["percent"], 2)}
            for _, r in ml_reason(model, input_df).iterrows()
        ]

        return jsonify({
            "city": city,
            "official_aqi_formula": formula_aqi,
            "aqi_category": (
                "Good 🟢" if formula_aqi <= 50 else
                "Satisfactory 🟡" if formula_aqi <= 100 else
                "Moderate 🟠" if formula_aqi <= 200 else
                "Poor 🔴" if formula_aqi <= 300 else
                "Very Poor / Severe ⚫"
            ),
            "ml_estimate": int(ml_pred),
            "reasons": reasons
        })

    except Exception as e:
        print("AQI ERROR:", e)
        return jsonify({"error": "Server error"}), 500

# ---------------- ROUTE EXPOSURE (ORS – FIXED) ----------------
@app.route("/route-exposure", methods=["POST"])
def route_exposure():
    try:
        data = request.json
        start = data.get("start")
        destination = data.get("destination")
        mode = data.get("mode", "walking")

        if not start or not destination:
            return jsonify({"error": "Start and destination required"}), 400

        # -------- Nominatim (User-Agent REQUIRED) --------
        def geocode(place):
            res = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": place, "format": "json", "limit": 1},
                headers={"User-Agent": "AirSenseAI/1.0"}
            ).json()
            if not res:
                return None
            return [float(res[0]["lon"]), float(res[0]["lat"])]

        start_coord = geocode(start)
        end_coord = geocode(destination)

        if not start_coord or not end_coord:
            return jsonify({"error": "Unable to geocode locations"}), 400

        profile = "foot-walking" if mode == "walking" else "driving-car"

        ors_res = requests.post(
            f"https://api.openrouteservice.org/v2/directions/{profile}",
            headers={
                "Authorization": ORS_KEY,
                "Content-Type": "application/json"
            },
            json={"coordinates": [start_coord, end_coord]}
        ).json()

        if "features" not in ors_res:
            print("ORS ERROR:", ors_res)
            return jsonify({"error": "Route data unavailable"}), 500

        evaluated_routes = []

        for r in ors_res["features"]:
            summary = r["properties"]["summary"]
            coords = r["geometry"]["coordinates"]

            sample_points = [
                coords[0],
                coords[len(coords)//2],
                coords[-1]
            ]

            aqi_vals = []
            for lon, lat in sample_points:
                aqi = requests.get(
                    "http://api.openweathermap.org/data/2.5/air_pollution",
                    params={"lat": lat, "lon": lon, "appid": OPENWEATHER_KEY}
                ).json()["list"][0]["main"]["aqi"] * 50
                aqi_vals.append(aqi)

            avg_aqi = sum(aqi_vals) / len(aqi_vals)
            time_min = summary["duration"] / 60
            exposure = avg_aqi * time_min

            evaluated_routes.append({
                "distance_km": round(summary["distance"] / 1000, 2),
                "time_min": round(time_min, 1),
                "avg_aqi": round(avg_aqi, 1),
                "exposure_score": round(exposure, 1)
            })

        best_route = min(evaluated_routes, key=lambda x: x["exposure_score"])

        return jsonify({
            "recommended_mode": "Transport" if best_route["avg_aqi"] > 150 else "Walking",
            "best_route": best_route,
            "all_routes": evaluated_routes
        })

    except Exception as e:
        print("ROUTE ERROR:", e)
        return jsonify({"error": "Server error"}), 500

# ---------------- RUN ----------------
if __name__ == "__main__":
    app.run(debug=True)
