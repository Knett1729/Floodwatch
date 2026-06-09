// ============================================================
// data.js — shared barangay and flood data for FloodWatch
// ============================================================
// Statuses and thresholds aligned with PAGASA / model metadata:
//   Normal   → water < 1.2m  AND rain < 25 mm/hr
//   Warning  → water 1.2–2.0m OR rain 25–60 mm/hr (with rising trend)
//   Critical → water > 2.0m  AND/OR rain > 60 mm/hr sustained
// Source: backend/model/metadata.json

// ALL coordinates sourced directly from PhilAtlas.com (official PH geographic data)
// Source: philatlas.com/visayas/r07/cebu/talisay/[barangay-name].html

const BARANGAYS = [
  // name          lat        lng       status      rain  water  risk
  // risk scores computed by calcRisk() = round((min(rain/100,1)*0.45 + min(water/3,1)*0.55)*100)
  { name: "Poblacion",  lat: 10.2428, lng: 123.8477, status: "critical", rain: 72,  water: 2.8, risk: 84 },
  { name: "Tabunok",    lat: 10.2633, lng: 123.8411, status: "critical", rain: 65,  water: 2.6, risk: 77 },
  { name: "Cansojong",  lat: 10.2495, lng: 123.8550, status: "warning",  rain: 38,  water: 1.7, risk: 48 },
  { name: "Linao",      lat: 10.2562, lng: 123.8190, status: "warning",  rain: 41,  water: 1.6, risk: 48 },
  { name: "Mohon",      lat: 10.2495, lng: 123.8256, status: "warning",  rain: 33,  water: 1.5, risk: 42 },
  { name: "Pooc",       lat: 10.2383, lng: 123.8242, status: "warning",  rain: 30,  water: 1.4, risk: 39 },
  { name: "San Roque",  lat: 10.2536, lng: 123.8610, status: "warning",  rain: 28,  water: 1.3, risk: 36 },
  { name: "Dumlog",     lat: 10.2448, lng: 123.8393, status: "normal",   rain: 20,  water: 0.9, risk: 26 },
  { name: "Camp IV",    lat: 10.3205, lng: 123.8205, status: "normal",   rain: 22,  water: 0.9, risk: 26 },
  { name: "Bulacao",    lat: 10.2693, lng: 123.8447, status: "normal",   rain: 18,  water: 0.8, risk: 23 },
  { name: "Lagtang",    lat: 10.2668, lng: 123.8342, status: "normal",   rain: 9,   water: 0.4, risk: 11 },
  { name: "Lawaan I",   lat: 10.2584, lng: 123.8227, status: "normal",   rain: 15,  water: 0.7, risk: 20 },
  { name: "Lawaan II",  lat: 10.2587, lng: 123.8345, status: "normal",   rain: 10,  water: 0.5, risk: 14 },
  { name: "Lawaan III", lat: 10.2651, lng: 123.8315, status: "normal",   rain: 11,  water: 0.5, risk: 14 },
  { name: "Maghaway",   lat: 10.2773, lng: 123.8164, status: "normal",   rain: 17,  water: 0.8, risk: 22 },
  { name: "Manipis",    lat: 10.3212, lng: 123.7862, status: "normal",   rain: 8,   water: 0.3, risk:  9 },
  { name: "Jaclupan",   lat: 10.3022, lng: 123.8167, status: "normal",   rain: 19,  water: 0.8, risk: 23 },
  { name: "San Isidro", lat: 10.2592, lng: 123.8403, status: "normal",   rain: 12,  water: 0.6, risk: 16 },
  { name: "Tangke",     lat: 10.2509, lng: 123.8610, status: "normal",   rain: 14,  water: 0.6, risk: 17 },
  { name: "Cadulawan",  lat: 10.2780, lng: 123.8388, status: "normal",   rain: 14,  water: 0.6, risk: 17 },
  { name: "Tapul",      lat: 10.3004, lng: 123.7994, status: "normal",   rain: 16,  water: 0.7, risk: 20 },
  { name: "Biasong",    lat: 10.2377, lng: 123.8283, status: "normal",   rain: 13,  water: 0.6, risk: 17 },
];

// ── PAGASA threshold helper (used by home.js and map.js) ──────────────────────
// Keeps status classification consistent with the trained model's thresholds.
function classifyStatus(rain, water) {
  if (water > 2.0 || rain > 60) return "critical";
  if (water >= 1.2 || rain >= 25) return "warning";
  return "normal";
}

// ── Re-derive statuses so they always match thresholds ────────────────────────
BARANGAYS.forEach(b => {
  b.status = classifyStatus(b.rain, b.water);
});

const FLOOD_EVENTS_BY_YEAR = {
  labels: ["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024"],
  data:   [2, 3, 4, 3, 3, 5, 9, 4, 6, 7]
};

const FLOOD_BY_MONTH = {
  labels: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
  data:   [1, 0, 0, 0, 2, 4, 6, 8, 7, 5, 4, 5]
};

const RAINFALL_2024 = {
  labels:  ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
  rainfall: [45, 30, 20, 15, 80, 140, 180, 210, 190, 150, 130, 110],
  floods:   [0,  0,  0,  0,  1,   1,   2,   2,   1,   0,   0,   0]
};

const MAJOR_EVENTS = [
  {
    date: "December 2021",
    name: "Typhoon Odette",
    level: "critical",
    desc: "Severe flooding across 18 barangays. Poblacion and Tabunok recorded water levels exceeding 3 meters. 9 major inundation events. Significant infrastructure and property damage.",
    barangays: 18
  },
  {
    date: "August 2023",
    name: "Southwest Monsoon Surge",
    level: "warning",
    desc: "Prolonged rainfall over 72 hours caused riverbank overflow in coastal barangays. 6 barangays reached warning level. 3 days of sustained elevated water levels.",
    barangays: 6
  },
  {
    date: "September 2020",
    name: "Typhoon Quinta",
    level: "warning",
    desc: "Moderate flooding in low-lying barangays near the coast. Flash flooding reported in upland areas due to rapid runoff from elevated terrain.",
    barangays: 5
  },
  {
    date: "November 2024",
    name: "Northeast Monsoon",
    level: "warning",
    desc: "Flash flooding in upland barangays from elevated terrain runoff. 7 barangays reached warning level over a 48-hour period.",
    barangays: 7
  }
];

const MOST_AFFECTED = [
  { name: "Poblacion",  count: 12 },
  { name: "Tabunok",    count: 10 },
  { name: "Pooc",       count: 8  },
  { name: "Linao",      count: 7  },
  { name: "San Roque",  count: 6  },
  { name: "Mohon",      count: 5  },
  { name: "Dumlog",     count: 4  },
];

// Clock utility — used across all pages
function startClock() {
  const el = document.getElementById("clock");
  if (!el) return;
  function update() {
    const now = new Date();
    el.textContent = now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  update();
  setInterval(update, 1000);
}
startClock();
