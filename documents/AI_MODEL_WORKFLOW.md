# Parksphere AI Model Workflow

This document explains how the "Returning" AI model works within the Parksphere mobile app and the exact steps required to update it when new telemetry data is collected.

## 1. How the Model Works in the App

The AI model is a Convolutional Neural Network (CNN) trained to detect the precise movement patterns of a user returning to their parked car. 

*   **Bundling:** The model weights (`group1-shard1of1.bin`), architecture (`model.json`), and normalization parameters (`scaler_params.json`) are stored in `ParksphereMobileApp/assets/tfjs_model/`. These files are bundled directly into the React Native app when built.
*   **Execution:** The engine (`ParksphereMobileApp/utils/aiEngine.js`) uses TensorFlow.js (`@tensorflow/tfjs-react-native`) to run predictions entirely offline on the device.
*   **Integration:** In `parkDetectionService.js`, the app continuously feeds a 30-second rolling window of scaled telemetry data (speed, step rate, acceleration, PGR, etc.) to the model. 
*   **Trigger:** If the model predicts "User is returning" with a confidence of **> 99.6%**, the app instantly sends a `soon_free` status to the server, preempting the standard HMM rules for a faster UI response.

---

## 2. How to Update the Model with New Data

The model is static on the device. If you gather new telemetry data to improve accuracy or fix edge cases, you must retrain the model locally and update the app's bundled files.

Follow these steps from the `ParksphereMobileApp/ai/` directory:

### Step 1: Retrain the Model
Place your new `.json` telemetry logs in your data directory (e.g., `data/`). Then, run the training script.

```bash
# Ensure you are in the virtual environment or using its python
./venv/bin/python train.py
```
*   **Output:** This updates `returning_cnn_model.h5` (the raw Keras weights) and generates a new `scaler_params.json` (crucial for ensuring the app normalizes live data exactly as the model expects).

### Step 2: Export to a Full SavedModel
The standard `train.py` saves a "weights-only" H5 file, which the TFJS converter cannot process directly. Run the custom converter script to wrap these weights back into a complete model architecture and export it.

```bash
./venv/bin/python convert.py
```
*   **Output:** A directory named `saved_model/` containing the full TensorFlow SavedModel structure.

### Step 3: Convert to TensorFlow.js Format
Use the TensorFlow.js converter to translate the `saved_model` into a format optimized for the web and React Native.

```bash
./venv/bin/tensorflowjs_converter \
  --input_format tf_saved_model \
  --output_format tfjs_graph_model \
  saved_model tfjs_model
```
*   **Output:** The `tfjs_model/` directory will now contain a `model.json` and one or more `.bin` files.

### Step 4: Update the App Assets
Finally, copy the newly converted model and the updated scaler parameters into the React Native app's asset folder so they are included in the next build.

```bash
# From the ParksphereMobileApp/ai/ directory:
cp tfjs_model/* ../assets/tfjs_model/
cp scaler_params.json ../assets/tfjs_model/
```

### Step 5: Test
Reload your Metro bundler (clearing the cache is recommended to ensure the new `.bin` files are picked up):
```bash
npm start -- --reset-cache
```

Your app is now running with the updated AI brain!
