import json

with open('ParksphereMobileApp/ai/data/telemetry_log2.json', 'r') as f:
    data = json.load(f)

for i, entry in enumerate(data):
    if 65 < i < 75:
        stepRate = entry.get('sensors', {}).get('stepRate', 0)
        state = entry.get('hmm', {}).get('state')
        label = entry.get('manualLabel')
        speed = entry.get('sensors', {}).get('speed', 0)
        accel = entry.get('sensors', {}).get('accel', 1.0)
        print(f"[{i}] Lbl:{label} / HMM:{state} | Speed: {speed:.2f} | StepRate: {stepRate:.4f} | Accel: {accel:.4f}")

