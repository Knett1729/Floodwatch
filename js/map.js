// map.js — Live Leaflet map with backend-driven updates

let map;
let _markerMap = {};   // name → { marker, status }
let _filterStatus = 'all';

const COLORS = {
  normal:   "#1D9E75",
  warning:  "#e6a817",
  critical: "#d63031",
};

function _bootMap() {
  // Init map centered on Talisay City
  map = L.map("map").setView([10.2401, 123.8445], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);

  // Render immediately from static data, then keep updating from live
  FloodWatch.onDataUpdate(renderMarkers);

  // Countdown on map toolbar
  _startMapCountdown();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootMap);
} else {
  _bootMap();
}

// ── Render / update all markers ──────────────────────────────────────────────
function renderMarkers(barangays, meta) {
  barangays.forEach(b => {
    if (_markerMap[b.name]) {
      _updateMarker(b);
    } else {
      _createMarker(b);
    }
  });

  // Update "Updated:" time in toolbar
  const timeEl = document.getElementById("map-time");
  if (timeEl) {
    const src  = meta.source === 'open-meteo' ? '● Live' : '● Static';
    const t    = new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    timeEl.innerHTML = `<span style="color:${meta.source === 'open-meteo' ? '#0F6E56' : '#999'}">${src}</span> · ${t}`;
  }

  // Re-apply current filter so newly-changed markers respect it
  _applyFilter(_filterStatus);
}

function _makeIcon(status) {
  const color = COLORS[status];
  return L.divIcon({
    className: "",
    html: `<div style="
      width:16px;height:16px;
      border-radius:50%;
      background:${color};
      border:2.5px solid white;
      box-shadow:0 1px 6px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function _popupHtml(b) {
  const color = COLORS[b.status];
  return `
    <div style="font-family:sans-serif;min-width:160px">
      <div style="font-weight:600;font-size:14px;margin-bottom:6px">${b.name}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <span style="background:${color};color:white;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:500">${capitalize(b.status)}</span>
      </div>
      <table style="font-size:12px;width:100%;border-collapse:collapse">
        <tr><td style="color:#888;padding:2px 0">Rainfall</td><td style="text-align:right;font-weight:500">${b.rain} mm/hr</td></tr>
        <tr><td style="color:#888;padding:2px 0">Water level</td><td style="text-align:right;font-weight:500">${b.water} m</td></tr>
        <tr><td style="color:#888;padding:2px 0">Risk score</td><td style="text-align:right;font-weight:500">${b.risk}%</td></tr>
      </table>
    </div>`;
}

function _createMarker(b) {
  const marker = L.marker([b.lat, b.lng], { icon: _makeIcon(b.status) })
    .bindPopup(_popupHtml(b), { maxWidth: 220 })
    .addTo(map);
  marker._barStatus = b.status;
  _markerMap[b.name] = marker;
}

function _updateMarker(b) {
  const marker = _markerMap[b.name];
  // Update icon only if status changed (avoids unnecessary DOM thrashing)
  if (marker._barStatus !== b.status) {
    marker.setIcon(_makeIcon(b.status));
    marker._barStatus = b.status;
  }
  // Always refresh popup content so rain/water/risk stay current
  marker.setPopupContent(_popupHtml(b));
}

// ── Filter ───────────────────────────────────────────────────────────────────
function filterMap(status, btn) {
  _filterStatus = status;
  document.querySelectorAll(".filter-btn").forEach(b => b.className = "filter-btn");
  btn.className = `filter-btn active-${status}`;
  _applyFilter(status);
}

function _applyFilter(status) {
  Object.values(_markerMap).forEach(marker => {
    if (status === "all" || marker._barStatus === status) {
      if (!map.hasLayer(marker)) marker.addTo(map);
    } else {
      map.removeLayer(marker);
    }
  });
}

// ── Countdown ────────────────────────────────────────────────────────────────
function _startMapCountdown() {
  const el = document.getElementById("map-countdown");
  if (!el) return;
  setInterval(() => {
    const secs = FloodWatch.secondsUntilRefresh();
    el.textContent = secs > 0 ? `Refreshes in ${secs}s` : "Refreshing…";
  }, 1000);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
