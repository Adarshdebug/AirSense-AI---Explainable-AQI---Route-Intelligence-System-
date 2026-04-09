from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from services.route_engine import engine


FRONTEND_DIST = Path(__file__).resolve().parent / "frontend" / "dist"

app = Flask(__name__, static_folder=str(FRONTEND_DIST), static_url_path="/")
CORS(app, resources={r"/*": {"origins": "*"}})


@app.get("/api/health")
def health_check():
    return jsonify({"status": "ok"})


@app.get("/api/areas")
def get_areas():
    return jsonify(
        {
            "areas": [
                {
                    "name": area,
                    "lat": coords[0],
                    "lon": coords[1],
                    "aqi": round(engine.predict_next_day_aqi(area), 2),
                }
                for area, coords in engine.area_coords.items()
            ]
        }
    )


@app.get("/api/aqi-overlay")
def get_aqi_overlay():
    return jsonify({"points": engine.get_area_aqi_snapshot()})


@app.post("/get_safe_route")
def get_safe_route():
    payload = request.get_json(silent=True) or {}
    start = payload.get("start")
    destination = payload.get("destination")

    if not start or not destination:
        return jsonify({"error": "Both 'start' and 'destination' are required."}), 400

    try:
        return jsonify(engine.build_route_bundle(start, destination))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def serve_frontend(path: str):
    if FRONTEND_DIST.exists():
        requested = FRONTEND_DIST / path
        if path and requested.exists():
            return send_from_directory(FRONTEND_DIST, path)
        return send_from_directory(FRONTEND_DIST, "index.html")

    return jsonify(
        {
            "message": "Frontend build not found. Run the Vite app in /frontend for development or build it for production."
        }
    )


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
