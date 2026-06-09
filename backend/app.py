"""
app.py — FloodWatch Talisay Backend API (with Open-Meteo live data)
====================================================================
Now fetches REAL rainfall data from Open-Meteo every 15 minutes.
Water levels are estimated via a rational method (see pagasa_fetcher.py).

HOW TO RUN:
    Step 1: pip install -r requirements.txt
    Step 2: python train_model.py     (only once)
    Step 3: python app.py             (starts server + background fetcher)
    Step 4: Open your website

API ENDPOINTS:
    GET  /status           → Server health + last fetch time
    GET  /barangays        → All 22 barangays with live rain/water/status/risk
    POST /barangays/update → Override readings with your own data (e.g. PAG-ASA CSV)
    POST /predict          → Run flood risk prediction (6-hour sequence)
    POST /predict/simple   → Run prediction from a single current reading
"""

from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import pickle, json, numpy as np, os, logging, threading, time, queue
from datetime import datetime, timezone
from pagasa_fetcher import (
    fetch_all_barangays,
    BARANGAY_COORDS,
    REFRESH_INTERVAL_MIN,
)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ─── MODEL ────────────────────────────────────────────────────────────────────
MODEL    = None
SCALER   = None
METADATA = None

def load_model():
    global MODEL, SCALER, METADATA
    try:
        with open("model/flood_model.pkl", "rb") as f:
            MODEL = pickle.load(f)
        with open("model/scaler_params.json") as f:
            SCALER = json.load(f)
        with open("model/metadata.json") as f:
            METADATA = json.load(f)
        logger.info("Model loaded successfully")
        return True
    except FileNotFoundError:
        logger.warning("Model not found — run train_model.py first")
        return False

# ─── LIVE DATA STORE ──────────────────────────────────────────────────────────
# Shared mutable state updated by the background thread.
# Protected by a lock so reads and writes are thread-safe.

_data_lock   = threading.Lock()
_last_fetch  = None          # datetime of last successful Open-Meteo fetch
_fetch_error = None          # last error message if fetch failed
_sse_clients: list[queue.Queue] = []   # one Queue per connected SSE client
_sse_lock    = threading.Lock()

def classify_status(rain: float, water: float) -> str:
    """Matches metadata.json thresholds and data.js classifyStatus()."""
    if water > 2.0 or rain > 60:
        return "critical"
    if water >= 1.2 or rain >= 25:
        return "warning"
    return "normal"

def calc_risk(rain: float, water: float) -> int:
    r = min(rain / 100.0, 1.0)
    w = min(water / 3.0,  1.0)
    return round((r * 0.45 + w * 0.55) * 100)

# Initialise from static fallback values (same as old data.js)
# These are overwritten on first successful Open-Meteo fetch.
_STATIC_FALLBACK = [
    ("Poblacion",   10.2428, 123.8477,  72,  2.8),
    ("Tabunok",     10.2633, 123.8411,  65,  2.6),
    ("Cansojong",   10.2495, 123.8550,  38,  1.7),
    ("Linao",       10.2562, 123.8190,  41,  1.6),
    ("Mohon",       10.2495, 123.8256,  33,  1.5),
    ("Pooc",        10.2383, 123.8242,  30,  1.4),
    ("San Roque",   10.2536, 123.8610,  28,  1.3),
    ("Dumlog",      10.2448, 123.8393,  20,  0.9),
    ("Camp IV",     10.3205, 123.8205,  22,  0.9),
    ("Bulacao",     10.2693, 123.8447,  18,  0.8),
    ("Lagtang",     10.2668, 123.8342,   9,  0.4),
    ("Lawaan I",    10.2584, 123.8227,  15,  0.7),
    ("Lawaan II",   10.2587, 123.8345,  10,  0.5),
    ("Lawaan III",  10.2651, 123.8315,  11,  0.5),
    ("Maghaway",    10.2773, 123.8164,  17,  0.8),
    ("Manipis",     10.3212, 123.7862,   8,  0.3),
    ("Jaclupan",    10.3022, 123.8167,  19,  0.8),
    ("San Isidro",  10.2592, 123.8403,  12,  0.6),
    ("Tangke",      10.2509, 123.8610,  14,  0.6),
    ("Cadulawan",   10.2780, 123.8388,  14,  0.6),
    ("Tapul",       10.3004, 123.7994,  16,  0.7),
    ("Biasong",     10.2377, 123.8283,  13,  0.6),
]

