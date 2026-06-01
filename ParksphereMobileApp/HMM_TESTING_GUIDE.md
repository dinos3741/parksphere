# Parksphere HMM Detection Engine: Testing Guide

This guide explains how to run and interpret the automated tests for the Park Detection Hidden Markov Model (HMM) and the overarching Service Layer (`parkDetectionService.js`).

The test suite has been completely modernized to run via Jest using a custom configuration that handles Expo/React Native and native binary mocks.

All commands below should be run from the `ParksphereMobileApp` directory.

---

## 🚀 The Test Suites

### 1. The Core Integration Suite
Runs the foundational simulation scenarios to verify that the service layer correctly interprets simulated location and motion activity to derive the proper state.

```bash
npm run test:service
```

### 2. Regression Testing
Runs specific bug-fix scenarios (e.g., verifying that you cannot "ghost walk" or transition backward incorrectly). Used to ensure old bugs do not reappear.

```bash
npm run test:service:regression
```

### 3. Scenario Trace Analysis
Runs detailed lifecycle traces (like the "Real-Life Odyssey" scenario) where every transition, confidence dip, and event trigger is logged second-by-second for visual debugging.

```bash
npm run test:service:trace
```

### 4. Mathematical Stress Testing (Monte Carlo)
Runs the simulated scenarios with randomized noise applied to the simulated variables (speed, steps, acceleration) to ensure the HMM math remains stable and doesn't become brittle under chaotic conditions.

```bash
npm run test:service:stress
```

### 5. Field Replica Integration
Specifically mimics the exact observations and timings from real-world field tests (like the 7m approach flip and home-parking anti-spam rules) to ensure the engine behaves correctly in real-life edge cases.

```bash
npm run test:service:replica
```

### 6. 🚀 Telemetry Replay (Real-World Data)
Parses all `telemetry_log*.json` flight recorder files found in `ai/data/`, synthesizes the exact GPS movement, and streams them through the AI service layer.

```bash
# Run against all logs
npm run test:service:telemetry

# Run against a specific log only
LOG_FILE=telemetry_log6.json npm run test:service:telemetry
```

### 7. 🌪️ Telemetry Fuzzing (Real-World Stress)
The ultimate robustness test. It takes all real-world telemetry logs and applies intense, randomized chaos to every frame.

```bash
# Stress test all logs
npm run test:service:telemetry:stress

# Stress test a specific log only
LOG_FILE=telemetry_log6.json npm run test:service:telemetry:stress
```

---

## 🛠 Troubleshooting

*   **"TypeError: this._moduleMocker.clearMocksOnScope is not a function"** or **Native Binary Errors**:
    If you try to run the standard `npm test` or `jest` directly, it will fail due to React Native and TensorFlow native binaries. **Always use the specific `test:service:...` npm scripts above**, as they use the `jest-simple.config.js` and `binaryMock.js` files to bypass these issues.

*   **Test Timeouts:**
    The Telemetry Replay tests iterate through thousands of frames and can take 8-15 seconds to run. They are configured with a 30,000ms (30s) timeout to accommodate this on slower machines.