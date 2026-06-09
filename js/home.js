// home.js v8

function _bootHome() {
  startClock();
  FloodWatch.onDataUpdate((barangays, meta) => {
    renderStats(barangays);
    renderAlerts(barangays);
    renderTicker(barangays, meta);
    renderWeatherSummary(barangays, meta);
  });
  startCountdown();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootHome);
} else {
  _bootHome();
}

function renderStats(barangays) {
  const counts = { normal:0, warning:0, critical:0 };
  barangays.forEach(b => counts[b.status]++);
  document.getElementById('stat-normal').textContent   = counts.normal;
  document.getElementById('stat-warning').textContent  = counts.warning;
  document.getElementById('stat-critical').textContent = counts.critical;
  const cnt = document.getElementById('alert-count');
  cnt.textContent = counts.critical > 0 ? `${counts.critical} critical` : counts.warning > 0 ? `${counts.warning} warning` : 'All clear';
  cnt.style.background = counts.critical > 0 ? '#FCEBEB' : counts.warning > 0 ? '#FAEEDA' : '#E1F5EE';
  cnt.style.color      = counts.critical > 0 ? '#A32D2D' : counts.warning > 0 ? '#854F0B' : '#0F6E56';
}

function renderAlerts(barangays) {
  const grid = document.getElementById('alert-grid');
  grid.innerHTML = '';
  const alerts = barangays.filter(b => b.status !== 'normal')
    .sort((a,b) => (b.status==='critical'?1:0)-(a.status==='critical'?1:0));
  if (!alerts.length) {
    grid.innerHTML = '<div class="all-clear">✓ All barangays are currently at normal flood risk.</div>';
    return;
  }
  alerts.forEach(b => {
    const div = document.createElement('div');
    div.className = `alert-card alert-${b.status}`;
    div.innerHTML = `
      <div class="alert-card-left">
        <div class="alert-card-name">${b.name}</div>
        <div class="alert-card-info">Rain: ${b.rain} mm/hr &nbsp;|&nbsp; Water: ${b.water}m &nbsp;|&nbsp; Risk: ${b.risk}%</div>
      </div>
      <span class="status-badge badge-${b.status}">${cap(b.status)}</span>`;
    grid.appendChild(div);
  });
}

function renderTicker(barangays, meta) {
  const ticker = document.getElementById('ticker');
  ticker.innerHTML = '';
  barangays.slice(0,10).forEach(b => {
    const span = document.createElement('span');
    span.className = 'ticker-item';
    span.textContent = `${b.name}: ${b.rain} mm/hr`;
    ticker.appendChild(span);
  });
  const srcLabel = document.getElementById('data-source-label');
  if (srcLabel) srcLabel.textContent = meta.source === 'open-meteo' ? '· Open-Meteo live' : '· static data';
}

function renderWeatherSummary(barangays, meta) {
  const box = document.getElementById('weather-summary');
  if (!box) return;
  const maxRain  = Math.max(...barangays.map(b => b.rain));
  const avgRain  = (barangays.reduce((s,b)=>s+b.rain,0)/barangays.length).toFixed(1);
  const maxWater = Math.max(...barangays.map(b => b.water));
  const hotspot  = barangays.reduce((a,b)=> b.rain>a.rain?b:a, barangays[0]);
  const lastUp   = meta.lastFetch ? new Date(meta.lastFetch).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '—';
  box.innerHTML = `
    <div class="weather-grid">
      <div class="w-summary-cell">
        <div class="ws-val">${maxRain}</div>
        <div class="ws-lbl">Peak rainfall (mm/hr)</div>
        <div class="ws-sub">${hotspot.name}</div>
      </div>
      <div class="w-summary-cell">
        <div class="ws-val">${avgRain}</div>
        <div class="ws-lbl">City avg (mm/hr)</div>
        <div class="ws-sub">All 22 barangays</div>
      </div>
      <div class="w-summary-cell">
        <div class="ws-val">${maxWater}</div>
        <div class="ws-lbl">Max water level (m)</div>
        <div class="ws-sub">Estimated</div>
      </div>
      <div class="w-summary-cell">
        <div class="ws-val" style="font-size:13px">${lastUp}</div>
        <div class="ws-lbl">Last updated</div>
        <div class="ws-sub">${meta.source==='open-meteo'?'Open-Meteo':'Static'}</div>
      </div>
    </div>`;
}

function startCountdown() {
  const el = document.getElementById('refresh-countdown');
  if (!el) return;
  setInterval(() => {
    const s = FloodWatch.secondsUntilRefresh();
    el.textContent = s > 0 ? `· refresh in ${s}s` : '';
  }, 1000);
}

function cap(s) { return s.charAt(0).toUpperCase()+s.slice(1); }
