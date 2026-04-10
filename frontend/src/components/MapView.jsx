import { useEffect, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";

const DELHI_CENTER = [77.209, 28.6139];
const ROUTE_COLORS = {
  safe: "#0f9f67",
  fast: "#2b73ff",
  balanced: "#f59e0b"
};

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || "";
const HAS_MAPBOX_TOKEN = Boolean(mapboxgl.accessToken);

function makeRouteCollection(routes) {
  return {
    type: "FeatureCollection",
    features: routes.map((route) => ({
      ...route.geometry,
      properties: {
        ...route.geometry.properties,
        routeId: route.id,
        color: ROUTE_COLORS[route.id] || route.riskColor,
        emphasis: route.isRecommended ? 1 : 0
      }
    }))
  };
}

function makeAqiCollection(points) {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      properties: {
        name: point.name,
        aqi: point.aqi,
        risk: point.risk,
        color: point.color
      },
      geometry: {
        type: "Point",
        coordinates: [point.lon, point.lat]
      }
    }))
  };
}

export default function MapView({
  routeBundle,
  selectedRouteId,
  overlayPoints,
  userPosition,
  showHeatmap,
  followUser,
  darkMode
}) {
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);

  const selectedRoute = useMemo(
    () => routeBundle?.routes?.find((route) => route.id === selectedRouteId) || routeBundle?.routes?.[0],
    [routeBundle, selectedRouteId]
  );

  useEffect(() => {
    if (!HAS_MAPBOX_TOKEN) {
      return;
    }

    if (!mapNodeRef.current || mapRef.current) {
      return;
    }

    const map = new mapboxgl.Map({
      container: mapNodeRef.current,
      style: darkMode ? "mapbox://styles/mapbox/navigation-night-v1" : "mapbox://styles/mapbox/navigation-day-v1",
      center: DELHI_CENTER,
      zoom: 10.6,
      pitch: 42,
      bearing: -8,
      attributionControl: false
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      map.addSource("routes", {
        type: "geojson",
        data: makeRouteCollection(routeBundle?.routes || [])
      });

      map.addLayer({
        id: "routes-outline",
        type: "line",
        source: "routes",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["==", ["get", "routeId"], selectedRouteId], 10, 7],
          "line-opacity": ["case", ["==", ["get", "routeId"], selectedRouteId], 0.95, 0.45]
        },
        layout: {
          "line-cap": "round",
          "line-join": "round"
        }
      });

      map.addSource("aqi-points", {
        type: "geojson",
        data: makeAqiCollection(overlayPoints)
      });

      map.addLayer({
        id: "aqi-glow",
        type: "circle",
        source: "aqi-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 18, 13, 36],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.18,
          "circle-blur": 0.8
        },
        layout: {
          visibility: showHeatmap ? "visible" : "none"
        }
      });

      map.addLayer({
        id: "aqi-points-fill",
        type: "circle",
        source: "aqi-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 6, 13, 10],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.95
        },
        layout: {
          visibility: showHeatmap ? "visible" : "none"
        }
      });

      map.on("click", "aqi-points-fill", (event) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }

        new mapboxgl.Popup({ closeButton: false, offset: 18 })
          .setLngLat(feature.geometry.coordinates)
          .setHTML(
            `<div>
              <strong>${feature.properties.name}</strong><br />
              AQI ${feature.properties.aqi}<br />
              ${feature.properties.risk} pollution
            </div>`
          )
          .addTo(map);
      });
    });

    mapRef.current = map;

    return () => map.remove();
  }, [darkMode, overlayPoints, routeBundle?.routes, selectedRouteId, showHeatmap]);

  useEffect(() => {
    if (!HAS_MAPBOX_TOKEN) {
      return;
    }

    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getSource("routes")) {
      return;
    }

    map.getSource("routes").setData(makeRouteCollection(routeBundle?.routes || []));
    if (map.getLayer("routes-outline")) {
      map.setPaintProperty(
        "routes-outline",
        "line-width",
        ["case", ["==", ["get", "routeId"], selectedRouteId], 10, 7]
      );
      map.setPaintProperty(
        "routes-outline",
        "line-opacity",
        ["case", ["==", ["get", "routeId"], selectedRouteId], 0.95, 0.45]
      );
    }

    if (selectedRoute?.geometry?.geometry?.coordinates?.length) {
      const bounds = selectedRoute.geometry.geometry.coordinates.reduce(
        (box, coordinate) => box.extend(coordinate),
        new mapboxgl.LngLatBounds(selectedRoute.geometry.geometry.coordinates[0], selectedRoute.geometry.geometry.coordinates[0])
      );

      map.fitBounds(bounds, {
        padding: { top: 150, right: 60, bottom: 300, left: 60 },
        duration: 1200
      });
    }
  }, [routeBundle, selectedRoute, selectedRouteId]);

  useEffect(() => {
    if (!HAS_MAPBOX_TOKEN) {
      return;
    }

    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getSource("aqi-points")) {
      return;
    }

    map.getSource("aqi-points").setData(makeAqiCollection(overlayPoints));
    const visibility = showHeatmap ? "visible" : "none";
    if (map.getLayer("aqi-glow")) {
      map.setLayoutProperty("aqi-glow", "visibility", visibility);
    }
    if (map.getLayer("aqi-points-fill")) {
      map.setLayoutProperty("aqi-points-fill", "visibility", visibility);
    }
  }, [overlayPoints, showHeatmap]);

  useEffect(() => {
    if (!HAS_MAPBOX_TOKEN) {
      return;
    }

    const map = mapRef.current;
    if (!map || !userPosition) {
      return;
    }

    if (!userMarkerRef.current) {
      const markerNode = document.createElement("div");
      markerNode.className = "h-5 w-5 rounded-full border-[3px] border-white bg-sky-500 shadow-[0_0_0_10px_rgba(59,130,246,0.14)]";
      userMarkerRef.current = new mapboxgl.Marker({ element: markerNode }).setLngLat([userPosition.lon, userPosition.lat]).addTo(map);
    } else {
      userMarkerRef.current.setLngLat([userPosition.lon, userPosition.lat]);
    }

    if (followUser) {
      map.easeTo({
        center: [userPosition.lon, userPosition.lat],
        duration: 900,
        zoom: Math.max(map.getZoom(), 13.5)
      });
    }
  }, [followUser, userPosition]);

  if (!HAS_MAPBOX_TOKEN) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18),transparent_30%),#eaf2f1] px-6 text-center dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.14),transparent_30%),#081114]">
        <div className="glass-panel max-w-xl rounded-[32px] p-6 sm:p-8">
          <h2 className="font-['Sora'] text-xl font-semibold">Map token required</h2>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            Create <code>.env</code> inside the frontend folder and set <code>VITE_MAPBOX_ACCESS_TOKEN</code> to a valid
            Mapbox token, then restart <code>npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  return <div ref={mapNodeRef} className="absolute inset-0" />;
}
