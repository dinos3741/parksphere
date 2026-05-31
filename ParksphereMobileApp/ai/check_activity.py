import json

with open('ParksphereMobileApp/ai/data/telemetry_log2.json', 'r') as f:
    data = json.load(f)

for i, entry in enumerate(data):
    if 75 < i < 85:
        stepRate = entry.get('sensors', {}).get('stepRate', 0)
        state = entry.get('hmm', {}).get('state')
        label = entry.get('manualLabel')
        activity = entry.get('features', {}).get('motion_activity', {})
        print(f"[{i}] Lbl:{label} / HMM:{state} | StepRate: {stepRate:.4f} | Activity: {activity}")

