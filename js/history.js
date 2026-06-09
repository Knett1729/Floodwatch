// history.js — charts and timeline

function _bootHistory() {

  // BAR CHART — flood events per year
  new Chart(document.getElementById("barChart"), {
    type: "bar",
    data: {
      labels: FLOOD_EVENTS_BY_YEAR.labels,
      datasets: [{
        label: "Flood events",
        data: FLOOD_EVENTS_BY_YEAR.data,
        backgroundColor: FLOOD_EVENTS_BY_YEAR.data.map(v =>
          v >= 7 ? "#d63031" : "#85B7EB"
        ),
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw} flood events` } }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: "#f0f0f0" }, ticks: { stepSize: 1 } },
        x: { grid: { display: false } }
      }
    }
  });

  // MONTH CHART
  new Chart(document.getElementById("monthChart"), {
    type: "bar",
    data: {
      labels: FLOOD_BY_MONTH.labels,
      datasets: [{
        label: "Events",
        data: FLOOD_BY_MONTH.data,
        backgroundColor: "#9FE1CB",
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: "#f0f0f0" } },
        x: { grid: { display: false } }
      }
    }
  });

  // LINE CHART — rainfall vs floods 2024
  new Chart(document.getElementById("lineChart"), {
    type: "line",
    data: {
      labels: RAINFALL_2024.labels,
      datasets: [
        {
          label: "Rainfall (mm)",
          data: RAINFALL_2024.rainfall,
          borderColor: "#378ADD",
          backgroundColor: "rgba(55,138,221,0.08)",
          tension: 0.4,
          fill: true,
          yAxisID: "y"
        },
        {
          label: "Flood events",
          data: RAINFALL_2024.floods,
          borderColor: "#d63031",
          backgroundColor: "rgba(214,48,49,0.1)",
          tension: 0.4,
          fill: false,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "top" } },
      scales: {
        y:  { beginAtZero: true, grid: { color: "#f0f0f0" }, title: { display: true, text: "Rainfall (mm)" } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Flood events" } },
        x:  { grid: { display: false } }
      }
    }
  });

  // TIMELINE
  const timeline = document.getElementById("timeline");
  const iconMap = { critical: "🔴", warning: "🟡" };
  MAJOR_EVENTS.forEach(ev => {
    const div = document.createElement("div");
    div.className = "tl-item";
    div.innerHTML = `
      <div class="tl-dot ${ev.level}-dot"></div>
      <div class="tl-content">
        <div class="tl-date">${ev.date}</div>
        <div class="tl-name">${iconMap[ev.level]} ${ev.name}</div>
        <div class="tl-desc">${ev.desc}</div>
        <div class="tl-tag">${ev.barangays} barangays affected</div>
      </div>
    `;
    timeline.appendChild(div);
  });

  // MOST AFFECTED BARANGAYS
  const container = document.getElementById("brgy-bars");
  const max = MOST_AFFECTED[0].count;
  MOST_AFFECTED.forEach(b => {
    const pct = Math.round((b.count / max) * 100);
    const div = document.createElement("div");
    div.className = "brgy-bar-item";
    div.innerHTML = `
      <div class="brgy-bar-label">${b.name}</div>
      <div class="brgy-bar-track">
        <div class="brgy-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="brgy-bar-count">${b.count}x</div>
    `;
    container.appendChild(div);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootHistory);
} else {
  _bootHistory();
}
