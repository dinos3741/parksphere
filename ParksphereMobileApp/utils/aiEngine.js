import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-react-native';
import { bundleResourceIO } from '@tensorflow/tfjs-react-native';

const modelJson = require('../assets/tfjs_model/model.json');
const modelWeights = require('../assets/tfjs_model/group1-shard1of1.bin');
const scalerParams = require('../assets/tfjs_model/scaler_params.json');

let model = null;
let isReady = false;

const WINDOW_SIZE = 30;
let featureBuffer = [];

export async function initAIEngine() {
  try {
    await tf.ready();
    console.log('[AIEngine] TF backend ready.');
    model = await tf.loadGraphModel(bundleResourceIO(modelJson, modelWeights));
    isReady = true;
    console.log('[AIEngine] TFJS Model loaded successfully.');
  } catch (err) {
    console.error('[AIEngine] Failed to load TFJS Model:', err);
  }
}

export async function predictReturning(features) {
  if (!isReady || !model) return 0;
  
  featureBuffer.push(features);
  if (featureBuffer.length > WINDOW_SIZE) {
    featureBuffer.shift();
  }
  
  if (featureBuffer.length < WINDOW_SIZE) return 0;

  try {
    // Apply scaler
    const scaledData = featureBuffer.map(f => {
      return [
        (f.speed - scalerParams.mean[0]) / scalerParams.scale[0],
        (f.stepRate - scalerParams.mean[1]) / scalerParams.scale[1],
        (f.accel - scalerParams.mean[2]) / scalerParams.scale[2],
        (f.pgr - scalerParams.mean[3]) / scalerParams.scale[3],
        (f.pgrSlope - scalerParams.mean[4]) / scalerParams.scale[4],
        (f.approachAlignment - scalerParams.mean[5]) / scalerParams.scale[5],
        (f.deltaRate - scalerParams.mean[6]) / scalerParams.scale[6]
      ];
    });

    const inputTensor = tf.tensor3d([scaledData], [1, WINDOW_SIZE, 7]);
    
    // The graph model expects a specific input name. Usually it's 'keras_tensor' for sequential inputs converted this way, 
    // or just the first input. TFJS loadGraphModel usually figures it out if we just pass the tensor.
    // However, if it fails, we might need model.execute.
    const prediction = model.predict(inputTensor);
    const result = await prediction.data();
    
    inputTensor.dispose();
    prediction.dispose();
    
    return result[0];
  } catch (e) {
    console.error('[AIEngine] Prediction error:', e);
    return 0;
  }
}

export function resetAIBuffer() {
  featureBuffer = [];
}
