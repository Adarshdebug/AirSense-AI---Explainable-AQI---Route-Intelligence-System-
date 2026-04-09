from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple

import joblib
import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd


BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE_DIR / "aqi_rf_delhi_ncr.pkl"
FEATURE_ORDER_PATH = BASE_DIR / "feature_orderv6.pkl"
DATASET_PATH = BASE_DIR / "delhi_ncr_area_wise_aqi_engineered.csv"
AREA_COORDS_PATH = BASE_DIR / "area_coords_delhi_ncr.json"


AQI_THRESHOLDS = [
    (50, "Low", "#22c55e"),
    (100, "Moderate", "#facc15"),
    (200, "High", "#f97316"),
    (300, "Very High", "#ef4444"),
    (float("inf"), "Severe", "#7e22ce"),
]


class RouteEngine:
    def __init__(self) -> None:
        self.area_coords = self._load_area_coords()
        self.areas = sorted(self.area_coords.keys())
        self.model = joblib.load(MODEL_PATH)
        self.feature_order = joblib.load(FEATURE_ORDER_PATH)
        self.dataset = pd.read_csv(DATASET_PATH)
        self.area_feature_table = self.dataset.groupby("Area").mean(numeric_only=True)
        self.aqi_cache: Dict[str, float] = {}
        ox.settings.use_cache = True
        ox.settings.log_console = False
        self.graph = ox.graph_from_place("Delhi, India", network_type="drive", simplify=True)

    @staticmethod
    def _load_area_coords() -> Dict[str, Tuple[float, float]]:
        raw = json.loads(AREA_COORDS_PATH.read_text(encoding="utf-8"))
        return {name: (coords[0], coords[1]) for name, coords in raw.items()}

    def predict_next_day_aqi(self, area: str) -> float:
        if area in self.aqi_cache:
            return self.aqi_cache[area]

        if area not in self.area_feature_table.index:
            return 150.0

        features = self.area_feature_table.loc[area].to_dict()
        features["Month"] = (datetime.now() + timedelta(days=1)).month

        matrix = pd.DataFrame([features]).reindex(columns=self.feature_order, fill_value=0)
        prediction = float(self.model.predict(matrix)[0])
        self.aqi_cache[area] = prediction
        return prediction

    def get_area_aqi_snapshot(self) -> List[dict]:
        snapshot = []
        for area in self.areas:
            lat, lon = self.area_coords[area]
            aqi = round(self.predict_next_day_aqi(area), 2)
            risk, color = self._aqi_risk(aqi)
            snapshot.append(
                {
                    "name": area,
                    "lat": lat,
                    "lon": lon,
                    "aqi": aqi,
                    "risk": risk,
                    "color": color,
                }
            )
        return snapshot

    def build_route_bundle(self, start: str, destination: str) -> dict:
        start = self._normalize_area(start)
        destination = self._normalize_area(destination)

        if start == destination:
            raise ValueError("Start and destination must be different.")

        fastest_nodes = self._shortest_path(start, destination, "length")
        safest_nodes = self._shortest_path(start, destination, self._safe_weight)
        balanced_nodes = self._shortest_path(start, destination, self._balanced_weight)

        routes = [
            self._serialize_route("Safe", safest_nodes, is_recommended=True),
            self._serialize_route("Fast", fastest_nodes),
            self._serialize_route("Balanced", balanced_nodes),
        ]

        routes.sort(key=lambda item: (0 if item["type"] == "Safe" else 1, item["distanceKm"]))
        recommended = next(route for route in routes if route["isRecommended"])

        return {
            "start": start,
            "destination": destination,
            "routes": routes,
            "recommendedRouteId": recommended["id"],
            "safeLimit": 100,
            "updatedAt": datetime.now().isoformat(),
        }

    def _normalize_area(self, area: str) -> str:
        if area not in self.area_coords:
            raise ValueError(f"Unknown area '{area}'.")
        return area

    def _nearest_area_for_point(self, lat: float, lon: float) -> str:
        def pseudo_distance(candidate: Tuple[float, float]) -> float:
            c_lat, c_lon = candidate
            return (lat - c_lat) ** 2 + (lon - c_lon) ** 2

        return min(self.area_coords, key=lambda area: pseudo_distance(self.area_coords[area]))

    def _nearest_node(self, area: str) -> int:
        lat, lon = self.area_coords[area]
        return ox.distance.nearest_nodes(self.graph, lon, lat)

    def _safe_weight(self, u: int, v: int, data: dict) -> float:
        base_length = data.get("length", 1.0)
        lat = (self.graph.nodes[u]["y"] + self.graph.nodes[v]["y"]) / 2
        lon = (self.graph.nodes[u]["x"] + self.graph.nodes[v]["x"]) / 2
        area = self._nearest_area_for_point(lat, lon)
        aqi = self.predict_next_day_aqi(area)
        penalty = 1 + max(aqi - 50, 0) / 75
        return base_length * penalty

    def _balanced_weight(self, u: int, v: int, data: dict) -> float:
        base_length = data.get("length", 1.0)
        safe_component = self._safe_weight(u, v, data)
        return (base_length * 0.6) + (safe_component * 0.4)

    def _shortest_path(self, start: str, destination: str, weight) -> List[int]:
        return nx.shortest_path(
            self.graph,
            self._nearest_node(start),
            self._nearest_node(destination),
            weight=weight,
        )

    def _path_coordinates(self, path: List[int]) -> List[List[float]]:
        return [[self.graph.nodes[node]["x"], self.graph.nodes[node]["y"]] for node in path]

    def _path_distance_m(self, path: List[int]) -> float:
        total = 0.0
        for current, nxt in zip(path[:-1], path[1:]):
            edge = list(self.graph.get_edge_data(current, nxt).values())[0]
            total += edge.get("length", 0.0)
        return total

    def _path_average_aqi(self, path: List[int]) -> float:
        sample_size = min(len(path), 24)
        if sample_size <= 1:
            return 150.0

        indexes = np.linspace(0, len(path) - 1, sample_size, dtype=int)
        sampled_aqi = []
        for index in indexes:
            node = path[index]
            lat = self.graph.nodes[node]["y"]
            lon = self.graph.nodes[node]["x"]
            area = self._nearest_area_for_point(lat, lon)
            sampled_aqi.append(self.predict_next_day_aqi(area))

        return float(np.mean(sampled_aqi))

    def _route_time_minutes(self, distance_m: float, route_type: str) -> float:
        average_speed_kmh = {"Fast": 38, "Balanced": 32, "Safe": 28}.get(route_type, 30)
        return (distance_m / 1000) / average_speed_kmh * 60

    def _aqi_risk(self, aqi: float) -> Tuple[str, str]:
        for upper_bound, label, color in AQI_THRESHOLDS:
            if aqi <= upper_bound:
                return label, color
        return "Severe", "#7e22ce"

    def _risk_score(self, aqi: float) -> str:
        if aqi <= 75:
            return "Low"
        if aqi <= 140:
            return "Medium"
        return "High"

    def _make_steps(self, coordinates: List[List[float]]) -> List[dict]:
        if len(coordinates) < 2:
            return []

        steps = []
        distance_so_far = 0.0

        for index in range(1, len(coordinates)):
            prev_lon, prev_lat = coordinates[index - 1]
            lon, lat = coordinates[index]
            segment_m = self._distance_m(prev_lat, prev_lon, lat, lon)
            distance_so_far += segment_m

            instruction = "Continue straight"
            if 1 <= index < len(coordinates) - 1:
                next_lon, next_lat = coordinates[index + 1]
                turn = self._turn_instruction(
                    (prev_lat, prev_lon),
                    (lat, lon),
                    (next_lat, next_lon),
                )
                if turn:
                    instruction = turn

            steps.append(
                {
                    "id": f"step-{index}",
                    "distanceFromStartM": round(distance_so_far, 1),
                    "segmentDistanceM": round(segment_m, 1),
                    "instruction": instruction,
                    "coordinate": [lon, lat],
                }
            )

        return steps

    def _serialize_route(self, route_type: str, path: List[int], is_recommended: bool = False) -> dict:
        coordinates = self._path_coordinates(path)
        distance_m = self._path_distance_m(path)
        average_aqi = round(self._path_average_aqi(path), 2)
        risk = self._risk_score(average_aqi)
        risk_label, color = self._aqi_risk(average_aqi)

        return {
            "id": route_type.lower(),
            "type": route_type,
            "isRecommended": is_recommended,
            "distanceKm": round(distance_m / 1000, 2),
            "estimatedTimeMin": round(self._route_time_minutes(distance_m, route_type)),
            "averageAqi": average_aqi,
            "risk": risk,
            "riskColor": color,
            "aqiCategory": risk_label,
            "geometry": {
                "type": "Feature",
                "properties": {"routeType": route_type},
                "geometry": {"type": "LineString", "coordinates": coordinates},
            },
            "steps": self._make_steps(coordinates),
        }

    @staticmethod
    def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        radius = 6371000
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)

        a = (
            math.sin(delta_phi / 2) ** 2
            + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
        )
        return 2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _turn_instruction(
        self,
        first: Tuple[float, float],
        second: Tuple[float, float],
        third: Tuple[float, float],
    ) -> str | None:
        bearing_one = self._bearing(first, second)
        bearing_two = self._bearing(second, third)
        delta = (bearing_two - bearing_one + 540) % 360 - 180

        if abs(delta) < 18:
            return None
        if delta > 0:
            return "Turn left"
        return "Turn right"

    @staticmethod
    def _bearing(start: Tuple[float, float], end: Tuple[float, float]) -> float:
        lat1 = math.radians(start[0])
        lat2 = math.radians(end[0])
        delta_lon = math.radians(end[1] - start[1])
        x = math.sin(delta_lon) * math.cos(lat2)
        y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
        return (math.degrees(math.atan2(x, y)) + 360) % 360


engine = RouteEngine()
