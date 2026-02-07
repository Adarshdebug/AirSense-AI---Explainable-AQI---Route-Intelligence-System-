import streamlit as st
from streamlit_folium import st_folium
import folium
import osmnx as ox
import networkx as nx
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import joblib


st.set_page_config(page_title="Safest Route AI", layout="wide")
st.title("🫁 Safest Route AI")
st.caption("ML-based AQI prediction + safest route (OSMnx + Folium)")


if "route_result" not in st.session_state:
    st.session_state.route_result = None


@st.cache_resource
def load_ml():
    model = joblib.load("aqi_rf_delhi_ncr.pkl")
    feature_order = joblib.load("feature_orderv6.pkl")
    df = pd.read_csv("delhi_ncr_area_wise_aqi_engineered.csv")
    area_feature_table = df.groupby("Area").mean(numeric_only=True)
    return model, feature_order, area_feature_table

model, feature_order, area_feature_table = load_ml()


AREA_COORDS = {
    "Rohini": (28.7499, 77.0565),
    "Pitampura": (28.7033, 77.1310),
    "Karol Bagh": (28.6517, 77.1906),
    "Connaught Place": (28.6315, 77.2167),
    "Janakpuri": (28.6219, 77.0878),
    "Saket": (28.5244, 77.2066),
    "Lajpat Nagar": (28.5677, 77.2433),
    "Ashok Vihar": (28.6923, 77.1717),
    "Faridabad": (28.4089, 77.3178),
}

AREAS = sorted(AREA_COORDS.keys())


aqi_cache = {}

def predict_next_day_aqi(area):
    if area in aqi_cache:
        return aqi_cache[area]

    if area not in area_feature_table.index:
        return 150.0

    features = area_feature_table.loc[area].to_dict()
    features["Month"] = (datetime.now() + timedelta(days=1)).month

    X = pd.DataFrame([features]).reindex(columns=feature_order, fill_value=0)
    pred = float(model.predict(X)[0])
    aqi_cache[area] = pred
    return pred


@st.cache_resource
def load_graph():
    ox.settings.use_cache = True
    ox.settings.log_console = False
    return ox.graph_from_place("Delhi, India", network_type="drive", simplify=True)

G = load_graph()


def nearest_node(area):
    lat, lon = AREA_COORDS[area]
    return ox.distance.nearest_nodes(G, lon, lat)

def aqi_weight(u, v, data):
    length = data.get("length", 1.0)
    avg_aqi = np.mean([predict_next_day_aqi(a) for a in AREA_COORDS])
    return length * (avg_aqi / 100)

def fastest_route(start, end):
    return nx.shortest_path(G, nearest_node(start), nearest_node(end), weight="length")

def safest_route(start, end):
    return nx.shortest_path(G, nearest_node(start), nearest_node(end), weight=aqi_weight)

def route_distance_km(path):
    dist = 0
    for u, v in zip(path[:-1], path[1:]):
        data = list(G.get_edge_data(u, v).values())[0]
        dist += data.get("length", 0)
    return round(dist / 1000, 2)

def path_to_latlon(path):
    return [[G.nodes[n]["y"], G.nodes[n]["x"]] for n in path]


def health_advice(aqi):
    if aqi <= 50:
        return "Good 😊"
    elif aqi <= 100:
        return "Moderate 🙂"
    elif aqi <= 200:
        return "Poor 😷 – avoid long exposure"
    else:
        return "Very Poor ☠️ – avoid travel"


def render_folium_map(fast_path, safe_path, start_area, end_area):
    fast_coords = path_to_latlon(fast_path)
    safe_coords = path_to_latlon(safe_path)

    s_lat, s_lon = AREA_COORDS[start_area]

    m = folium.Map(
        location=[s_lat, s_lon],
        zoom_start=11,
        tiles="OpenStreetMap"
    )

    folium.PolyLine(
        fast_coords,
        color="red",
        weight=5,
        tooltip="Fastest Route"
    ).add_to(m)

    folium.PolyLine(
        safe_coords,
        color="green",
        weight=5,
        tooltip="Safest Route"
    ).add_to(m)

    folium.Marker(
        fast_coords[0],
        popup=f"Start: {start_area}",
        icon=folium.Icon(color="blue")
    ).add_to(m)

    folium.Marker(
        fast_coords[-1],
        popup=f"End: {end_area}",
        icon=folium.Icon(color="red")
    ).add_to(m)

    st_folium(m, width=700, height=520)


st.sidebar.header("📍 Route Selection")
start_area = st.sidebar.selectbox("Start Location", AREAS)
end_area = st.sidebar.selectbox("Destination", AREAS)


if st.sidebar.button("🧭 Find Safest Route"):
    fast = fastest_route(start_area, end_area)
    safe = safest_route(start_area, end_area)

    avg_aqi = np.mean([
        predict_next_day_aqi(start_area),
        predict_next_day_aqi(end_area)
    ])

    st.session_state.route_result = {
        "fast_path": fast,
        "safe_path": safe,
        "fast_dist": route_distance_km(fast),
        "safe_dist": route_distance_km(safe),
        "aqi": round(avg_aqi, 2),
        "health": health_advice(avg_aqi),
    }


if st.session_state.route_result:
    r = st.session_state.route_result

    col1, col2 = st.columns([1, 1])

    with col1:
        st.subheader("🚗 Fastest Route")
        st.write("Distance:", r["fast_dist"], "km")

        st.subheader("🌿 Safest Route (Recommended)")
        st.write("Distance:", r["safe_dist"], "km")

        st.subheader("🌫 AQI & Health Advisory")
        st.write("Predicted AQI:", r["aqi"])
        st.write("Health:", r["health"])

    with col2:
        st.subheader("🗺 Live Route Map")
        render_folium_map(
            r["fast_path"],
            r["safe_path"],
            start_area,
            end_area
        )
