#!/usr/bin/env node
// R7 Phase D — one-time export of the bundled TFJS park-return CNN's weights (assets/tfjs_model/
// model.json + group1-shard1of1.bin) into a Swift source file the native forward-pass port
// (ParkDetectionCNN.swift) reads as plain Float arrays. Re-run this only if the model is retrained
// and the .bin/.json are replaced — the generated Swift file is what actually ships.
//
// Usage: node ai/export_cnn_weights_to_swift.js

const fs = require('fs');
const path = require('path');

const MODEL_DIR = path.join(__dirname, '..', 'assets', 'tfjs_model');
const modelJsonPath = path.join(MODEL_DIR, 'model.json');
const binPath = path.join(MODEL_DIR, 'group1-shard1of1.bin');
const scalerPath = path.join(MODEL_DIR, 'scaler_params.json');
const outPath = path.join(__dirname, '..', 'modules', 'visit-monitor', 'ios', 'ParkReturnCNNWeights.swift');

const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf8'));
const scaler = JSON.parse(fs.readFileSync(scalerPath, 'utf8'));
const buf = fs.readFileSync(binPath);

const manifest = modelJson.weightsManifest[0];
const dtypeBytes = { float32: 4, int32: 4 };

// Walk the shard sequentially in manifest order, slicing each tensor's raw bytes.
let offset = 0;
const tensors = {};
for (const w of manifest.weights) {
  const numel = (w.shape && w.shape.length > 0) ? w.shape.reduce((a, b) => a * b, 1) : 1;
  const nbytes = numel * dtypeBytes[w.dtype];
  const slice = buf.subarray(offset, offset + nbytes);
  if (w.dtype === 'float32') {
    tensors[w.name] = { shape: w.shape, data: Array.from(new Float32Array(slice.buffer, slice.byteOffset, numel)) };
  } else if (w.dtype === 'int32') {
    tensors[w.name] = { shape: w.shape, data: Array.from(new Int32Array(slice.buffer, slice.byteOffset, numel)) };
  } else {
    throw new Error(`Unexpected dtype ${w.dtype} for ${w.name}`);
  }
  offset += nbytes;
}
if (offset !== buf.length) {
  throw new Error(`Byte mismatch: consumed ${offset}, file is ${buf.length} — manifest/shard out of sync`);
}

// Only the float32 weight tensors the hand-ported forward pass actually needs (the int32 consts
// are just op parameters — axis indices — already baked into the Swift port's fixed structure).
const NEEDED = {
  conv1Kernel: 'StatefulPartitionedCall/sequential_1/conv1d_1/convolution/ExpandDims_1', // [1,3,7,32]
  conv1Bias: 'StatefulPartitionedCall/sequential_1/conv1d_1/Squeeze',                     // [32]
  bn1Mul: 'StatefulPartitionedCall/sequential_1/batch_normalization_1/batchnorm/mul',     // [32]
  bn1Sub: 'StatefulPartitionedCall/sequential_1/batch_normalization_1/batchnorm/sub',     // [32]
  conv2Kernel: 'StatefulPartitionedCall/sequential_1/conv1d_1_2/convolution/ExpandDims_1',// [1,3,32,64]
  conv2Bias: 'StatefulPartitionedCall/sequential_1/conv1d_1_2/Squeeze',                   // [64]
  bn2Mul: 'StatefulPartitionedCall/sequential_1/batch_normalization_1_2/batchnorm/mul',   // [64]
  bn2Sub: 'StatefulPartitionedCall/sequential_1/batch_normalization_1_2/batchnorm/sub',   // [64]
  dense1Kernel: 'StatefulPartitionedCall/sequential_1/dense_1/Cast/ReadVariableOp',       // [64,32]
  dense1Bias: 'StatefulPartitionedCall/sequential_1/dense_1/BiasAdd/ReadVariableOp',      // [32]
  dense2Kernel: 'StatefulPartitionedCall/sequential_1/dense_1_2/Cast/ReadVariableOp',     // [32,1]
  dense2Bias: 'StatefulPartitionedCall/sequential_1/dense_1_2/Add/ReadVariableOp',        // [1]
};

for (const [key, name] of Object.entries(NEEDED)) {
  if (!tensors[name]) throw new Error(`Missing expected tensor: ${name}`);
}

function swiftFloatArray(values) {
  return '[' + values.map(v => {
    if (Number.isInteger(v)) return v.toFixed(1);
    return String(v);
  }).join(', ') + ']';
}

let out = `// GENERATED FILE — do not hand-edit. Regenerate with:
//   node ai/export_cnn_weights_to_swift.js
// Source: assets/tfjs_model/{model.json,group1-shard1of1.bin,scaler_params.json}
//
// Weights for the park-return CNN (R7 Phase D), forward-pass math in ParkReturnCNN.swift.
// Architecture: Input(30,7) -> Conv1D(32,k=3,valid)+BN+ReLU -> MaxPool1D(pool=2) ->
// Conv1D(64,k=3,valid)+BN+ReLU -> GlobalAveragePooling1D -> Dense(32,ReLU) -> Dense(1,Sigmoid)

enum ParkReturnCNNWeights {
`;

for (const [key, name] of Object.entries(NEEDED)) {
  const t = tensors[name];
  out += `  // shape ${JSON.stringify(t.shape)}\n`;
  out += `  static let ${key}: [Float] = ${swiftFloatArray(t.data)}\n\n`;
}

out += `  // z-score scaler (scaler_params.json) — feature order: ${scaler.features.join(', ')}\n`;
out += `  static let scalerMean: [Float] = ${swiftFloatArray(scaler.mean)}\n`;
out += `  static let scalerScale: [Float] = ${swiftFloatArray(scaler.scale)}\n`;
out += `}\n`;

fs.writeFileSync(outPath, out);
console.log(`Wrote ${outPath} (${out.length} bytes)`);
for (const [key, name] of Object.entries(NEEDED)) {
  console.log(`  ${key}: ${tensors[name].shape} (${tensors[name].data.length} values)`);
}
