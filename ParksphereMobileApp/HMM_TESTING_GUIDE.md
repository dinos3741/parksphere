# Parksphere HMM Detection Engine: Testing Guide

This guide explains how to run and interpret the automated tests for the Park Detection Hidden Markov Model (HMM).

## 🚀 How to Run the Tests

The primary test suite is a headless Node.js runner that simulates real-world sensor data (GPS, Accelerometer, Pedometer, Bluetooth) and validates the HMM's state transitions.

### 1. Run the HMM Regression Suite (Recommended)
This is the fastest and most reliable way to verify the model. It runs 12+ scenarios covering standard usage, edge cases, and stability fixes.

```bash
# Run from the ParksphereMobileApp directory
npm run test:hmm
```

### 2. Run with Jest (Alternative)
The project also includes Jest-based tests for environment-specific integrations. Note: If your local environment has Jest dependency issues, use the command above.

```bash
# Run from the ParksphereMobileApp directory
npm test
```

---

## 🔍 What is Being Tested?

The suite covers 12 critical scenarios to ensure the engine is both responsive and stable:

### 1. Robustness & Spike Resistance
*   **Fix 1: Absolute Step Block:** Verifies that physical steps (Pedometer) always block the `DRIVING` state, even if the GPS speed is high.
*   **Kalman Tuning:** Verifies that 1-second GPS "spikes" (e.g., jump to 60km/h and back) are ignored by the stiffened Kalman filters.
*   **Dynamic Accuracy:** Simulates low GPS accuracy (e.g., 150m) to ensure the position filter dampens jitter correctly.

### 2. Logic Gates & Stability
*   **Hysteresis Gap:** Ensures a 15% confidence difference is required before switching states, preventing "flapping."
*   **Tightened Gates:** Verifies that entering `IN_CAR` requires being within 5m and moving toward the car.
*   **Proximity Reset:** Confirms that staying near the car for a sustained period resets the "IsAway" flag.

### 3. New Signals
*   **Bluetooth Integration:** Confirms that an active Bluetooth connection correctly boosts the confidence of `IN_CAR` and `DRIVING` states.

---

## 🛠 Troubleshooting

### "SyntaxError: Cannot use import statement outside a module"
If you see this error when running `npm test`, it means the Jest environment is having trouble with ES6 imports. 
**Solution:** Use `npm run test:hmm` instead, as it uses a standalone Node runner that is much more stable for model validation.

### "NaN/Missing belief detected in restoration"
This is a warning log you might see during tests. It indicates the test runner is resetting the HMM state for a fresh test case. This is expected behavior during the automated suite.

---

## 📂 Key Files
*   `utils/parkDetection_HMM.js`: The core logic (Math, Filters, Gates).
*   `utils/hmm-test-runner.js`: The "Master" test execution engine.
*   `utils/simulationScenarios.js`: The JSON definition of real-world movement scenarios.
*   `utils/__tests__/hmm_scenarios.test.js`: The Jest-compatible wrapper for the scenarios.
