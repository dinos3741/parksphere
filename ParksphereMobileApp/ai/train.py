import os
import json
import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow.keras import layers, models
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import matplotlib.pyplot as plt

# ==============================
# CONFIGURATION
# ==============================
WINDOW_SIZE = 30  # 30 seconds of history
FEATURES = [
    'speed', 'stepRate', 'accel', 
    'pgr', 'pgrSlope', 'approachAlignment', 'deltaRate'
]
MODEL_NAME = "returning_cnn_model"

def load_data(data_dir):
    """
    Loads all JSON telemetry files from the data directory.
    Returns a list of samples.
    """
    all_data = []
    if not os.path.exists(data_dir):
        print(f"Directory {data_dir} not found.")
        return []

    for filename in os.listdir(data_dir):
        if filename.endswith(".json"):
            with open(os.path.join(data_dir, filename), 'r') as f:
                try:
                    file_data = json.load(f)
                    all_data.extend(file_data)
                except Exception as e:
                    print(f"Error loading {filename}: {e}")
    
    return all_data

def preprocess_data(raw_data):
    """
    Converts raw telemetry list into structured windows for the CNN.
    Includes resampling to 1Hz for temporal consistency.
    """
    if not raw_data:
        return None, None, None

    # 1. Flatten to DataFrame
    rows = []
    for entry in raw_data:
        row = {
            'timestamp': entry['timestamp'],
            'label': entry.get('manualLabel'),
            'speed': entry['sensors'].get('speed', 0.0),
            'stepRate': entry['sensors'].get('stepRate', 0.0),
            'accel': entry['sensors'].get('accel', 1.0),
            'pgr': entry['features'].get('pgr', 0.0),
            'pgrSlope': entry['features'].get('pgrSlope', 0.0),
            'approachAlignment': entry['features'].get('approachAlignment', 0.0),
            'deltaRate': entry['features'].get('deltaRate', 0.0)
        }
        rows.append(row)
    
    df = pd.DataFrame(rows)
    df['dt'] = pd.to_datetime(df['timestamp'], unit='ms')
    df = df.set_index('dt').sort_index()

    # 2. Resample to 1s frequency (Handling irregular mobile sensor rates)
    # Numerical features use interpolation, labels use 'nearest' or 'ffill'
    print("   ⏳ Resampling data to 1Hz...")
    resampled_num = df[FEATURES].resample('1S').mean().interpolate(method='linear')
    resampled_label = df[['label']].resample('1S').ffill()
    
    df = pd.concat([resampled_num, resampled_label], axis=1).dropna(subset=FEATURES)

    # 3. Target mapping
    df['target'] = df['label'].apply(lambda x: 1 if x == 'RETURNING' else 0)
    
    # 4. Scale Features
    scaler = StandardScaler()
    df[FEATURES] = scaler.fit_transform(df[FEATURES])

    # 5. Create Sliding Windows
    X, y = [], []
    data_array = df[FEATURES].values
    target_array = df['target'].values

    for i in range(len(data_array) - WINDOW_SIZE):
        X.append(data_array[i:i + WINDOW_SIZE])
        y.append(target_array[i + WINDOW_SIZE - 1])

    return np.array(X), np.array(y), scaler

def build_model(input_shape):
    """
    Defines the 1D-CNN architecture for temporal pattern recognition.
    """
    model = models.Sequential([
        # First Convolutional Block
        layers.Conv1D(32, kernel_size=3, activation='relu', input_shape=input_shape),
        layers.BatchNormalization(),
        layers.MaxPooling1D(pool_size=2),
        
        # Second Convolutional Block
        layers.Conv1D(64, kernel_size=3, activation='relu'),
        layers.BatchNormalization(),
        layers.GlobalAveragePooling1D(),
        
        # Decision Layers
        layers.Dense(32, activation='relu'),
        layers.Dropout(0.2),
        layers.Dense(1, activation='sigmoid') # Probability of RETURNING
    ])

    model.compile(
        optimizer='adam',
        loss='binary_crossentropy',
        metrics=['accuracy', tf.keras.metrics.Precision(), tf.keras.metrics.Recall()]
    )
    return model

def main():
    print("🚀 Starting CNN Training Pipeline...")
    
    # 1. Load & Preprocess
    raw_data = load_data("data")
    if not raw_data:
        print("❌ No data found in 'data/' folder. Please add telemetry JSON files.")
        return

    X, y, scaler = preprocess_data(raw_data)
    print(f"✅ Preprocessed {len(X)} windows.")

    # 2. Train/Test Split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # 3. Build & Train
    model = build_model((WINDOW_SIZE, len(FEATURES)))
    model.summary()

    print("\n⏳ Training model...")
    history = model.fit(
        X_train, y_train,
        epochs=50,
        batch_size=16,
        validation_split=0.1,
        verbose=1
    )

    # 4. Evaluate
    print("\n📊 Evaluating on test set...")
    results = model.evaluate(X_test, y_test, verbose=0)
    print(f"Test Accuracy: {results[1]*100:.2f}%")

    # 5. Save Model
    model.save(f"{MODEL_NAME}.h5")
    print(f"💾 Model saved as {MODEL_NAME}.h5")
    
    # Also save the scaler params so the mobile app can normalize inputs the same way
    scaler_params = {
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "features": FEATURES
    }
    with open("scaler_params.json", "w") as f:
        json.dump(scaler_params, f)
    print("💾 Scaler parameters saved as scaler_params.json")

if __name__ == "__main__":
    main()
