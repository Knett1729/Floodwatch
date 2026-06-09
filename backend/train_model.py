"""
train_model.py — FloodWatch Talisay
====================================
Realistic flood prediction model with properly overlapping training data.
Produces calibrated probability outputs (not always 0% or 100%).

To use real data later:
- Set GENERATE_FAKE_DATA = False
- Provide real CSV files named rainfall_data.csv and water_level_data.csv
- Each file should include barangay, timestamp, and rain/water values
- Timestamps should be hourly and aligned across both files
"""

import csv
from datetime import datetime
import numpy as np
import pickle
import json
import os
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import classification_report, confusion_matrix

# ─── CONFIG ───────────────────────────────────────────────────────────────────
SEQUENCE_LENGTH    = 6      # past hours the model looks at
NUM_FEATURES       = 2      # rainfall + water level
NUM_CLASSES        = 3      # Normal / Warning / Critical
GENERATE_FAKE_DATA = True   # set False when real PAGASA CSV is ready
RAIN_CSV           = 'rainfall_data.csv'
WATER_CSV          = 'water_level_data.csv'
# ──────────────────────────────────────────────────────────────────────────────


def derive_label(rain, water):
    """Derive a class label from rainfall and water thresholds."""
    if water > 2.0 and rain > 60:
        return 2
    if water > 2.0 or rain > 60:
        return 2
    if water >= 1.2 or rain >= 25:
        return 1
    return 0


def parse_csv_datetime(value):
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    raise ValueError(f"Unsupported datetime format: {value}")


def load_timeseries_csv(path, key_field, value_field):
    """Load a CSV file into a dict of key -> sorted list of (timestamp, value)."""
    data = {}
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing required CSV: {path}")

    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        headers = {h.lower(): h for h in reader.fieldnames or []}

        key_name = next((h for h in headers if h == key_field.lower()), None)
        if key_name is None:
            key_name = next((h for h in headers if h in {'barangay', 'location', 'station'}), None)

        ts_name = next((h for h in headers if h in {'timestamp', 'time', 'datetime', 'date'}), None)
        value_name = next((h for h in headers if h == value_field.lower()), None)
        if value_name is None:
            value_name = next((h for h in headers if h in {'rain', 'precipitation', 'precip', 'water', 'water_level', 'level'}), None)

        if not key_name or not ts_name or not value_name:
            raise ValueError(f"CSV {path} must include columns for barangay, timestamp, and {value_field}")

        for row in reader:
            key = row[headers[key_name]].strip()
            ts = parse_csv_datetime(row[headers[ts_name]].strip())
            val = float(row[headers[value_name]].strip())
            data.setdefault(key, []).append((ts, val))

    for key in data:
        data[key].sort(key=lambda x: x[0])
    return data


def merge_rain_water_series(rain_series, water_series):
    """Align rain and water series by timestamp for each barangay."""
    merged = {}
    keys = set(rain_series) & set(water_series)
    for key in keys:
        rain_data = rain_series[key]
        water_data = {ts: val for ts, val in water_series[key]}
        records = []
        for ts, rain_val in rain_data:
            if ts in water_data:
                records.append((ts, rain_val, water_data[ts]))
        if records:
            merged[key] = records
    return merged


def load_real_data():
    """Load actual rainfall and water-level CSV data for training."""
    print("Loading training data from PAGASA CSV files...")
    rain_series = load_timeseries_csv(RAIN_CSV, 'barangay', 'rain')
    water_series = load_timeseries_csv(WATER_CSV, 'barangay', 'water')
    merged = merge_rain_water_series(rain_series, water_series)

    X, y = [], []
    for barangay, records in merged.items():
        if len(records) < SEQUENCE_LENGTH:
            continue
        for i in range(len(records) - SEQUENCE_LENGTH + 1):
            window = records[i:i+SEQUENCE_LENGTH]
            # Ensure timestamps are consistently spaced by roughly one hour
            good = True
            for a, b in zip(window, window[1:]):
                delta = (b[0] - a[0]).total_seconds()
                if abs(delta - 3600) > 900:
                    good = False
                    break
            if not good:
                continue
            seq = [[rain, water] for _, rain, water in window]
            label = derive_label(window[-1][1], window[-1][2])
            X.append(seq)
            y.append(label)

    if not X:
        raise ValueError("No valid training sequences could be built from CSV data.")

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)
    counts = {0: int((y == 0).sum()), 1: int((y == 1).sum()), 2: int((y == 2).sum())}
    print(f"  Loaded {len(y)} samples from CSV")
    print(f"  Normal={counts[0]}  Warning={counts[1]}  Critical={counts[2]}")
    return X, y


