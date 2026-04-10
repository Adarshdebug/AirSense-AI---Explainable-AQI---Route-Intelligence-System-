from __future__ import annotations

import json
import math
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd


BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE_DIR / "aqi_rf_delhi_ncr.pkl"
FEATURE_ORDER_PATH = BASE_DIR / "feature_orderv6.pkl"
DATASET_PATH = BASE_DIR / "delhi_ncr_area_wise_aqi_engineered.csv"
AREA_COORDS_PATH = BASE_DIR / "area_coords_delhi_ncr.json"
OSRM_BASE_URL = "https://router.project-osrm.org/route/v1/driving"


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
        if hasattr(self.model, "n_jobs"):
            self.model.n_jobs = 1
        self.feature_order = joblib.load(FEATURE_ORDER_PATH)
        self.dataset = pd.read_csv(DATASET_PATH)
        self.area_feature_table = self.dataset.groupby("Area").mean(numeric_only=True)
        self.aqi_cache: Dict[str, float] = {}
        # Keep API startup fast. The original Streamlit prototype loaded the full
        # Delhi road graph on startup, which can take minutes or require network.
        self.graph = None

    @staticmethod
    def _load_area_coords() -> Dict[str, Tuple[float, float]]:
        raw = json.loads(AREA_COORDS_PATH.read_text(encoding="utf-8"))
        return {name: (coords[0], coords[1]) for name, coords in raw.items()}

    def predict_next_day_aqi(self, area: str) -> float:
        if not self.aqi_cache:
            self._prime_aqi_cache()

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

    def _prime_aqi_cache(self) -> None:
        rows = []
        row_areas = []
        next_month = (datetime.now() + timedelta(days=1)).month

        for area in self.areas:
            if area not in self.area_feature_table.index:
                continue
            features = self.area_feature_table.loc[area].to_dict()
            features["Month"] = next_month
            rows.append(features)
            row_areas.append(area)

        if not rows:
            return

        matrix = pd.DataFrame(rows).reindex(columns=self.feature_order, fill_value=0)
        predictions = self.model.predict(matrix)
        for area, prediction in zip(row_areas, predictions):
            self.aqi_cache[area] = float(prediction)

    def get_area_aqi_snapshot(self) -> List[dict]:
        if not self.aqi_cache:
            self._prime_aqi_cache()

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
        if not self.aqi_cache:
            self._prime_aqi_cache()

        start = self._normalize_area(start)
        destination = self._normalize_area(destination)

        if start == destination:
            raise ValueError("Start and destination must be different.")

        routes = [
            self._serialize_osm_route("Safe", start, destination, is_recommended=True),
            self._serialize_osm_route("Fast", start, destination),
            self._serialize_osm_route("Balanced", start, destination),
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

    def _serialize_osm_route(
        self,
        route_type: str,
        start: str,
        destination: str,
        is_recommended: bool = False,
    ) -> dict:
        try:
            route_data = self._fetch_osrm_route(route_type, start, destination)
        except (urllib.error.URLError, TimeoutError, KeyError, IndexError, ValueError):
            return self._serialize_lightweight_route(route_type, start, destination, is_recommended)

        coordinates = route_data["geometry"]["coordinates"]
        distance_m = float(route_data.get("distance", self._coordinate_distance_m(coordinates)))
        duration_seconds = float(route_data.get("duration", self._route_time_minutes(distance_m, route_type) * 60))
        average_aqi = round(self._coordinate_average_aqi(coordinates), 2)
        risk = self._risk_score(average_aqi)
        risk_label, color = self._aqi_risk(average_aqi)

        return {
            "id": route_type.lower(),
            "type": route_type,
            "isRecommended": is_recommended,
            "distanceKm": round(distance_m / 1000, 2),
            "estimatedTimeMin": max(1, round(duration_seconds / 60)),
            "averageAqi": average_aqi,
            "risk": risk,
            "riskColor": color,
            "aqiCategory": risk_label,
            "geometry": {
                "type": "Feature",
                "properties": {"routeType": route_type, "source": "osrm"},
                "geometry": {"type": "LineString", "coordinates": coordinates},
            },
            "steps": self._steps_from_osrm(route_data) or self._make_steps(coordinates),
        }

    def _fetch_osrm_route(self, route_type: str, start: str, destination: str) -> dict:
        waypoint_names = self._route_waypoint_names(route_type, start, destination)
        waypoints = [self.area_coords[name] for name in waypoint_names]
        coordinate_text = ";".join(f"{lon},{lat}" for lat, lon in waypoints)
        query = urllib.parse.urlencode(
            {
                "overview": "full",
                "geometries": "geojson",
                "steps": "true",
                "annotations": "false",
            }
        )
        url = f"{OSRM_BASE_URL}/{coordinate_text}?{query}"

        with urllib.request.urlopen(url, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))

        if payload.get("code") != "Ok" or not payload.get("routes"):
            raise ValueError(payload.get("message", "OSRM route not available"))

        return payload["routes"][0]

    def _route_waypoint_names(self, route_type: str, start: str, destination: str) -> List[str]:
        if route_type == "Fast":
            return [start, destination]

        start_lat, start_lon = self.area_coords[start]
        end_lat, end_lon = self.area_coords[destination]
        mid_lat = (start_lat + end_lat) / 2
        mid_lon = (start_lon + end_lon) / 2

        candidates = [area for area in self.areas if area not in {start, destination}]
        if route_type == "Balanced":
            waypoint = min(
                candidates,
                key=lambda area: (
                    self._distance_m(mid_lat, mid_lon, self.area_coords[area][0], self.area_coords[area][1])
                    + self.predict_next_day_aqi(area) * 45
                ),
            )
        else:
            waypoint = min(
                candidates,
                key=lambda area: (
                    self.predict_next_day_aqi(area) * 100
                    + self._distance_m(mid_lat, mid_lon, self.area_coords[area][0], self.area_coords[area][1]) / 3
                ),
            )

        return [start, waypoint, destination]

    def _steps_from_osrm(self, route_data: dict) -> List[dict]:
        steps = []
        distance_so_far = 0.0
        counter = 1

        for leg in route_data.get("legs", []):
            for step in leg.get("steps", []):
                maneuver = step.get("maneuver", {})
                location = maneuver.get("location")
                if not location:
                    continue

                distance_so_far += float(step.get("distance", 0))
                instruction = self._format_osrm_instruction(step)
                steps.append(
                    {
                        "id": f"step-{counter}",
                        "distanceFromStartM": round(distance_so_far, 1),
                        "segmentDistanceM": round(float(step.get("distance", 0)), 1),
                        "instruction": instruction,
                        "coordinate": location,
                    }
                )
                counter += 1

        return steps

    @staticmethod
    def _format_osrm_instruction(step: dict) -> str:
        maneuver = step.get("maneuver", {})
        maneuver_type = maneuver.get("type", "continue").replace("_", " ")
        modifier = maneuver.get("modifier", "")
        road_name = step.get("name", "")

        if maneuver_type == "depart":
            instruction = "Start driving"
        elif maneuver_type == "arrive":
            instruction = "You have arrived"
        elif modifier:
            instruction = f"{maneuver_type.title()} {modifier}"
        else:
            instruction = maneuver_type.title()

        if road_name:
            instruction = f"{instruction} onto {road_name}"

        return instruction

    def _serialize_lightweight_route(
        self,
        route_type: str,
        start: str,
        destination: str,
        is_recommended: bool = False,
    ) -> dict:
        coordinates = self._lightweight_coordinates(route_type, start, destination)
        distance_m = self._coordinate_distance_m(coordinates)
        average_aqi = round(self._coordinate_average_aqi(coordinates), 2)
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
                "properties": {"routeType": route_type, "source": "fallback"},
                "geometry": {"type": "LineString", "coordinates": coordinates},
            },
            "steps": self._make_steps(coordinates),
        }

    def _lightweight_coordinates(self, route_type: str, start: str, destination: str) -> List[List[float]]:
        start_lat, start_lon = self.area_coords[start]
        end_lat, end_lon = self.area_coords[destination]
        mid_lat = (start_lat + end_lat) / 2
        mid_lon = (start_lon + end_lon) / 2
        delta_lat = end_lat - start_lat
        delta_lon = end_lon - start_lon

        if route_type == "Fast":
            control_points = [(start_lat, start_lon), (mid_lat, mid_lon), (end_lat, end_lon)]
        elif route_type == "Balanced":
            control_points = [
                (start_lat, start_lon),
                (mid_lat + delta_lon * 0.12, mid_lon - delta_lat * 0.12),
                (end_lat, end_lon),
            ]
        else:
            safest_area = min(
                self.areas,
                key=lambda area: self.predict_next_day_aqi(area)
                + self._distance_m(mid_lat, mid_lon, self.area_coords[area][0], self.area_coords[area][1]) / 1000,
            )
            safe_lat, safe_lon = self.area_coords[safest_area]
            control_points = [
                (start_lat, start_lon),
                ((start_lat + safe_lat) / 2, (start_lon + safe_lon) / 2),
                (safe_lat, safe_lon),
                ((safe_lat + end_lat) / 2, (safe_lon + end_lon) / 2),
                (end_lat, end_lon),
            ]

        return [[lon, lat] for lat, lon in self._densify_points(control_points)]

    def _densify_points(self, points: List[Tuple[float, float]], steps_per_segment: int = 12) -> List[Tuple[float, float]]:
        dense = []
        for current, nxt in zip(points[:-1], points[1:]):
            for step in range(steps_per_segment):
                ratio = step / steps_per_segment
                lat = current[0] + (nxt[0] - current[0]) * ratio
                lon = current[1] + (nxt[1] - current[1]) * ratio
                dense.append((lat, lon))
        dense.append(points[-1])
        return dense

    def _coordinate_distance_m(self, coordinates: List[List[float]]) -> float:
        total = 0.0
        for current, nxt in zip(coordinates[:-1], coordinates[1:]):
            total += self._distance_m(current[1], current[0], nxt[1], nxt[0])
        return total

    def _coordinate_average_aqi(self, coordinates: List[List[float]]) -> float:
        sample_size = min(len(coordinates), 20)
        if sample_size <= 1:
            return 150.0

        indexes = np.linspace(0, len(coordinates) - 1, sample_size, dtype=int)
        values = []
        for index in indexes:
            lon, lat = coordinates[index]
            area = self._nearest_area_for_point(lat, lon)
            values.append(self.predict_next_day_aqi(area))
        return float(np.mean(values))

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
