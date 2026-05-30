import pandas as pd
import numpy as np
import json
import os
import argparse
import re

"""
Ingest Raw Multi-User Dataset (US-TM2017 Format)
Processes folders U1...U16 and converts raw session CSVs into ParkSphere JSON.
"""

def parse_filename(filename):
    """
    Extracts label and base timestamp from filename like:
    sensorfile_U1_Car_1480357774181.csv
    """
    parts = filename.replace(".csv", "").split("_")
    if len(parts) >= 4:
        label = parts[2]
        try:
            base_ts = int(parts[3])
        except:
            base_ts = 0
        return label, base_ts
    return None, None

def process_raw_folder(raw_data_dir, output_dir):
    print(f"📂 Processing raw data from: {raw_data_dir}")
    
    label_map = {
        'Still': 'STOPPED',
        'Walking': 'WALKING',
        'Run': 'WALKING',
        'Car': 'DRIVING',
        'Bus': 'DRIVING',
        'Train': 'DRIVING'
    }

    all_telemetry = []

    # Iterate through U1, U2... folders
    user_folders = [f for f in os.listdir(raw_data_dir) if f.startswith('U')]
    for user_folder in sorted(user_folders, key=lambda x: int(x[1:]) if x[1:].isdigit() else 0):
        user_path = os.path.join(raw_data_dir, user_folder)
        if not os.path.isdir(user_path):
            continue

        print(f"  👤 Processing {user_folder}...")
        
        for filename in os.listdir(user_path):
            if not filename.endswith(".csv"):
                continue

            label_raw, base_ts = parse_filename(filename)
            if not label_raw or label_raw not in label_map:
                continue

            label = label_map[label_raw]
            file_path = os.path.join(user_path, filename)
            
            try:
                # Read the mess (offset_ms, sensor_name, x, y, z)
                # We use encoding='latin1' to handle non-UTF-8 noise bytes
                df = pd.read_csv(file_path, header=None, names=['offset', 'sensor', 'x', 'y', 'z'], on_bad_lines='skip', low_memory=False, encoding='latin1')
                
                # Filter for Accelerometer
                accel_df = df[df['sensor'] == 'android.sensor.accelerometer'].copy()
                if accel_df.empty:
                    continue

                # Convert to numeric (handle errors)
                for col in ['offset', 'x', 'y', 'z']:
                    accel_df[col] = pd.to_numeric(accel_df[col], errors='coerce')
                
                accel_df = accel_df.dropna(subset=['offset', 'x', 'y', 'z'])
                
                # Calculate Magnitude
                accel_df['mag'] = np.sqrt(accel_df['x']**2 + accel_df['y']**2 + accel_df['z']**2)
                
                # Group by 1-second intervals (offset is in ms)
                accel_df['sec'] = (accel_df['offset'] // 1000).astype(int)
                sec_groups = accel_df.groupby('sec')['mag'].mean()

                # Build Telemetry Entries
                for sec, mag in sec_groups.items():
                    entry = {
                        "timestamp": base_ts + (sec * 1000),
                        "manualLabel": label,
                        "sensors": {
                            "speed": 0.0, # Raw files often lack speed, we'll need field data for this
                            "stepRate": 1.5 if label == 'WALKING' else 0,
                            "accel": float(mag / 9.81), # Convert to Gs (approx)
                            "accuracy": 10,
                            "bluetoothConnected": False
                        },
                        "features": {
                            "pgr": 0.0,
                            "pgrSlope": 0.0,
                            "pgrConsistency": 0.0,
                            "approachAlignment": 0.0,
                            "deltaRate": 0.0
                        },
                        "hmm": {
                            "state": label,
                            "confidence": 1.0
                        }
                    }
                    all_telemetry.append(entry)

            except Exception as e:
                print(f"    ⚠️ Error processing {filename}: {e}")

    # Save to JSON
    output_file = os.path.join(output_dir, "raw_public_data.json")
    with open(output_file, 'w') as f:
        json.dump(all_telemetry, f, indent=2)
    
    print(f"✅ Successfully ingested {len(all_telemetry)} seconds of data to {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest raw multi-user sensor data.")
    parser.add_argument("--dir", type=str, default="data/raw_data", help="Path to raw_data folder containing U1..U16")
    
    args = parser.parse_args()
    
    output_dir = "data"
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    process_raw_folder(args.dir, output_dir)
