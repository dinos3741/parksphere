import json

with open('ParksphereMobileApp/ai/data/telemetry_log0.json', 'r') as f:
    data = json.load(f)

for i, entry in enumerate(data):
    stepRate = entry.get('sensors', {}).get('stepRate', 0)
    if abs(stepRate - 0.38) < 0.05:
        state = entry.get('hmm', {}).get('state')
        label = entry.get('manualLabel')
        speed = entry.get('sensors', {}).get('speed', 0)
        print(f"log0: [{i}] Lbl:{label} / HMM:{state} | Speed: {speed:.2f} | StepRate: {stepRate:.4f}")

with open('ParksphereMobileApp/ai/data/telemetry_log1.json', 'r') as f:
    data = json.load(f)

for i, entry in enumerate(data):
    stepRate = entry.get('sensors', {}).get('stepRate', 0)
    if abs(stepRate - 0.38) < 0.05:
        state = entry.get('hmm', {}).get('state')
        label = entry.get('manualLabel')
        speed = entry.get('sensors', {}).get('speed', 0)
        print(f"log1: [{i}] Lbl:{label} / HMM:{state} | Speed: {speed:.2f} | StepRate: {stepRate:.4f}")