BARANGAY_DATA = {
    name: {
        "lat":      lat,
        "lng":      lng,
        "rain":     rain,
        "rain_6hr": [rain] * 6,
        "water":    water,
        "status":   classify_status(rain, water),
        "risk":     calc_risk(rain, water),
        "source":   "static-fallback",
        "fetched_at": None,
    }
    for name, lat, lng, rain, water in _STATIC_FALLBACK
}

# ─── BACKGROUND REFRESH ───────────────────────────────────────────────────────

def _apply_live_readings(live: dict):
    """Merge Open-Meteo results into BARANGAY_DATA. Called inside lock."""
    global _last_fetch
    for name, reading in live.items():
        if name in BARANGAY_DATA:
            rain  = reading["rain"]
            water = reading["water"]
            BARANGAY_DATA[name].update({
                "rain":       rain,
                "rain_6hr":   reading.get("rain_6hr", [rain] * 6),
                "water":      water,
                "status":     classify_status(rain, water),
                "risk":       calc_risk(rain, water),
                "source":     "open-meteo",
                "fetched_at": reading.get("fetched_at"),
            })
    _last_fetch = datetime.now(timezone.utc)
    logger.info(f"Live data applied for {len(live)} barangays at {_last_fetch.isoformat()}")
    # Push update to all SSE clients
    _push_sse_event()


def _push_sse_event():
    """Build barangay JSON and push to every connected SSE client."""
    payload = [
        {
            "name":   name,
            "lat":    d["lat"], "lng": d["lng"],
            "rain":   d["rain"], "water": d["water"],
            "status": d["status"], "risk": d["risk"],
            "source": d["source"], "fetched_at": d["fetched_at"],
        }
        for name, d in BARANGAY_DATA.items()
    ]
    msg = f"data: {json.dumps({'barangays': payload, 'last_fetch': _last_fetch.isoformat() if _last_fetch else None})}\n\n"
    dead = []
    with _sse_lock:
        for q in _sse_clients:
            try:
                q.put_nowait(msg)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)


def _refresh_loop():
    """Background thread: fetch Open-Meteo every REFRESH_INTERVAL_MIN minutes."""
    global _fetch_error
    # First fetch immediately on startup
    while True:
        try:
            logger.info("Fetching live rainfall from Open-Meteo...")
            live = fetch_all_barangays()
            if live:
                with _data_lock:
                    _apply_live_readings(live)
                    _fetch_error = None
            else:
                _fetch_error = "All fetches failed"
                logger.warning("No barangays updated — network issue?")
        except Exception as e:
            _fetch_error = str(e)
            logger.error(f"Refresh loop error: {e}")

        time.sleep(REFRESH_INTERVAL_MIN * 60)


def start_background_refresh():
    t = threading.Thread(target=_refresh_loop, daemon=True)
    t.start()
    logger.info(f"Background refresh started (every {REFRESH_INTERVAL_MIN} min)")

# ─── HELPERS ──────────────────────────────────────────────────────────────────

def preprocess_input(rain_seq, water_seq):
    rain_max  = SCALER["rain_max"]
    water_max = SCALER["water_max"]
    sequence  = [[r / rain_max, w / water_max]
                 for r, w in zip(rain_seq, water_seq)]
    return np.array([sequence], dtype=np.float32)


def classify_risk_proba(probabilities):
    class_names = ["Normal", "Warning", "Critical"]
    pred_idx    = int(np.argmax(probabilities))
    confidence  = float(probabilities[pred_idx])
    level       = class_names[pred_idx]
    risk_score  = round(
        (0 * probabilities[0] + 50 * probabilities[1] + 100 * probabilities[2]), 1
    )
    actions = {
        "Normal":   "Continue routine monitoring. Update readings every hour during active rainfall.",
        "Warning":  "Alert barangay officials. Pre-position evacuation teams. Monitor every 30 minutes.",
        "Critical": "Activate emergency response immediately. Coordinate with CDRRMO Talisay. Assist evacuation of low-lying areas.",
    }
    colors = {"Normal": "#1D9E75", "Warning": "#e6a817", "Critical": "#d63031"}
    return {
        "level":         level,
        "confidence":    round(confidence * 100, 1),
        "risk_score":    risk_score,
        "action":        actions[level],
        "color":         colors[level],
        "probabilities": {
            "Normal":   round(float(probabilities[0]) * 100, 1),
            "Warning":  round(float(probabilities[1]) * 100, 1),
            "Critical": round(float(probabilities[2]) * 100, 1),
        },
    }

