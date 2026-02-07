async function analyzeRoute() {
    const city = document.getElementById("city").value;
    const mode = document.getElementById("mode").value;
    const hour = document.getElementById("hour").value;
    const month = document.getElementById("month").value;

    if (!city) {
        alert("Please select a city");
        return;
    }

    const response = await fetch("/route-exposure", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            city: city,
            mode: mode,
            hour: parseInt(hour),
            month: parseInt(month)
        })
    });

    const data = await response.json();

    if (data.error) {
        document.getElementById("routeResult").innerHTML =
            `<p style="color:red">${data.error}</p>`;
        return;
    }

    // -------- BEST ROUTE --------
    const best = data.best_route;

    let zoneHtml = "";
    best.zones.forEach(z => {
        zoneHtml += `
            <li>
                <strong>${z.zone}</strong> :
                AQI ≈ <b>${z.predicted_aqi}</b>
            </li>
        `;
    });

    document.getElementById("routeResult").innerHTML = `
        <h3>✅ Recommended Route</h3>
        <p><b>${best.route}</b></p>

        <h4>🧭 Zones Covered</h4>
        <ul>${zoneHtml}</ul>

        <p><b>Exposure Score:</b> ${best.exposure_score}</p>
        <p><b>Recommended Mode:</b> ${data.recommended_mode}</p>
    `;

    // -------- OPTIONAL: ALL ROUTES --------
    let allRoutesHtml = "<h4>📊 All Route Comparisons</h4><ul>";
    data.all_routes.forEach(r => {
        allRoutesHtml += `
            <li>
                ${r.route} → Exposure Score: <b>${r.exposure_score}</b>
            </li>
        `;
    });
    allRoutesHtml += "</ul>";

    document.getElementById("routeResult").innerHTML += allRoutesHtml;
}