def generate_realistic_data(n_samples=5000):
    """
    Generates realistic, overlapping training data.

    Key improvement over old version:
    - Wide overlap between classes (real floods don't have clean cutoffs)
    - Moderate rain CAN cause Warning if water is already high (saturated soil)
    - High rain doesn't always mean Critical if drainage is good
    - Random noise added to every reading
    - Multiple realistic scenarios per class
    """
    print("Generating realistic synthetic training data...")
    np.random.seed(2024)

    X, y = [], []

    scenarios = {
        # (rain_range, water_range, label, weight)
        # Normal scenarios
        'dry_day':          ((0,  10),  (0.1, 0.6),  0, 0.20),
        'light_rain':       ((5,  25),  (0.4, 1.0),  0, 0.20),
        'moderate_dry':     ((15, 35),  (0.5, 1.2),  0, 0.10),

        # Warning scenarios — intentional overlap with Normal and Critical
        'moderate_wet':     ((20, 50),  (1.0, 1.8),  1, 0.12),
        'light_high_water': ((5,  25),  (1.3, 1.9),  1, 0.08),
        'heavy_good_drain': ((50, 80),  (1.2, 1.9),  1, 0.08),
        'prolonged_rain':   ((25, 55),  (1.4, 2.1),  1, 0.07),

        # Critical scenarios
        'typhoon':          ((70, 150), (2.0, 4.0),  2, 0.06),
        'heavy_saturated':  ((50, 100), (1.8, 3.5),  2, 0.05),
        'flash_flood':      ((80, 180), (2.5, 5.0),  2, 0.04),
    }

    weights = [v[3] for v in scenarios.values()]
    keys    = list(scenarios.keys())

    for _ in range(n_samples):
        # Pick scenario weighted by probability
        scenario_key = np.random.choice(keys, p=weights)
        rain_range, water_range, label, _ = scenarios[scenario_key]

        base_rain  = np.random.uniform(*rain_range)
        base_water = np.random.uniform(*water_range)

        # Build 6-hour sequence with realistic trend
        sequence = []
        rain_t  = base_rain
        water_t = base_water

        # Trend direction: rising, steady, or falling
        if label == 2:
            trend = np.random.choice(['rising', 'rapid'], p=[0.5, 0.5])
        elif label == 1:
            trend = np.random.choice(['rising', 'steady'], p=[0.6, 0.4])
        else:
            trend = np.random.choice(['steady', 'falling'], p=[0.5, 0.5])

        trend_delta = {
            'rapid':   (5.0,  0.15),
            'rising':  (2.0,  0.06),
            'steady':  (0.5,  0.01),
            'falling': (-2.0, -0.04),
        }

        d_rain, d_water = trend_delta[trend]

        for t in range(SEQUENCE_LENGTH):
            # Add trend + noise
            rain_t  = max(0, rain_t  + d_rain  + np.random.normal(0, 4.0))
            water_t = max(0, water_t + d_water + np.random.normal(0, 0.06))
            # Cap at realistic maximums
            rain_t  = min(rain_t,  200)
            water_t = min(water_t, 5.0)
            sequence.append([rain_t, water_t])

        X.append(sequence)
        y.append(label)

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)

    counts = {0: sum(y==0), 1: sum(y==1), 2: sum(y==2)}
    print(f"  Samples: {len(y)} total")
    print(f"  Normal={counts[0]}  Warning={counts[1]}  Critical={counts[2]}")
    return X, y


def normalize_data(X):
    """Scale inputs to 0-1 range for model input."""
    rain_max  = 200.0
    water_max = 5.0
    X_norm = X.copy()
    X_norm[:, :, 0] /= rain_max
    X_norm[:, :, 1] /= water_max
    scaler = {'rain_max': rain_max, 'water_max': water_max}
    return X_norm, scaler


def prepare_training_data(n_samples=5000):
    """Prepare training data from real CSVs or synthetic generator."""
    if GENERATE_FAKE_DATA:
        return generate_realistic_data(n_samples)
    return load_real_data()


