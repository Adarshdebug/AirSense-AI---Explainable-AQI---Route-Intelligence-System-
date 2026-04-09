export function toRadians(value) {
  return (value * Math.PI) / 180;
}

export function distanceBetween(a, b) {
  const radius = 6371000;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * radius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

export function nearestArea(position, areas) {
  if (!position || !areas.length) {
    return null;
  }

  return areas.reduce((closest, area) => {
    const currentDistance = distanceBetween(position, { lat: area.lat, lon: area.lon });
    if (!closest || currentDistance < closest.distance) {
      return { area, distance: currentDistance };
    }
    return closest;
  }, null)?.area;
}

export function distanceToRoute(position, route) {
  if (!position || !route?.geometry?.geometry?.coordinates?.length) {
    return Infinity;
  }

  const coordinates = route.geometry.geometry.coordinates;
  return coordinates.reduce((closest, [lon, lat]) => {
    const pointDistance = distanceBetween(position, { lat, lon });
    return Math.min(closest, pointDistance);
  }, Infinity);
}
