import json

with open('ParksphereMobileApp/ai/data/telemetry_log2.json', 'r') as f:
    data = json.load(f)

print("Checking ALL instances of stuck stepRate around transitions...")
for i, entry in enumerate(data):
    state = entry.get('hmm', {}).get('state')
    label = entry.get('manualLabel')
    speed = entry.get('sensors', {}).get('speed', 0)
    stepRate = entry.get('sensors', {}).get('stepRate', 0)
    
    if 70 < i < 100: # Broad window around the end of WALKING
        print(f"[{i}] Lbl:{label} / HMM:{state} | Speed: {speed:.2f} | StepRate: {stepRate:.4f}")