# ─── ROUTES ───────────────────────────────────────────────────────────────────

@app.route("/stream", methods=["GET"])
def stream():
    """
    Server-Sent Events endpoint. Browsers connect once and receive a push
    every time the background refresh fetches new data from Open-Meteo.
    Event format:  data: {barangays: [...], last_fetch: "..."}
    """
    client_q: queue.Queue = queue.Queue(maxsize=5)
    with _sse_lock:
        _sse_clients.append(client_q)

    def generate():
        # Send current snapshot immediately on connect
        with _data_lock:
            payload = [
                {
                    "name":   name,
                    "lat":    d["lat"], "lng": d["lng"],
                    "rain":   d["rain"], "water": d["water"],
                    "status": d["status"], "risk": d["risk"],
                    "source": d["source"], "fetched_at": d["fetched_at"],
                }
                for name, d in BARANGAY_DATA.items()
            ]
            last = _last_fetch.isoformat() if _last_fetch else None
        yield f"data: {json.dumps({'barangays': payload, 'last_fetch': last})}\n\n"

        try:
            while True:
                try:
                    msg = client_q.get(timeout=30)  # 30-s keepalive
                    yield msg
                except queue.Empty:
                    yield ": keepalive\n\n"  # SSE comment keeps connection alive
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                if client_q in _sse_clients:
                    _sse_clients.remove(client_q)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/status", methods=["GET"])
def status():
    with _data_lock:
        last = _last_fetch.isoformat() if _last_fetch else "not yet fetched"
        sources = {d["source"] for d in BARANGAY_DATA.values()}
    return jsonify({
        "status":        "online",
        "model":         "loaded" if MODEL else "not loaded",
        "barangays":     len(BARANGAY_DATA),
        "data_source":   "open-meteo" if "open-meteo" in sources else "static-fallback",
        "last_fetch":    last,
        "fetch_error":   _fetch_error,
        "refresh_every": f"{REFRESH_INTERVAL_MIN} minutes",
        "timestamp":     datetime.now(timezone.utc).isoformat(),
        "version":       "2.0.0 — FloodWatch Talisay (Open-Meteo live)",
    })


