// predict.js v8 — live autofill, sequence preview, probability display

const API_BASE = window.API_BASE || 'http://localhost:5000';
let backendOnline = false;
let liveBarangays = {};   // name → {rain, water, risk, status, rain_6hr}
let selectedBrgy  = '';

// ── Boot ────────────────────────────────────────────────────────────────────
function _bootPredict() {
  populateDropdowns();
  checkBackend();
  // Subscribe to live data updates (from liveData.js)
  FloodWatch.onDataUpdate((barangays) => {
    barangays.forEach(b => { liveBarangays[b.name] = b; });
    refreshQuickList();
    if (selectedBrgy) autofillFromLive(selectedBrgy);
  });
}

// Scripts are at the end of <body>; DOMContentLoaded may have already fired.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootPredict);
} else {
  _bootPredict();
}

// ── Dropdowns ───────────────────────────────────────────────────────────────
function populateDropdowns() {
  ['sel-brgy', 'sel-brgy-manual'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    BARANGAYS.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.name; opt.textContent = b.name;
      sel.appendChild(opt);
    });
  });
}

// ── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
}

// ── Quick-select barangay list ───────────────────────────────────────────────
function refreshQuickList() {
  const list = document.getElementById('brgy-quick-list');
  if (!list) return;
  list.innerHTML = '';
  const statusColors = { normal:'#1D9E75', warning:'#e6a817', critical:'#d63031' };
  BARANGAYS.forEach(b => {
    const live = liveBarangays[b.name] || b;
    const btn  = document.createElement('button');
    btn.className = 'brgy-quick-btn';
    btn.innerHTML = `
      <span>${b.name}</span>
      <span style="display:flex;align-items:center;gap:5px">
        <span style="font-size:11px;color:var(--color-text-secondary)">${live.rain ?? '—'} mm</span>
        <span class="bq-status" style="background:${statusColors[live.status]||'#ccc'}"></span>
      </span>`;
    btn.onclick = () => {
      document.getElementById('sel-brgy').value = b.name;
      onBrgyChange(b.name);
    };
    list.appendChild(btn);
  });
}

// ── Barangay selected ────────────────────────────────────────────────────────
function onBrgyChange(name) {
  selectedBrgy = name;
  // Sync both dropdowns
  ['sel-brgy','sel-brgy-manual'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = name;
  });
  if (name) autofillFromLive(name);
}

function autofillFromLive(name) {
  const live = liveBarangays[name];
  if (!live) return;

  // Fill inputs
  document.getElementById('inp-rain').value  = live.rain  ?? '';
  document.getElementById('inp-water').value = live.water ?? '';

  // Show banner
  const banner = document.getElementById('autofill-banner');
  const src    = live.source === 'open-meteo' ? 'Open-Meteo live data' : 'static fallback data';
  document.getElementById('autofill-msg').textContent =
    `Readings auto-filled from ${src} · ${live.rain} mm/hr rainfall · ${live.water}m estimated water level`;
  banner.classList.add('show');

  // Show weather strip
  const strip = document.getElementById('weather-strip');
  strip.style.display = 'grid';
  document.getElementById('ws-rain').textContent   = (live.rain ?? '—') + ' mm';
  document.getElementById('ws-water').textContent  = (live.water ?? '—') + ' m';
  document.getElementById('ws-risk').textContent   = (live.risk ?? '—') + '%';
  const statusLabels = { normal:'Normal', warning:'Warning', critical:'Critical' };
  const statusColors = { normal:'#085041', warning:'#854F0B', critical:'#A32D2D' };
  const statusBgs    = { normal:'#E1F5EE', warning:'#FAEEDA', critical:'#FCEBEB' };
  const s = live.status || 'normal';
  const wsStatus = document.getElementById('ws-status');
  wsStatus.textContent = statusLabels[s] || s;
  wsStatus.style.color = statusColors[s] || '';
  wsStatus.closest('.w-cell').style.background = statusBgs[s] || '';

  // Auto-set trend based on rain_6hr
  if (live.rain_6hr && live.rain_6hr.length >= 2) {
    const first = live.rain_6hr[0], last = live.rain_6hr[live.rain_6hr.length-1];
    const diff  = last - first;
    let trend = 'steady';
    if (diff >  20) trend = 'rapid';
    else if (diff > 5) trend = 'increasing';
    else if (diff < -5) trend = 'decreasing';
    document.getElementById('inp-trend').value = trend;
    if (live.rain_6hr.some(r => r > 0)) {
      document.getElementById('inp-soil').value = diff > 10 ? 'saturated' : 'moist';
    }
  }

  updateSeqPreview(live.rain_6hr);
}

