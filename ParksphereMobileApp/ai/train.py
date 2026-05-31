import os
import json
import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow.keras import layers, models
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import matplotlib.pyplot as plt
import argparse

# ==============================
# CONFIGURATION
# ==============================
WINDOW_SIZE = 30    # 30 seconds of history
WINDOW_STRIDE = 5   # Create a window every 5 seconds (reduces data volume/overlap)
FEATURES = [
    'speed', 'stepRate', 'accel', 
    'pgr', 'pgrSlope', 'approachAlignment', 'deltaRate'
]
MODEL_NAME = "returning_cnn_model"

def split_into_sessions(df, max_gap_seconds=10):
    """
    Splits a single dataframe into multiple chunks if there are time gaps.
    Prevents 'Time Gap Explosion' during resampling.
    """
    df = df.sort_index()
    diffs = df.index.to_series().diff().dt.total_seconds() > max_gap_seconds
    session_ids = diffs.cumsum()
    return [group for _, group in df.groupby(session_ids)]

def load_and_preprocess_all(data_dir):
    """
    Loads and preprocesses each file individually with gap detection.
    """
    all_X = []
    all_y = []
    scaler = StandardScaler()
    
    if not os.path.exists(data_dir):
        print(f"Directory {data_dir} not found.")
        return None, None, None

    raw_frames = []
    files = [f for f in os.listdir(data_dir) if f.endswith(".json")]
    
    if not files:
        print(f"❌ No JSON files found in {data_dir}")
        return None, None, None

    for filename in files:
        print(f"  📖 Loading {filename}...")
        with open(os.path.join(data_dir, filename), 'r') as f:
            try:
                file_data = json.load(f)
            except Exception as e:
                print(f"Error loading {filename}: {e}")
                continue
            
            rows = []
            for entry in file_data:
                sensors = entry.get('sensors', {})
                features = entry.get('features', {})
                rows.append({
                    'timestamp': entry['timestamp'],
                    'label': entry.get('manualLabel'),
                    'speed': sensors.get('speed', 0.0),
                    'stepRate': sensors.get('stepRate', 0.0),
                    'accel': sensors.get('accel', 1.0),
                    'pgr': features.get('pgr', 0.0),
                    'pgrSlope': features.get('pgrSlope', 0.0),
                    'approachAlignment': features.get('approachAlignment', 0.0),
                    'deltaRate': features.get('deltaRate', 0.0)
                })
            
            if not rows: continue
            
            df = pd.DataFrame(rows)
            df['dt'] = pd.to_datetime(df['timestamp'], unit='ms')
            df = df.set_index('dt').sort_index()
            
            # Split into continuous chunks to avoid resampling across year/hour gaps
            sessions = split_into_sessions(df)
            
            for i, sess_df in enumerate(sessions):
                if len(sess_df) < WINDOW_SIZE: continue
                
                # Resample this session chunk at 1Hz
                resampled_num = sess_df[FEATURES].resample('1s').mean().interpolate(method='linear')
                resampled_label = sess_df[['label']].resample('1s').ffill()
                df_final = pd.concat([resampled_num, resampled_label], axis=1).dropna(subset=FEATURES)
                
                if not df_final.empty:
                    raw_frames.append(df_final)

    if not raw_frames:
        return None, None, None

    # 2. Fit Scaler
    print("   ⚖️ Fitting feature scaler...")
    total_df = pd.concat(raw_frames)
    scaler.fit(total_df[FEATURES])

    # 3. Create windows per session
    print(f"   🪟 Creating windows (stride={WINDOW_STRIDE}s)...")
    for df in raw_frames:
        df[FEATURES] = scaler.transform(df[FEATURES])
        df['target'] = df['label'].apply(lambda x: 1 if x == 'RETURNING' else 0)
        
        data_array = df[FEATURES].values
        target_array = df['target'].values
        
        if len(data_array) > WINDOW_SIZE:
            # Step by WINDOW_STRIDE to reduce overlap and memory pressure
            for i in range(0, len(data_array) - WINDOW_SIZE, WINDOW_STRIDE):
                all_X.append(data_array[i:i + WINDOW_SIZE])
                all_y.append(target_array[i + WINDOW_SIZE - 1])

    X_final = np.array(all_X, dtype='float32')
    y_final = np.array(all_y, dtype='float32')
    
    return X_final, y_final, scaler

def build_model(input_shape):
    model = models.Sequential([
        layers.Conv1D(32, kernel_size=3, activation='relu', input_shape=input_shape),
        layers.BatchNormalization(),
        layers.MaxPooling1D(pool_size=2),
        layers.Conv1D(64, kernel_size=3, activation='relu'),
        layers.BatchNormalization(),
        layers.GlobalAveragePooling1D(),
        layers.Dense(32, activation='relu'),
        layers.Dropout(0.3), # Increased dropout for better generalization
        layers.Dense(1, activation='sigmoid')
    ])
    model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
    return model

def main():
    parser = argparse.ArgumentParser(description="Train the Returning CNN model.")
    parser.add_argument("--fine-tune", action="store_true", help="Load existing model.")
    parser.add_argument("--data-dir", type=str, default="data", help="Data directory.")
    args = parser.parse_args()

    print(f"🚀 Starting Optimized Training Pipeline...")
    
    X, y, scaler = load_and_preprocess_all(args.data_dir)
    
    if X is None or len(X) == 0:
        print("❌ Not enough data.")
        return
        
    print(f"✅ Dataset Prepared: {len(X)} windows ({X.shape})")

    # 2. Train/Test Split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # 3. Build/Load
    if args.fine_tune and os.path.exists(f"{MODEL_NAME}.h5"):
        print(f"💾 Loading model: {MODEL_NAME}.h5")
        model = tf.keras.models.load_model(f"{MODEL_NAME}.h5")
    else:
        model = build_model((WINDOW_SIZE, len(FEATURES)))
    
    model.summary()

    # 4. Train
    print("\n⏳ Training...")
    model.fit(X_train, y_train, epochs=30, batch_size=32, validation_split=0.2, verbose=1)

    # 5. Evaluate
    print("\n📊 Evaluating...")
    loss, acc = model.evaluate(X_test, y_test, verbose=0)
    print(f"Test Accuracy: {acc*100:.2f}%")

    # 6. Save
    model.save(f"{MODEL_NAME}.h5")
    print(f"💾 Saved as {MODEL_NAME}.h5")
    
    scaler_params = {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist(), "features": FEATURES}
    with open("scaler_params.json", "w") as f:
        json.dump(scaler_params, f)

if __name__ == "__main__":
    main()
