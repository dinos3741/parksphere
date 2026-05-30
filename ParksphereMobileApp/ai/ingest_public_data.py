import pandas as pd
import json
import os
import argparse

"""
Ingest Public Transportation Datasets (e.g., US-TM2017)
Converts public CSV datasets into the ParkSphere JSON telemetry format.
"""

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
    # US-TM2017 maps: 0: Still, 1: Walking, 2: Run, 3: Bike, 4: Car, 5: Bus, 6: Train
    label_map = {
        0: 'STOPPED',
        1: 'WALKING',
        2: 'WALKING', # Running is high-intensity walking for us
        4: 'DRIVING',
        5: 'DRIVING'  # Bus is also automotive
    }

    # Extract available features
    # Note: Public datasets might not have PGR/Alignment, so we'll fill with 0
    # or calculate them if GPS coords are present.
    telemetry_data = []
    
    for _, row in df.iterrows():
        target_val = row.get('target')
        if target_val not in label_map:
            continue
            
        label = label_map[target_val]
        
        # Calculate magnitude if raw axes exist
        accel = row.get('acc_mean', 1.0) # Default to 1G if missing
        speed = row.get('speed', 0)
        
        entry = {
            "timestamp": int(pd.Timestamp.now().timestamp() * 1000), # Mock TS
            "manualLabel": label,
            "sensors": {
                "speed": float(speed),
                "stepRate": 1.5 if label == 'WALKING' else 0, # Synthesize step rate
                "accel": float(accel),
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
        telemetry_data.append(entry)

    # Save as a single large JSON for the training script
    output_file = os.path.join(output_dir, "public_data_ustm2017.json")
    with open(output_file, 'w') as f:
        json.dump(telemetry_data, f, indent=2)
    
    print(f"✅ Successfully ingested {len(telemetry_data)} samples to {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest public sensor datasets.")
    parser.add_argument("--path", type=str, required=True, help="Path to the public dataset CSV")
    parser.add_argument("--type", type=str, default="ustm2017", help="Dataset type (default: ustm2017)")
    
    args = parser.parse_args()
    
    data_dir = "data"
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
        
    if args.type == "ustm2017":
        ingest_ustm2017(args.path, data_dir)
    else:
        print(f"❌ Unknown dataset type: {args.type}")