// ── Sequence preview bars ────────────────────────────────────────────────────
function updateSeqPreview(rain6hr) {
  const rain  = parseFloat(document.getElementById('inp-rain').value);
  const trend = document.getElementById('inp-trend').value;

  let seq = rain6hr;
  if (!seq || !seq.length) {
    if (isNaN(rain)) { document.getElementById('seq-preview').classList.remove('show'); return; }
    const factors = { decreasing:[-0.15,-0.10,-0.05,0,0.02,0], steady:[-0.05,-0.02,0,0.02,0,0], increasing:[-0.20,-0.12,-0.06,0,0.08,0.15], rapid:[-0.35,-0.25,-0.15,-0.05,0.10,0.25] };
    const f = factors[trend] || factors.steady;
    seq = f.map(x => Math.max(0, rain * (1 + x)));
  }

  const preview  = document.getElementById('seq-preview');
  const barsEl   = document.getElementById('seq-bars');
  const labelsEl = document.getElementById('seq-labels');
  preview.classList.add('show');
  barsEl.innerHTML = '';
  labelsEl.innerHTML = '';

  const maxVal = Math.max(...seq, 1);
  const hours  = ['−5h','−4h','−3h','−2h','−1h','Now'];
  seq.forEach((v, i) => {
    const pct  = Math.round((v / maxVal) * 100);
    const color = v > 60 ? '#d63031' : v > 25 ? '#e6a817' : '#1D9E75';
    const bar  = document.createElement('div');
    bar.className = 'seq-bar';
    bar.style.cssText = `height:${Math.max(pct,4)}%;background:${color}`;
    bar.title = `${hours[i]}: ${v.toFixed(1)} mm/hr`;
    barsEl.appendChild(bar);
    const lbl = document.createElement('div');
    lbl.className = 'seq-lbl';
    lbl.textContent = hours[i];
    labelsEl.appendChild(lbl);
  });
}

