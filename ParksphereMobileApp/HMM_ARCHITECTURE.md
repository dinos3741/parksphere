# Parksphere HMM Architecture Overview

This document provides a map of the files responsible for the automatic motion detection system (Hidden Markov Model). Use this as a guide when comparing system behavior across different branches or versions.

## 1. The Core Logic (The "Brain")
These files contain the mathematical models and state transition logic.

*   **`utils/parkDetection_HMM.js`**
    *   **Purpose:** The primary engine.
    *   **Logic:** Contains the Hidden Markov Model (HMM) state machine, transition matrices (probability of moving between states), Kalman filters for speed/position smoothing, and emission log probabilities (how sensor data maps to states).
    *   **Key Constants:** `STATES`, `A` (Transition Matrix), `AWAY_THRESHOLD`, `RETURN_ZONE_RADIUS`.

*   **`utils/parkDetectionService.js`**
    *   **Purpose:** The system manager.
    *   **Logic:** Handles the "plumbing." Subscribes to hardware sensors (Accelerometer, Pedometer, Bluetooth), manages the `TaskManager` for background execution, and handles state persistence via `AsyncStorage`.
    *   **Key Functions:** `handleLocationUpdate`, `triggerVirtualUpdate`, `declareSpot`.

## 2. Execution & Integration (The "Bridge")
These files connect the detection engine to the rest of the application.

*   **`hooks/useParkDetectionEngine.js`**
    *   **Purpose:** React Lifecycle integration.
    *   **Logic:** Starts/stops the engine based on user login status and preferences. Injects the Bluetooth connectivity state as a high-priority signal into the HMM.

*   **`hooks/useBluetoothMonitoring.js`**
    *   **Purpose:** Hardware signal provider.
    *   **Logic:** Monitors the device's Bluetooth connection status specifically for car-linked devices.

*   **`utils/dataReset.js`**
    *   **Purpose:** State cleanup.
    *   **Logic:** Defines how the HMM state and associated parking data are cleared, ensuring a "clean slate" for new detection runs.

## 3. Simulation & Validation (The "Testing Lab")
These files are used to verify and debug the behavior without needing a physical drive.

*   **`components/DebugSimulator.js`**
    *   **Purpose:** UI-based simulation tool.
    *   **Logic:** Generates mock location updates with progressive coordinate offsets to simulate physical displacement (required for trip distance and "Away" detection).

*   **`utils/simulationScenarios.js`**
    *   **Purpose:** Pre-defined test cases.
    *   **Logic:** Scripts sequences of movement (Driving -> Stopping -> Walking) to test specific edge cases like red lights or public transport.

*   **`utils/hmm-test-runner.js` & `utils/__tests__/hmm_scenarios.test.js`**
    *   **Purpose:** Headless validation.
    *   **Logic:** Runs the HMM engine against scenarios in a pure JavaScript environment (Node/Jest) to ensure logic changes haven't introduced regressions.

---
*Last Updated: May 24, 2026*
