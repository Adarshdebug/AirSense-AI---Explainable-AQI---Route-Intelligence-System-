const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25000);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal,
      ...options
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Route service is taking too long. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Something went wrong.");
  }

  return payload;
}

export function fetchAreas() {
  return request("/api/areas");
}

export function fetchAqiOverlay() {
  return request("/api/aqi-overlay");
}

export function fetchSafeRoute(start, destination) {
  return request("/get_safe_route", {
    method: "POST",
    body: JSON.stringify({ start, destination })
  });
}
