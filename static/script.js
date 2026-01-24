// -------- VALID POLLUTANTS --------
const validPollutants = ["PM2.5", "PM10", "NO", "NO2", "CO", "SO2", "O3"];

// -------- AQI LEVEL GROUPS --------
const noAlertLevels = ["Good", "Satisfactory"];
const mildAlertLevels = ["Moderate"];
const highAlertLevels = ["Poor", "Very", "Severe"];

// -------- POLLUTANT CAUSES --------
const pollutantCauses = {
    "PM2.5": [
        "Vehicle exhaust emissions",
        "Road dust and construction activities",
        "Biomass and crop residue burning",
        "Low wind speed and temperature inversion"
    ],
    "NO2": [
        "Traffic congestion",
        "Diesel vehicles",
        "Industrial combustion"
    ],
    "CO": [
        "Incomplete fuel combustion",
        "Traffic emissions"
    ]
};

// -------- SAFETY ADVICE --------
const safetyAdvice = {
    "PM2.5": {
        children: [
            "Avoid outdoor play",
            "Wear N95 mask if going outside"
        ],
        elderly: [
            "Stay indoors",
            "Avoid morning walks"
        ],
        patients: [
            "Avoid exertion",
            "Keep inhaler ready"
        ]
    }
};

// -------- MAIN FUNCTION --------
function predictAQI() {
    const city = document.getElementById("city").value;
    const result = document.getElementById("result");

    if (!city) {
        result.classList.remove("hidden");
        result.innerHTML = "❌ Please select a city";
        return;
    }

    result.classList.remove("hidden");
    result.innerHTML = "⏳ Analyzing air quality...";

    fetch("/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            result.innerHTML = "❌ " + data.error;
            return;
        }

        const aqiCategory = data.aqi_category.split(" ")[0];

        const filteredReasons = data.reasons.filter(r =>
            validPollutants.includes(r.pollutant)
        );

        let reasonsHTML = "";
        let causeHTML = "";
        let safetyHTML = "";

        filteredReasons.forEach((r, index) => {
            let level = r.impact_percent > 40 ? "High" :
                        r.impact_percent > 20 ? "Moderate" : "Low";

            reasonsHTML += `<p>• ${r.pollutant} → ${level} contribution (${r.impact_percent}%)</p>`;

            if (index === 0 && pollutantCauses[r.pollutant]) {
                causeHTML = "<ul>";
                pollutantCauses[r.pollutant].forEach(c =>
                    causeHTML += `<li>${c}</li>`
                );
                causeHTML += "</ul>";

                // ---- SAFETY BASED ON AQI LEVEL ----
                if (highAlertLevels.includes(aqiCategory) && safetyAdvice[r.pollutant]) {
                    safetyHTML = `
                        <b>Children:</b><ul>${safetyAdvice[r.pollutant].children.map(x => `<li>${x}</li>`).join("")}</ul>
                        <b>Elderly:</b><ul>${safetyAdvice[r.pollutant].elderly.map(x => `<li>${x}</li>`).join("")}</ul>
                        <b>Patients:</b><ul>${safetyAdvice[r.pollutant].patients.map(x => `<li>${x}</li>`).join("")}</ul>
                    `;
                } else if (mildAlertLevels.includes(aqiCategory)) {
                    safetyHTML = `<p>⚠️ Sensitive groups should limit prolonged outdoor activity.</p>`;
                } else {
                    safetyHTML = `<p>✅ Air quality is acceptable. No special precautions required.</p>`;
                }
            }
        });

        result.innerHTML = `
            <h3>${data.city}</h3>

            <div class="section">
                <div class="section-title">Official AQI</div>
                <b>${data.official_aqi_formula}</b> — ${data.aqi_category}
            </div>

            <div class="section">
                <div class="section-title">Why AQI is high?</div>
                ${reasonsHTML}
            </div>

            <div class="section">
                <div class="section-title">Why ${filteredReasons[0]?.pollutant || "Pollution"} is high?</div>
                ${causeHTML || "<p>Cause data not available</p>"}
            </div>

            <div class="section">
                <div class="section-title">Safety Recommendations</div>
                ${safetyHTML}
            </div>
        `;
    })
    .catch(() => {
        result.innerHTML = "❌ Server error";
    });
}

function getRouteExposure() {
    const start = document.getElementById("start").value;
    const destination = document.getElementById("destination").value;
    const mode = document.getElementById("travelMode").value;
    const routeResult = document.getElementById("routeResult");

    if (!start || !destination) {
        routeResult.classList.remove("hidden");
        routeResult.innerHTML = "❌ Please enter start and destination.";
        return;
    }

    routeResult.classList.remove("hidden");
    routeResult.innerHTML = "⏳ Calculating healthiest route...";

    fetch("/route-exposure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            start: start,
            destination: destination,
            mode: mode
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            routeResult.innerHTML = "❌ " + data.error;
            return;
        }

        routeResult.innerHTML = `
            <h4>✅ Best Route Recommendation</h4>

            <div class="section">
                <div class="section-title">Recommended Mode</div>
                <b>${data.recommended_mode}</b>
            </div>

            <div class="section">
                <div class="section-title">Route Details</div>
                <p>🛣️ Route: ${data.best_route.summary}</p>
                <p>🌫️ Average AQI: ${data.best_route.avg_aqi}</p>
                <p>📏 Distance: ${data.best_route.distance_km} km</p>
                <p>⏱️ Time: ${data.best_route.time_min} min</p>
            </div>

            <div class="section">
                <div class="section-title">Pollution Exposure</div>
                <p>⚠️ Exposure Score: <b>${data.best_route.exposure_score}</b></p>
                <p style="font-size:0.8rem;opacity:0.7">
                    Lower score indicates healthier route
                </p>
            </div>
        `;
    })
    .catch(() => {
        routeResult.innerHTML = "❌ Server error.";
    });
}
