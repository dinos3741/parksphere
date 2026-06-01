# Parksphere HMM Detection Engine: Testing Guide

This guide explains how to run and interpret the automated tests for the Park Detection Hidden Markov Model (HMM) and the overarching Service Layer (`parkDetectionService.js`).

The test suite has been completely modernized to run via Jest using a custom configuration that handles Expo/React Native and native binary mocks.

All commands below should be run from the `ParksphereMobileApp` directory.

---

## 🏗️ Category 1: Synthetic / Logical Baselines
These tests use hand-written "Golden Scripts" (like the **Real-Life Odyssey**). They represent the perfect theoretical behavior of the system and are used to prove that the AI's core logic is mathematically sound.

### 1. The Core Integration Suite
*   **What it does:** Runs the foundational synthetic scenarios to verify that the service layer correctly derives states (Driving, Walking, etc.) from "perfect" input data.
*   **When to use:** Use this as a fast "Smoke Test" after any code change to ensure you haven't broken the basic ability to park or drive.
```bash
npm run test:service
```

### 2. Scenario Trace Analysis (The "Debugging Table")
*   **What it does:** Runs the **Real-Life Odyssey** scenario and prints a second-by-second table showing HMM confidence, distances, and internal probabilities.
*   **When to use:** Use this when you are fine-tuning Sigmoid or Gaussian curves. It allows you to see exactly how a change in math affects the "brain's" certainty at every step of a trip.
```bash
npm run test:service:trace
```

### 3. Regression Testing
*   **What it does:** Runs specific scripts designed to reproduce old bugs (e.g., "Ghost Walking" or incorrect state jumping).
*   **When to use:** Use this to guarantee that a bug you fixed in the past hasn't accidentally returned.
```bash
npm run test:service:regression
```

### 4. Mathematical Stress Testing (Monte Carlo)
*   **What it does:** Runs synthetic scenarios while applying +/- 20% randomized noise to the simulated sensors.
*   **When to use:** Use this to verify that your mathematical thresholds aren't too "brittle" or sensitive to minor fluctuations.
```bash
npm run test:service:stress
```

---

## 🌍 Category 2: Real-World Field Analysis
These tests use the **Flight Recorder JSON logs** captured from your real phone while driving. They prove that the AI can handle the messiness and chaos of the real world.

### 5. Telemetry Replay (The "Flight Simulator")
*   **What it does:** Parses raw `telemetry_log*.json` files and streams the thousands of recorded frames back through the AI. It synthesizes GPS movement based on your actual recorded speed.
*   **When to use:** Use this to verify a fix for a specific real-world event. If the app failed to detect a park during your lunch drive, use this to "re-live" that drive and see if your code fix works.
```bash
# Run against all recorded logs
npm run test:service:telemetry

# Run against a specific log only
LOG_FILE=telemetry_log6.json npm run test:service:telemetry
```

### 6. Telemetry Fuzzing (The "Ultimate Stress Test")
*   **What it does:** Replays your real-world logs but adds intense, randomized chaos: Speed variance, GPS jitter, and 5% chance of OS Activity sensor dropouts.
*   **When to use:** Use this for final validation before a production release. If the engine can correctly detect your parking events despite simulated sensor failure and massive noise, it is ready for the public.
```bash
# Stress test all logs
npm run test:service:telemetry:stress

# Stress test a specific log only
LOG_FILE=telemetry_log6.json npm run test:service:telemetry:stress
```

### 7. Field Replica Integration
*   **What it does:** Specifically mimics the timings and observations from your first real-world field tests (e.g., the 7m approach behavior).
*   **When to use:** Use this to ensure the "fine-tuning" we did for your specific phone's behavior is preserved.
```bash
npm run test:service:replica
```

---

## 🛠 Troubleshooting

*   **"TypeError: this._moduleMocker.clearMocksOnScope is not a function"** or **Native Binary Errors**:
    If you try to run the standard `npm test` or `jest` directly, it will fail due to React Native and TensorFlow native binaries. **Always use the specific `test:service:...` npm scripts above**.

*   **Test Timeouts:**
    The Telemetry Replay tests iterate through thousands of frames and can take 8-15 seconds to run. They are configured with a 30,000ms (30s) timeout to accommodate this on slower machines.