def train_model(X, y):
    """
    Trains a Gradient Boosting model with probability calibration.

    Calibration is the key fix — it ensures outputs like:
      "75% rainfall + 3m water" → Warning: 45%, Critical: 48%
    instead of always giving 100% to one class.

    In a final thesis version, replace this with TensorFlow LSTM.
    """
    X_flat = X.reshape(X.shape[0], -1)  # flatten (samples, 6*2=12 features)

    X_train, X_test, y_train, y_test = train_test_split(
        X_flat, y, test_size=0.2, random_state=42, stratify=y
    )

    print("\nTraining Gradient Boosting model...")
    base_model = GradientBoostingClassifier(
        n_estimators=200,
        learning_rate=0.08,
        max_depth=4,
        min_samples_leaf=10,   # prevents overconfidence
        subsample=0.85,
        random_state=42
    )

    # CalibratedClassifierCV ensures probabilities are realistic
    print("Calibrating probability outputs...")
    model = CalibratedClassifierCV(base_model, method='isotonic', cv=3)
    model.fit(X_train, y_train)

    # Evaluate
    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)

    acc = (y_pred == y_test).mean()
    print(f"\nTest accuracy: {acc:.2%}")

    print("\n── Classification Report (for research paper) ──")
    print(classification_report(y_test, y_pred,
          target_names=['Normal', 'Warning', 'Critical']))

    cm = confusion_matrix(y_test, y_pred)
    print("Confusion Matrix:")
    print("                  Pred:Normal  Pred:Warning  Pred:Critical")
    for label, row in zip(['True:Normal  ', 'True:Warning ', 'True:Critical'], cm):
        print(f"  {label}  {row}")

    # Check probability calibration
    print("\n── Sample probability outputs (calibration check) ──")
    test_cases = [
        ("Low rain + low water (should be Normal)",   [0, 0, 0, 5, 8, 10],    [0.3, 0.3, 0.35, 0.4, 0.42, 0.45]),
        ("Moderate rain + rising water (Warning?)",   [20, 25, 30, 38, 42, 48],[1.0, 1.1, 1.3,  1.5, 1.6,  1.7]),
        ("Heavy rain + high water (Critical?)",       [60, 70, 78, 85, 90, 95],[2.0, 2.2, 2.5,  2.7, 2.9,  3.1]),
    ]
    rain_max, water_max = 200.0, 5.0
    for desc, r_seq, w_seq in test_cases:
        seq = np.array([[r/rain_max, w/water_max] for r, w in zip(r_seq, w_seq)])
        prob = model.predict_proba(seq.reshape(1,-1))[0]
        print(f"  {desc}")
        print(f"    → Normal:{prob[0]:.0%}  Warning:{prob[1]:.0%}  Critical:{prob[2]:.0%}")

    return model


def save_model(model, scaler):
    os.makedirs('model', exist_ok=True)
    with open('model/flood_model.pkl', 'wb') as f:
        pickle.dump(model, f)
    with open('model/scaler_params.json', 'w') as f:
        json.dump(scaler, f, indent=2)
    metadata = {
        'sequence_length': SEQUENCE_LENGTH,
        'num_features':    NUM_FEATURES,
        'num_classes':     NUM_CLASSES,
        'feature_names':   ['rainfall_mm_hr', 'water_level_m'],
        'class_names':     ['Normal', 'Warning', 'Critical'],
        'thresholds': {
            'Normal':   'water < ~1.2m, rain < ~25mm/hr',
            'Warning':  'water 1.2-2.0m or rain 25-60mm/hr with rising trend',
            'Critical': 'water > 2.0m and/or rain > 60mm/hr sustained'
        },
        'note': 'Replace synthetic data with real PAGASA CSV for final thesis'
    }
    with open('model/metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    print("\n✓ Model saved  → model/flood_model.pkl")
    print("✓ Scaler saved → model/scaler_params.json")
    print("✓ Metadata     → model/metadata.json")


if __name__ == '__main__':
    print("=" * 55)
    print("  FloodWatch Talisay — Model Training v2")
    print("=" * 55)

    X, y     = prepare_training_data(n_samples=5000)
    X_norm, scaler = normalize_data(X)
    model    = train_model(X_norm, y)
    save_model(model, scaler)

    print("\n✓ Done! Run: python app.py")