@app.route("/barangays", methods=["GET"])
def get_barangays():
    """Returns all 22 barangays with live rain, water, status, risk from Open-Meteo."""
    with _data_lock:
        barangays = []
        for name, d in BARANGAY_DATA.items():
            barangays.append({
                "name":       name,
                "lat":        d["lat"],
                "lng":        d["lng"],
                "rain":       d["rain"],
                "rain_6hr":   d["rain_6hr"],
                "water":      d["water"],
                "status":     d["status"],
                "risk":       d["risk"],
                "source":     d["source"],
                "fetched_at": d["fetched_at"],
            })
        last = _last_fetch.isoformat() if _last_fetch else None

    return jsonify({
        "barangays": barangays,
        "count":     len(barangays),
        "last_fetch": last,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


@app.route("/barangays/update", methods=["POST"])
def update_barangays():
    """
    Override readings for specific barangays (e.g. from real PAG-ASA CSV).
    POST a JSON array: [{"name": "Poblacion", "rain": 55, "water": 2.1}, ...]
    Status and risk are auto-derived. Source is set to 'manual-override'.
    """
    updates = request.get_json()
    if not updates or not isinstance(updates, list):
        return jsonify({"error": "Expected JSON array of {name, rain, water}"}), 400

    updated, errors = [], []
    with _data_lock:
        for item in updates:
            name  = item.get("name")
            rain  = item.get("rain")
            water = item.get("water")
            if name not in BARANGAY_DATA:
                errors.append(f"Unknown barangay: {name}")
                continue
            if rain is None or water is None:
                errors.append(f"Missing rain or water for: {name}")
                continue
            rain, water = float(rain), float(water)
            BARANGAY_DATA[name].update({
                "rain":       rain,
                "water":      water,
                "status":     classify_status(rain, water),
                "risk":       calc_risk(rain, water),
                "source":     "manual-override",
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            })
            updated.append(name)

    return jsonify({
        "updated":   updated,
        "errors":    errors,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


@app.route("/predict", methods=["POST"])
def predict():
    if MODEL is None:
        return jsonify({"error": "Model not loaded. Run train_model.py first."}), 503

    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    for field in ["barangay", "rain_sequence", "water_sequence"]:
        if field not in data:
            return jsonify({"error": f"Missing field: {field}"}), 400

    rain_seq  = data["rain_sequence"]
    water_seq = data["water_sequence"]

    if len(rain_seq) != 6 or len(water_seq) != 6:
        return jsonify({"error": "rain_sequence and water_sequence must each have 6 values"}), 400

    X      = preprocess_input(rain_seq, water_seq)
    X_flat = X.reshape(1, -1)
    probs  = MODEL.predict_proba(X_flat)[0]
    result = classify_risk_proba(probs)

    return jsonify({
        "barangay":      data["barangay"],
        "forecast_hrs":  data.get("forecast_hours", 3),
        "level":         result["level"],
        "risk_score":    result["risk_score"],
        "confidence":    result["confidence"],
        "action":        result["action"],
        "color":         result["color"],
        "probabilities": result["probabilities"],
        "inputs": {
            "rain_current":  rain_seq[-1],
            "water_current": water_seq[-1],
            "rain_avg_6hr":  round(sum(rain_seq) / 6, 1),
            "water_max_6hr": round(max(water_seq), 2),
            "trend":         "rising" if water_seq[-1] > water_seq[0] else "stable/falling",
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


@app.route("/predict/simple", methods=["POST"])
def predict_simple():
    if MODEL is None:
        return jsonify({"error": "Model not loaded."}), 503

    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    barangay = data.get("barangay", "Unknown")
    rain     = float(data.get("rain", 0))
    water    = float(data.get("water", 0))
    soil     = data.get("soil", "moist")
    trend    = data.get("trend", "steady")

    # If barangay has live data, use its actual 6-hour sequence
    with _data_lock:
        live = BARANGAY_DATA.get(barangay)

    if live and live.get("source") == "open-meteo" and live.get("rain_6hr"):
        rain_seq  = live["rain_6hr"]
        water_max = live["water"]
        water_seq = [max(0, water_max * (0.6 + 0.08 * i)) for i in range(6)]
    else:
        # Synthetic sequence from trend
        trend_factors = {
            "decreasing": [-0.15, -0.10, -0.05, 0.0,  0.02, 0.0],
            "steady":     [-0.05, -0.02,  0.0,  0.02, 0.0,  0.0],
            "increasing": [-0.20, -0.12, -0.06, 0.0,  0.08, 0.15],
            "rapid":      [-0.35, -0.25, -0.15,-0.05, 0.10, 0.25],
        }
        factors   = trend_factors.get(trend, trend_factors["steady"])
        rain_seq  = [max(0, rain  * (1 + f)) for f in factors]
        water_seq = [max(0, water * (1 + f * 0.5)) for f in factors]
        soil_adj  = {"dry": -0.1, "moist": 0.0, "saturated": 0.15}
        adj       = soil_adj.get(soil, 0)
        water_seq = [max(0, w + adj) for w in water_seq]

    X      = preprocess_input(rain_seq, water_seq)
    X_flat = X.reshape(1, -1)
    probs  = MODEL.predict_proba(X_flat)[0]
    result = classify_risk_proba(probs)

    return jsonify({
        "barangay":      barangay,
        "level":         result["level"],
        "risk_score":    result["risk_score"],
        "confidence":    result["confidence"],
        "action":        result["action"],
        "color":         result["color"],
        "probabilities": result["probabilities"],
        "sequence_used": {
            "rain_sequence":  [round(r, 1) for r in rain_seq],
            "water_sequence": [round(w, 2) for w in water_seq],
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


# ─── MAIN ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("  FloodWatch Talisay — Backend API v2.0")
    print("  Live rainfall: Open-Meteo (free, no key)")
    print("=" * 55)

    load_model()
    start_background_refresh()

    print(f"\nServer: http://localhost:5000")
    print(f"Data refreshes every {REFRESH_INTERVAL_MIN} minutes from Open-Meteo")
    print("\nEndpoints:")
    print("  GET  /status")
    print("  GET  /barangays        ← now returns LIVE rain/water")
    print("  POST /barangays/update ← override with PAG-ASA CSV data")
    print("  POST /predict/simple")
    print("  POST /predict")
    print("\nPress Ctrl+C to stop\n")

    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, port=port, host="0.0.0.0")
