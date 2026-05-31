import json
import numpy as np

with open('ParksphereMobileApp/ai/data/telemetry_log2.json', 'r') as f:
    data = json.load(f)

print(f"Total entries: {len(data)}")

labels = {}
for entry in data:
    l = entry.get('manualLabel', 'UNLABELED')
    labels[l] = labels.get(l, 0) + 1

print("Labels found:")
for k, v in labels.items():
    print(f"  {k}: {v}")