// ── Backend status ───────────────────────────────────────────────────────────
async function checkBackend() {
  const bar = document.getElementById('backend-status');
  try {
    const res  = await fetch(`${API_BASE}/status`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    backendOnline = true;
    const src = data.data_source === 'open-meteo' ? '🟢 Backend · Live Open-Meteo data' : '🟢 Backend connected';
    bar.style.cssText = 'padding:8px 14px;border-radius:8px;font-size:12px;margin-bottom:12px;background:#E1F5EE;color:#085041;display:flex;align-items:center;gap:8px';
    bar.innerHTML = `<span style="font-size:9px">●</span> ${src} · Last fetch: ${data.last_fetch ? new Date(data.last_fetch).toLocaleTimeString('en-PH') : 'pending'}`;
  } catch {
    backendOnline = false;
    bar.style.cssText = 'padding:8px 14px;border-radius:8px;font-size:12px;margin-bottom:12px;background:#FFF8E1;color:#7A5800;display:flex;align-items:center;gap:8px';
    bar.innerHTML = '<span style="font-size:9px">●</span> 🟡 Backend offline — using formula fallback';
  }
}

// ── Run prediction ───────────────────────────────────────────────────────────
async function runPrediction() {
  const brgy   = selectedBrgy || document.getElementById('sel-brgy').value;
  const rain   = parseFloat(document.getElementById('inp-rain').value);
  const water  = parseFloat(document.getElementById('inp-water').value);
  const soil   = document.getElementById('inp-soil').value;
  const trend  = document.getElementById('inp-trend').value;
  const window = document.getElementById('inp-window').value;

  if (!brgy)             return alert('Please select a barangay.');
  if (isNaN(rain)||rain<0)  return alert('Please enter a valid rainfall value (mm/hr).');
  if (isNaN(water)||water<0) return alert('Please enter a valid water level (meters).');

  const btn = document.querySelector('.btn-primary.full-width');
  btn.textContent = 'Predicting…'; btn.disabled = true;

  try {
    const result = backendOnline
      ? await predictFromBackend(brgy, rain, water, soil, trend, window)
      : predictFromFormula(brgy, rain, water, soil, trend, window);
    displayResult(result, brgy, rain, water, window);
  } catch (err) {
    alert('Prediction failed: ' + err.message);
  } finally {
    btn.textContent = 'Run prediction'; btn.disabled = false;
  }
}

async function predictFromBackend(brgy, rain, water, soil, trend, windowH) {
  const res = await fetch(`${API_BASE}/predict/simple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barangay:brgy, rain, water, soil, trend, forecast_hrs:parseInt(windowH) })
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error||'Backend error'); }
  const d = await res.json();
  return { level:d.level, risk_score:d.risk_score, confidence:d.confidence,
           action:d.action, probabilities:d.probabilities,
           sequence:d.sequence_used, source:'LSTM model (backend)' };
}

function predictFromFormula(brgy, rain, water, soil, trend, windowH) {
  let s = 0;
  s += Math.min((rain/100)*45, 45);
  s += Math.min((water/4)*35, 35);
  if (soil==='moist') s+=5; if (soil==='saturated') s+=12;
  if (trend==='increasing') s+=5; if (trend==='rapid') s+=15; if (trend==='decreasing') s-=8;
  if (windowH==='6') s+=5;
  s = Math.min(Math.max(Math.round(s),0),100);
  const level = s>=75?'Critical':s>=45?'Warning':'Normal';
  return { level, risk_score:s, confidence:null, action:{ Critical:'Activate emergency response. Coordinate with CDRRMO Talisay.', Warning:'Alert barangay officials. Pre-position evacuation teams.', Normal:'Continue routine monitoring.' }[level], probabilities:null, sequence:null, source:'Formula fallback (backend offline)' };
}

// ── Display result ───────────────────────────────────────────────────────────
function displayResult(result, brgy, rain, water, windowH) {
  document.getElementById('result-placeholder').style.display = 'none';
  const card = document.getElementById('result-card');
  card.style.display = 'block';

  const C = { Normal:{bg:'#E1F5EE',txt:'#085041',bar:'#1D9E75',border:'#5DCAA5'}, Warning:{bg:'#FAEEDA',txt:'#854F0B',bar:'#e6a817',border:'#EF9F27'}, Critical:{bg:'#FCEBEB',txt:'#A32D2D',bar:'#d63031',border:'#F09595'} };
  const c = C[result.level];

  document.getElementById('result-header').style.background = c.bg;
  document.getElementById('result-level').style.color = c.txt;
  document.getElementById('result-level').textContent = {Critical:'Critical — Immediate evacuation advised',Warning:'Warning — Prepare for possible evacuation',Normal:'Normal — No immediate flood risk'}[result.level];
  document.getElementById('result-brgy').textContent = `${brgy} · ${windowH}-hour forecast · ${result.source}`;
  document.getElementById('result-desc').textContent = {
    Critical:`${brgy} is at HIGH flood risk in the next ${windowH} hours. Rainfall ${rain} mm/hr and estimated water level ${water}m exceed critical thresholds.`,
    Warning:`${brgy} shows ELEVATED flood risk. Conditions may worsen within ${windowH} hours. Current rain: ${rain} mm/hr, water: ${water}m.`,
    Normal:`${brgy} is within SAFE parameters for the next ${windowH} hours. Rain: ${rain} mm/hr, water: ${water}m — below warning thresholds.`
  }[result.level];

  document.getElementById('r-rain').textContent  = rain + ' mm/hr';
  document.getElementById('r-water').textContent = water + ' m';
  document.getElementById('r-risk').textContent  = result.risk_score + '%';
  document.getElementById('r-window').textContent = windowH + ' hrs';
  document.getElementById('risk-pct').textContent = result.risk_score + '%';
  const bar = document.getElementById('risk-bar');
  bar.style.width = result.risk_score + '%'; bar.style.background = c.bar;

  // Probability breakdown
  const probRow = document.getElementById('prob-row');
  if (result.probabilities) {
    probRow.style.display = 'grid';
    document.getElementById('pb-normal').textContent   = result.probabilities.Normal   + '%';
    document.getElementById('pb-warning').textContent  = result.probabilities.Warning  + '%';
    document.getElementById('pb-critical').textContent = result.probabilities.Critical + '%';
  } else {
    probRow.style.display = 'none';
  }

  // Action box
  const ab = document.getElementById('action-box');
  ab.style.background = c.bg; ab.style.borderColor = c.border;
  document.getElementById('action-text').textContent = result.action;

  // Sequence used (from backend)
  const seqUsed = document.getElementById('seq-used');
  if (result.sequence) {
    seqUsed.style.display = 'block';
    document.getElementById('seq-used-content').textContent =
      'Rain: [' + result.sequence.rain_sequence.join(', ') + '] mm/hr\n' +
      'Water: [' + result.sequence.water_sequence.join(', ') + '] m';
  } else {
    seqUsed.style.display = 'none';
  }

  card.scrollIntoView({ behavior:'smooth', block:'start' });
}
