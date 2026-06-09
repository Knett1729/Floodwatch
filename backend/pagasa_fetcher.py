"""
pagasa_fetcher.py — Open-Meteo rainfall integration for FloodWatch Talisay
===========================================================================
Fetches real hourly precipitation data from Open-Meteo (free, no API key)
for each of the 22 Talisay barangays using their exact coordinates.

Open-Meteo is the best available public data source for Philippines rainfall.
It combines ECMWF, NOAA, and other national weather service models at up to
1 km resolution — updated every hour.

WATER LEVEL ESTIMATION
----------------------
PAG-ASA does not expose public water level data. We estimate it using a
simple rational method (standard in hydrology):

    water_level = base_level + k * accumulated_6hr_rain

Where:
  base_level = 0.3m (dry season baseline for coastal Talisay)
  k          = 0.018  (runoff coefficient tuned to Talisay terrain)
  accumulated_6hr_rain = sum of past 6 hours rainfall (mm)

This is conservative and underestimates peak levels — real gauges will
always be the authoritative source when available.

USAGE
-----
Called by app.py every REFRESH_INTERVAL_MINUTES to refresh all barangays.
Can also be run standalone: python pagasa_fetcher.py
"""

import requests
import time
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ── Tuning constants ──────────────────────────────────────────────────────────
BASE_WATER_LEVEL      = 0.3    # metres — dry baseline for coastal Talisay
RUNOFF_COEFFICIENT    = 0.018  # m of water rise per mm of 6-hr accumulated rain
MAX_WATER_ESTIMATE    = 5.0    # metres cap (physical limit)
REFRESH_INTERVAL_MIN  = 15     # how often app.py should re-fetch (minutes)
REQUEST_TIMEOUT_SEC   = 8      # per-barangay HTTP timeout
INTER_REQUEST_DELAY   = 0.25   # seconds between API calls (be polite to free API)

# Open-Meteo endpoint — free, no auth, CC BY 4.0
OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lng}"
    "&current=precipitation,rain"
    "&hourly=precipitation"
    "&timezone=Asia%2FManila"
    "&past_hours=6"
    "&forecast_days=1"
)

# ── Barangay coordinate table ─────────────────────────────────────────────────
BARANGAY_COORDS = [
    ("Poblacion",   10.2428, 123.8477),
    ("Tabunok",     10.2633, 123.8411),
    ("Cansojong",   10.2495, 123.8550),
    ("Linao",       10.2562, 123.8190),
    ("Mohon",       10.2495, 123.8256),
    ("Pooc",        10.2383, 123.8242),
    ("San Roque",   10.2536, 123.8610),
    ("Dumlog",      10.2448, 123.8393),
    ("Camp IV",     10.3205, 123.8205),
    ("Bulacao",     10.2693, 123.8447),
    ("Lagtang",     10.2668, 123.8342),
    ("Lawaan I",    10.2584, 123.8227),
    ("Lawaan II",   10.2587, 123.8345),
    ("Lawaan III",  10.2651, 123.8315),
    ("Maghaway",    10.2773, 123.8164),
    ("Manipis",     10.3212, 123.7862),
    ("Jaclupan",    10.3022, 123.8167),
    ("San Isidro",  10.2592, 123.8403),
    ("Tangke",      10.2509, 123.8610),
    ("Cadulawan",   10.2780, 123.8388),
    ("Tapul",       10.3004, 123.7994),
    ("Biasong",     10.2377, 123.8283),
]


def estimate_water_level(rain_6hr_mm: list[float]) -> float:
    """
    Estimate current water level from 6-hour accumulated rainfall.

    Uses a simple linear rational method:
        wl = base + k * sum(rain_6hr)

    More sophisticated models (SCS curve number, Green-Ampt) require
    soil data not available publicly for Talisay. This is appropriate
    for a thesis prototype pending real PAG-ASA gauge data.

    Parameters
    ----------
    rain_6hr_mm : list of up to 6 hourly precipitation values (mm)

    Returns
    -------
    float : estimated water level in metres
    """
    total = sum(r for r in rain_6hr_mm if r is not None and r >= 0)
    wl = BASE_WATER_LEVEL + RUNOFF_COEFFICIENT * total
    return round(min(wl, MAX_WATER_ESTIMATE), 2)


def fetch_barangay(name: str, lat: float, lng: float) -> dict | None:
    """
    Fetch current precipitation + past 6h for one barangay from Open-Meteo.

    Returns a dict with keys: name, lat, lng, rain, rain_6hr, water,
    status, risk, source, fetched_at — or None on failure.
    """
    url = OPEN_METEO_URL.format(lat=lat, lng=lng)
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT_SEC)
        resp.raise_for_status()
        data = resp.json()

        # Current rainfall (mm in this hour)
        current = data.get("current", {})
        rain_now = float(current.get("precipitation") or current.get("rain") or 0)
        rain_now = round(rain_now, 1)

        # Past 6 hours of hourly precipitation
        hourly     = data.get("hourly", {})
        hourly_rain = hourly.get("precipitation", [])
        # Open-Meteo returns past_hours=6 + forecast hours; take last 6 values up to now
        rain_6hr = [float(v) if v is not None else 0.0
                    for v in hourly_rain[-6:]]

        # Use current reading as the last hour if hourly is empty
        if not rain_6hr:
            rain_6hr = [rain_now]

        water = estimate_water_level(rain_6hr)

        return {
            "name":       name,
            "lat":        lat,
            "lng":        lng,
            "rain":       rain_now,
            "rain_6hr":   [round(r, 1) for r in rain_6hr],
            "water":      water,
            "source":     "open-meteo",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    except requests.exceptions.Timeout:
        logger.warning(f"Timeout fetching {name}")
    except requests.exceptions.RequestException as e:
        logger.warning(f"Request error for {name}: {e}")
    except (KeyError, ValueError, TypeError) as e:
        logger.warning(f"Parse error for {name}: {e}")

    return None


def fetch_all_barangays(on_progress=None) -> dict:
    """
    Fetch live rainfall data for all 22 barangays.

    Parameters
    ----------
    on_progress : optional callback(name, success) called after each fetch

    Returns
    -------
    dict mapping barangay name → reading dict (only successful fetches)
    """
    results = {}
    total   = len(BARANGAY_COORDS)

    for i, (name, lat, lng) in enumerate(BARANGAY_COORDS):
        reading = fetch_barangay(name, lat, lng)
        if reading:
            results[name] = reading
            logger.info(f"  [{i+1}/{total}] {name}: {reading['rain']} mm/hr, "
                        f"water ~{reading['water']}m")
        else:
            logger.warning(f"  [{i+1}/{total}] {name}: FAILED — keeping previous data")

        if on_progress:
            on_progress(name, reading is not None)

        if i < total - 1:
            time.sleep(INTER_REQUEST_DELAY)

    logger.info(f"Fetch complete: {len(results)}/{total} barangays updated")
    return results


# ── Standalone test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    print("=" * 55)
    print("  FloodWatch — Open-Meteo live fetch test")
    print("=" * 55)

    results = fetch_all_barangays()

    print(f"\n{'Barangay':<14} {'Rain (mm/hr)':>12} {'Water est. (m)':>14} {'6hr total':>10}")
    print("-" * 55)
    for name, r in results.items():
        total6 = sum(r["rain_6hr"])
        print(f"{name:<14} {r['rain']:>12.1f} {r['water']:>14.2f} {total6:>10.1f}")

    print(f"\nFetched {len(results)}/22 barangays from Open-Meteo")
    print("Water levels are estimates — use PAG-ASA gauges when available")
