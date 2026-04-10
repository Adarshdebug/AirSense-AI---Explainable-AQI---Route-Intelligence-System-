import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";

const DELHI_CENTER = [28.6139, 77.209];
const ROUTE_COLORS = {
  safe: "#0f9f67",
  fast: "#2b73ff",
  balanced: "#f59e0b"
};

export default function MapViewOSM({
  routeBundle,
  selectedRouteId,
  overlayPoints,
  userPosition,
  showHeatmap,
  followUser
}) {
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const routeLayerRef = useRef(null);
  const overlayLayerRef = useRef(null);
  const userMarkerRef = useRef(null);

  const selectedRoute = useMemo(
    () => routeBundle?.routes?.find((route) => route.id === selectedRouteId) || routeBundle?.routes?.[0],
    [routeBundle, selectedRouteId]
  );

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapNodeRef.current, {
      zoomControl: false,
      attributionControl: false
    }).setView(DELHI_CENTER, 11);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map);

    routeLayerRef.current = L.layerGroup().addTo(map);
    overlayLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer) {
      return;
    }

    routeLayer.clearLayers();
    if (!routeBundle?.routes?.length) {
      return;
    }

    const bounds = [];
    routeBundle.routes.forEach((route) => {
      const coordinates = route.geometry.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      coordinates.forEach((point) => bounds.push(point));

      L.polyline(coordinates, {
        color: ROUTE_COLORS[route.id] || route.riskColor,
        weight: route.id === selectedRouteId ? 8 : 5,
        opacity: route.id === selectedRouteId ? 0.95 : 0.45,
        lineCap: "round",
        lineJoin: "round"
      })
        .bindTooltip(`${route.type} route - ${route.distanceKm} km - ${route.estimatedTimeMin} min - AQI ${route.averageAqi}`, {
          sticky: true
        })
        .addTo(routeLayer);
    });

    if (bounds.length) {
      map.fitBounds(bounds, {
        paddingTopLeft: [60, 150],
        paddingBottomRight: [60, 300]
      });
    }
  }, [routeBundle, selectedRouteId]);

  useEffect(() => {
    const overlayLayer = overlayLayerRef.current;
    if (!overlayLayer) {
      return;
    }

    overlayLayer.clearLayers();
    if (!showHeatmap) {
      return;
    }

    overlayPoints.forEach((point) => {
      L.circle([point.lat, point.lon], {
        radius: 1500,
        color: point.color,
        fillColor: point.color,
        fillOpacity: 0.16,
        opacity: 0
      }).addTo(overlayLayer);

      L.circleMarker([point.lat, point.lon], {
        radius: 7,
        color: "#ffffff",
        weight: 1.5,
        fillColor: point.color,
        fillOpacity: 0.95
      })
        .bindPopup(`<strong>${point.name}</strong><br/>AQI ${point.aqi}<br/>${point.risk} pollution`)
        .addTo(overlayLayer);
    });
  }, [overlayPoints, showHeatmap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userPosition) {
      return;
    }

    const latLng = [userPosition.lat, userPosition.lon];
    if (!userMarkerRef.current) {
      const userIcon = L.divIcon({
        className: "user-location-marker",
        html: '<div class="h-5 w-5 rounded-full border-[3px] border-white bg-sky-500 shadow-[0_0_0_10px_rgba(59,130,246,0.14)]"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      userMarkerRef.current = L.marker(latLng, { icon: userIcon }).addTo(map);
    } else {
      userMarkerRef.current.setLatLng(latLng);
    }

    if (followUser) {
      map.flyTo(latLng, Math.max(map.getZoom(), 14), {
        duration: 0.9
      });
    }
  }, [followUser, userPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedRoute?.geometry?.geometry?.coordinates?.length) {
      return;
    }

    const coordinates = selectedRoute.geometry.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    map.fitBounds(coordinates, {
      paddingTopLeft: [60, 150],
      paddingBottomRight: [60, 300]
    });
  }, [selectedRoute]);

  return <div ref={mapNodeRef} className="absolute inset-0" />;
}
