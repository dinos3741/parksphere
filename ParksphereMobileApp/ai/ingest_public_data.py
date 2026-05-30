import pandas as pd
import json
import os
import argparse
import requests
import zipfile
import io

"""
Ingest Public Transportation Datasets (e.g., US-TM2017)
Converts public CSV datasets into the ParkSphere JSON telemetry format.
"""

USTM2017_ZIP_URL = "http://cs.unibo.it/projects/us-tm2017/dataset/dataset.zip"

def download_and_extract(url, extract_to="."):
    print(f"📡 Downloading dataset from: {url}")
    try:
        response = requests.get(url, stream=True)
        if response.status_code == 200:
            with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                print(f"📦 Extracting files...")
                z.extractall(extract_to)
            print(f"✅ Extraction complete.")
            return True
        else:
            print(f"❌ Download failed (Status {response.status_code})")
            return False
    except Exception as e:
        print(f"❌ Error during download/extraction: {e}")
        return False

def ingest_ustm2017(csv_path, output_dir):
    """
    Ingests the US-Transportation Mode Detection 2017 dataset.
    Columns expected: acc_x, acc_y, acc_z, speed, target, etc.
    """
    print(f"📂 Processing US-TM2017 dataset: {csv_path}")
    
    try:
        df = pd.read_csv(csv_path)
    except Exception as e:
        print(f"❌ Error reading CSV: {e}")
        return

    # Map public labels to ParkSphere states
    label_map = {
        0: 'STOPPED',
        1: 'WALKING',
        2: 'WALKING', # Running
        4: 'DRIVING',
        5: 'DRIVING'  # Bus
    }

    # 1. First pass: Convert all rows to our basic states
    mapped_entries = []
    for _, row in df.iterrows():
        target_val = row.get('target')
        if target_val not in label_map:
            continue
            
        mapped_entries.append({
            'label': label_map[target_val],
            'speed': float(row.get('speed', 0)),
            'accel': float(row.get('acc_mean', 1.0))
        })

    # 2. Second pass: Synthesize 'RETURNING'
    # We look for WALKING -> DRIVING transitions. 
    # We'll label the 30 samples (~60-90s) before DRIVING as 'RETURNING'.
    RETURNING_WINDOW = 30 
    
    for i in range(1, len(mapped_entries)):
        prev = mapped_entries[i-1]['label']
        curr = mapped_entries[i]['label']
        
        # Detected transition into vehicle
        if prev == 'WALKING' and curr == 'DRIVING':
            # Go back and relabel WALKING as RETURNING
            for j in range(max(0, i - RETURNING_WINDOW), i):
                if mapped_entries[j]['label'] == 'WALKING':
                    mapped_entries[j]['label'] = 'RETURNING'

    # 3. Third pass: Build final JSON format
    telemetry_data = []
    for entry in mapped_entries:
        label = entry['label']
        telemetry_data.append({
            "timestamp": int(pd.Timestamp.now().timestamp() * 1000), 
            "manualLabel": label,
            "sensors": {
                "speed": entry['speed'],
                "stepRate": 1.5 if label in ['WALKING', 'RETURNING'] else 0,
                "accel": entry['accel'],
                "accuracy": 10,
                "bluetoothConnected": False
            },
            "features": {
                "pgr": 0.5 if label == 'RETURNING' else 0.0, # Seed with some "returning" vibe
                "pgrSlope": 0.01 if label == 'RETURNING' else 0.0,
                "pgrConsistency": 0.8 if label == 'RETURNING' else 0.0,
                "approachAlignment": 0.7 if label == 'RETURNING' else 0.0,
                "deltaRate": -1.0 if label == 'RETURNING' else 0.0
            },
            "hmm": {
                "state": label,
                "confidence": 1.0
            }
        })

    # Save as a single large JSON for the training script
    output_file = os.path.join(output_dir, "public_data_ustm2017.json")
    with open(output_file, 'w') as f:
        json.dump(telemetry_data, f, indent=2)
    
    print(f"✅ Successfully ingested {len(telemetry_data)} samples to {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest public sensor datasets.")
    parser.add_argument("--path", type=str, help="Path to the public dataset CSV (local)")
    parser.add_argument("--download", action="store_true", help="Automatically download and ingest US-TM2017")
    parser.add_argument("--type", type=str, default="ustm2017", help="Dataset type (default: ustm2017)")
    
    args = parser.parse_args()
    
    data_dir = "data"
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
        
    csv_path = args.path

    if args.download:
        if not download_and_extract(USTM2017_ZIP_URL, "."):
            exit(1)
        # Based on repo documentation, the balanced CSV should be here:
        csv_path = "datasetBalanced/dataset_balanced.csv"
        
        if not os.path.exists(csv_path):
            # Fallback check if ZIP structure is different
            print(f"⚠️ {csv_path} not found. Searching for any CSV in extracted folders...")
            for root, dirs, files in os.walk("."):
                for file in files:
                    if file.endswith("balanced.csv"):
                        csv_path = os.path.join(root, file)
                        print(f"✅ Found: {csv_path}")
                        break

    if not csv_path or not os.path.exists(csv_path):
        print(f"❌ Error: CSV file not found at {csv_path}. Please provide --path or use --download")
        parser.print_help()
        exit(1)

    if args.type == "ustm2017":
        ingest_ustm2017(csv_path, data_dir)
    else:
        print(f"❌ Unknown dataset type: {args.type}")
