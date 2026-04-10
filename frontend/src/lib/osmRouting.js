import { distanceBetween } from "./geo";

const OSRM_BASE_URL = "https://router.project-osrm.org/route/v1/driving";

function routeWaypoints(routeType, bundle, areas) {
  const startArea = areas.find((area) => area.name === bundle.start);
  const destinationArea = areas.find((area) => area.name === bundle.destination);

  if (!startArea || !destinationArea) {
    return [];
  }

  if (routeType === "Fast") {
    return [startArea, destinationArea];
  }

  const midpoint = {
    lat: (startArea.lat + destinationArea.lat) / 2,
    lon: (startArea.lon + destinationArea.lon) / 2
  };

  const candidates = areas.filter((area) => area.name !== startArea.name && area.name !== destinationArea.name);
  const waypoint = candidates.reduce((best, area) => {
    const distancePenalty = distanceBetween(midpoint, area);
    const aqiPenalty = Number(area.aqi || 150);
    const score = routeType === "Balanced" ? distancePenalty + aqiPenalty * 45 : distancePenalty / 3 + aqiPenalty * 100;

    if (!best || score < best.score) {
      return { area, score };
    }

    return best;
  }, null)?.area;

  return waypoint ? [startArea, waypoint, destinationArea] : [startArea, destinationArea];
}

function osrmInstruction(step) {
  const maneuver = step.maneuver || {};
  const type = (maneuver.type || "continue").replaceAll("_", " ");
  const modifier = maneuver.modifier || "";
  const road = step.name || "";

  let instruction = type === "depart" ? "Start driving" : type === "arrive" ? "You have arrived" : type;
  if (modifier && type !== "depart" && type !== "arrive") {
    instruction = `${instruction} ${modifier}`;
  }

  const normalized = instruction.charAt(0).toUpperCase() + instruction.slice(1);
  return road ? `${normalized} onto ${road}` : normalized;
}

function osrmSteps(route) {
  let distanceFromStart = 0;
  let counter = 1;

  return route.legs.flatMap((leg) =>
    leg.steps.map((step) => {
      distanceFromStart += step.distance || 0;
      return {
        id: `step-${counter++}`,
        distanceFromStartM: Math.round(distanceFromStart * 10) / 10,
        segmentDistanceM: Math.round((step.distance || 0) * 10) / 10,
        instruction: osrmInstruction(step),
        coordinate: step.maneuver.location
      };
    })
  );
}

async function fetchOsrmRoute(routeType, bundle, areas) {
  const waypoints = routeWaypoints(routeType, bundle, areas);
  if (waypoints.length < 2) {
    return null;
  }

  const coordinates = waypoints.map((area) => `${area.lon},${area.lat}`).join(";");
  const params = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    steps: "true"
  });

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(`${OSRM_BASE_URL}/${coordinates}?${params.toString()}`, {
      signal: controller.signal
    });
    const payload = await response.json();

    if (!response.ok || payload.code !== "Ok" || !payload.routes?.length) {
      return null;
    }

    return payload.routes[0];
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function enhanceRoutesWithBrowserOsrm(bundle, areas) {
  if (!bundle?.routes?.length || !areas.length) {
    return bundle;
  }

  const enhancedRoutes = await Promise.all(
    bundle.routes.map(async (route) => {
      const osrmRoute = await fetchOsrmRoute(route.type, bundle, areas);
      if (!osrmRoute) {
        return route;
      }

      return {
        ...route,
        distanceKm: Math.round((osrmRoute.distance / 1000) * 100) / 100,
        estimatedTimeMin: Math.max(1, Math.round(osrmRoute.duration / 60)),
        geometry: {
          ...route.geometry,
          properties: {
            ...route.geometry.properties,
            source: "browser-osrm"
          },
          geometry: osrmRoute.geometry
        },
        steps: osrmSteps(osrmRoute)
      };
    })
  );

  return {
    ...bundle,
    routes: enhancedRoutes
  };
}
