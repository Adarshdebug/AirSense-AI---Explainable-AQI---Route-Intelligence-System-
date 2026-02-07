# ============================================================
# AQI-Based Smart Routing Logic
# (Converted cleanly from Notebook → Python module)
# ============================================================

import osmnx as ox
import networkx as nx
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import joblib

# ============================================================
# 1) Load Trained ML Model + Dataset
# ============================================================

model = joblib.load("aqi_rf_delhi_ncr.pkl")
feature_order = joblib.load("feature_orderv6.pkl")

df = pd.read_csv("delhi_ncr_area_wise_aqi_engineered.csv")
area_feature_table = df.groupby("Area").mean(numeric_only=True)

# ============================================================
# 2) Predict Next-Day AQI (ML)
# ============================================================

aqi_cache = {}

def predict_next_day_aqi(area):
    if area in aqi_cache:
        return aqi_cache[area]

    if area not in area_feature_table.index:
        return 150.0  # safe fallback AQI

    features = area_feature_table.loc[area].to_dict()
    tomorrow = datetime.now() + timedelta(days=1)
    features["Month"] = tomorrow.month

    X = pd.DataFrame([features]).reindex(columns=feature_order, fill_value=0)
    pred = float(model.predict(X)[0])

    aqi_cache[area] = pred
    return pred

# ============================================================
# 3) Load Delhi Road Network (OSMnx)
# ============================================================

ox.settings.use_cache = True
ox.settings.log_console = False

# NOTE: Using Delhi only (stable boundary)
G = ox.graph_from_place("Delhi, India", network_type="drive", simplify=True)

# ============================================================
# 4) Area Coordinates (No Geocoding)
# ============================================================

AREA_COORDS = {
    "Rohini": (28.7499, 77.0565),
    "Pitampura": (28.7033, 77.1310),
    "Karol Bagh": (28.6517, 77.1906),
    "Connaught Place": (28.6315, 77.2167),
    "Janakpuri": (28.6219, 77.0878),
    "Saket": (28.5244, 77.2066),
    "Lajpat Nagar": (28.5677, 77.2433),
    "Faridabad": (28.4089, 77.3178),
}

# ============================================================
# 5) Nearest Road Node per Area
# ============================================================

def nearest_node(area):
    if area not in AREA_COORDS:
        raise ValueError(f"Unknown area: {area}")

    lat, lon = AREA_COORDS[area]
    return ox.distance.nearest_nodes(G, lon, lat)

# ============================================================
# 6) AQI-Weighted Edge Cost
# ============================================================

def aqi_weight(u, v, data):
    length = data.get("length", 1.0)

    if not aqi_cache:
        avg_aqi = np.mean([predict_next_day_aqi(a) for a in AREA_COORDS])
    else:
        avg_aqi = np.mean(list(aqi_cache.values()))

    return length * (avg_aqi / 100.0)

# ============================================================
# 7) Routing Functions
# ============================================================

def fastest_route(start_area, end_area):
    s = nearest_node(start_area)
    e = nearest_node(end_area)
    return nx.shortest_path(G, s, e, weight="length")

def safest_route(start_area, end_area):
    s = nearest_node(start_area)
    e = nearest_node(end_area)
    return nx.shortest_path(G, s, e, weight=aqi_weight)

# ============================================================
# 8) Route Distance (km)
# ============================================================

def route_distance_km(path):
    distance = 0.0

    for u, v in zip(path[:-1], path[1:]):
        edge_data = G.get_edge_data(u, v)
        if isinstance(edge_data, dict):
            edge_data = list(edge_data.values())[0]

        distance += edge_data.get("length", 0.0)

    return round(distance / 1000, 2)

# ============================================================
# 9) ✅ WRAPPER FOR STREAMLIT / WEBSITE (IMPORTANT)
# ============================================================

def find_best_route(start_area, end_area):
    """
    Public API for UI / Streamlit
    Uses SAME notebook logic (safest route)
    """
    route = safest_route(start_area, end_area)
    distance_km = route_distance_km(route)
    return route, distance_km

# ============================================================
# 10) Demo Run (ONLY when executed directly)
# ============================================================

if __name__ == "__main__":
    start, end = "Rohini", "Faridabad"

    fast = fastest_route(start, end)
    safe = safest_route(start, end)

    print("FASTEST route distance (km):", route_distance_km(fast))
    print("SAFEST  route distance (km):", route_distance_km(safe))

    print("\nPredicted AQI values used:")
    for a in ["Rohini", "Janakpuri", "Saket", "Lajpat Nagar", "Faridabad"]:
        if a in area_feature_table.index:
            print(a, "→", round(predict_next_day_aqi(a), 2))
