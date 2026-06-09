// liveData.js — shared live-data module for FloodWatch
// Strategy:
//   1. Connect to /stream (Server-Sent Events) — instant push on every backend refresh
//   2. If SSE is unavailable, fall back to polling /barangays every POLL_MS
//   3. If backend is offline, serve from static BARANGAYS (data.js)
//
// Usage (in any page script):
//   FloodWatch.onDataUpdate((barangays, meta) => { /* re-render */ });
//   FloodWatch.refreshNow();         // force a manual poll
//   FloodWatch.isBackendUp();        // true/false
//   FloodWatch.secondsUntilRefresh() // countdown seconds

const API_BASE = window.API_BASE || 'http://localhost:5000';
const POLL_MS  = 30_000;   // fallback poll interval when SSE unavailable

let _cache       = null;
let _meta        = { source: 'static', lastFetch: null, fetchError: null };
let _listeners   = [];
let _backendUp   = false;
let _nextRefresh = null;
let _sseActive   = false;

// ── Public API ───────────────────────────────────────────────────────────────

function onDataUpdate(fn) {
  _listeners.push(fn);
  if (_cache) fn(_cache, _meta);
}

async function refreshNow() {
  await _fetchHTTP();
}

function isBackendUp()        { return _backendUp; }
function secondsUntilRefresh() {
  if (!_nextRefresh) return 0;
  return Math.max(0, Math.round((_nextRefresh - Date.now()) / 1000));
}

// ── SSE ──────────────────────────────────────────────────────────────────────

function _connectSSE() {
  if (!window.EventSource) { _startPolling(); return; }

  const es = new EventSource(`${API_BASE}/stream`);

  es.onopen = () => {
    _backendUp  = true;
    _sseActive  = true;
  };

  es.onmessage = (e) => {
    try {
      const json = JSON.parse(e.data);
      _applyPayload(json, 'open-meteo');
      _nextRefresh = new Date(Date.now() + 15 * 60 * 1000); // backend refreshes every 15 min
    } catch (_) {}
  };

  es.onerror = () => {
    _backendUp = false;
    _sseActive = false;
    es.close();
    // Fall back to HTTP polling
    if (!_cache) _useStaticFallback();
    _notify();
    setTimeout(_startPolling, 5000); // retry poll after 5 s
  };
}

// ── HTTP polling fallback ────────────────────────────────────────────────────

let _pollTimer = null;

function _startPolling() {
  if (_pollTimer) return;   // already polling
  _fetchHTTP();
  _pollTimer = setInterval(_fetchHTTP, POLL_MS);
}

async function _fetchHTTP() {
  try {
    const res = await fetch(`${API_BASE}/barangays`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    _backendUp = true;
    _applyPayload(json, json.barangays?.[0]?.source || 'backend');
    _nextRefresh = new Date(Date.now() + POLL_MS);
    // If SSE just came back, switch to it
    if (!_sseActive) { clearInterval(_pollTimer); _pollTimer = null; _connectSSE(); }
  } catch (err) {
    _backendUp = false;
    _meta.fetchError = err.message;
    if (!_cache) _useStaticFallback();
    _nextRefresh = new Date(Date.now() + POLL_MS);
    _notify();
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function _applyPayload(json, sourceHint) {
  if (!json.barangays?.length) return;
  _cache = json.barangays.map(b => ({
    ...b,
    status: classifyStatus(b.rain, b.water),
    risk:   b.risk ?? calcRisk(b.rain, b.water),
  }));
  _meta = {
    source:     sourceHint,
    lastFetch:  json.last_fetch || new Date().toISOString(),
    fetchError: null,
  };
  _notify();
}

function _useStaticFallback() {
  _cache = BARANGAYS.map(b => ({
    ...b,
    status: classifyStatus(b.rain, b.water),
    risk:   b.risk ?? calcRisk(b.rain, b.water),
  }));
  _meta = { source: 'static', lastFetch: null, fetchError: 'Backend offline' };
}

function _notify() {
  _listeners.forEach(fn => fn(_cache, _meta));
}

function calcRisk(rain, water) {
  return Math.round((Math.min(rain / 100, 1) * 0.45 + Math.min(water / 3, 1) * 0.55) * 100);
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function _boot() {
  // Show static data instantly while we wait for backend
  _useStaticFallback();
  _notify();
  // Then try SSE (will fall back to poll if unavailable)
  _connectSSE();
}

// Scripts are loaded at the end of <body>, so DOMContentLoaded may have already
// fired by the time this script runs. Guard against that race condition.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _boot);
} else {
  _boot();
}

window.FloodWatch = { onDataUpdate, refreshNow, isBackendUp, secondsUntilRefresh };
