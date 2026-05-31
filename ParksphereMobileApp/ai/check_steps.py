import json

with open('ParksphereMobileApp/ai/data/telemetry_log2.json', 'r') as f:
    data = json.load(f)

print("Checking stepRate at end of WALKING phase...")
found_end = False
for i, entry in enumerate(data):
    state = entry.get('hmm', {}).get('state')
    label = entry.get('manualLabel')
    speed = entry.get('sensors', {}).get('speed', 0)
    stepRate = entry.get('sensors', {}).get('stepRate', 0)
    
    if label == 'STOPPED':
        found_end = True
        print(f"[{i}] {label} / HMM: {state} | Speed: {speed:.2f} | StepRate: {stepRate:.4f}")
    elif found_end and label == 'RETURNING':
        print(f"[{i}] {label} / HMM: {state} | Speed: {speed:.2f} | StepRate: {stepRate:.4f}")
        if i > 80: break # Just print the transition period

