import Foundation

// R7 Phase D — hand-ported forward pass for the bundled park-return CNN (utils/aiEngine.js +
// assets/tfjs_model), using weights extracted by ai/export_cnn_weights_to_swift.js into
// ParkReturnCNNWeights.swift. The layer order below was verified op-by-op against the frozen
// graph (model.json node inputs), not assumed from typical Keras layer order — note the somewhat
// unusual Conv+Bias -> ReLU -> BatchNorm sequence (BN applied AFTER the activation: the graph's
// batch_normalization_1/batchnorm/mul_1 op takes conv1d_1/Relu as its input, not the raw conv
// output — confirmed by tracing every op's `input` list directly, not by paraphrase).
//
// Architecture: Input(30,7) -> Conv1D(32,k=3,valid)+Bias -> ReLU -> BatchNorm(mul,sub) ->
// MaxPool1D(pool=2,stride=2) -> Conv1D(64,k=3,valid)+Bias -> ReLU -> BatchNorm(mul,sub) ->
// GlobalAveragePooling1D -> Dense(32)+ReLU -> Dense(1)+Sigmoid.
enum ParkReturnCNN {
  // MARK: - Layer primitives

  // Conv1D, VALID padding. Kernel is flattened from TF's [1, kernelSize, inChannels, outChannels]
  // (row-major: index = (kw*inChannels + ic)*outChannels + oc — the leading dim of 1 is trivial).
  private static func conv1D(
    input: [[Float]], kernel: [Float], bias: [Float],
    kernelSize: Int, inChannels: Int, outChannels: Int
  ) -> [[Float]] {
    let outSteps = input.count - kernelSize + 1
    var output = [[Float]](repeating: [Float](repeating: 0, count: outChannels), count: outSteps)
    for t in 0..<outSteps {
      for oc in 0..<outChannels {
        var sum: Float = bias[oc]
        for kw in 0..<kernelSize {
          let row = input[t + kw]
          let base = (kw * inChannels) * outChannels + oc
          for ic in 0..<inChannels {
            sum += row[ic] * kernel[base + ic * outChannels]
          }
        }
        output[t][oc] = sum
      }
    }
    return output
  }

  private static func relu2D(_ x: [[Float]]) -> [[Float]] {
    x.map { row in row.map { max(0, $0) } }
  }

  private static func batchNorm2D(_ x: [[Float]], mul: [Float], sub: [Float]) -> [[Float]] {
    x.map { row in row.enumerated().map { i, v in v * mul[i] + sub[i] } }
  }

  private static func maxPool1D(_ x: [[Float]], pool: Int, stride: Int) -> [[Float]] {
    let channels = x.first?.count ?? 0
    let outSteps = (x.count - pool) / stride + 1
    var output = [[Float]](repeating: [Float](repeating: 0, count: channels), count: outSteps)
    for t in 0..<outSteps {
      let start = t * stride
      for c in 0..<channels {
        var m = x[start][c]
        for k in 1..<pool { m = max(m, x[start + k][c]) }
        output[t][c] = m
      }
    }
    return output
  }

  private static func globalAveragePool1D(_ x: [[Float]]) -> [Float] {
    let channels = x.first?.count ?? 0
    var sums = [Float](repeating: 0, count: channels)
    for row in x { for c in 0..<channels { sums[c] += row[c] } }
    let n = Float(x.count)
    return sums.map { $0 / n }
  }

  // Dense, kernel flattened row-major [inFeatures, outFeatures].
  private static func dense(_ x: [Float], kernel: [Float], bias: [Float], inFeatures: Int, outFeatures: Int, relu: Bool) -> [Float] {
    var out = [Float](repeating: 0, count: outFeatures)
    for o in 0..<outFeatures {
      var sum: Float = bias[o]
      for i in 0..<inFeatures {
        sum += x[i] * kernel[i * outFeatures + o]
      }
      out[o] = relu ? max(0, sum) : sum
    }
    return out
  }

  private static func sigmoid(_ x: Float) -> Float {
    1.0 / (1.0 + exp(-x))
  }

  // MARK: - Forward pass

  // input: 30 timesteps x 7 (already z-score scaled) features. Returns the sigmoid output (0...1).
  static func predict(_ input: [[Float]]) -> Float {
    let w = ParkReturnCNNWeights.self

    var x = conv1D(input: input, kernel: w.conv1Kernel, bias: w.conv1Bias, kernelSize: 3, inChannels: 7, outChannels: 32)
    x = relu2D(x)
    x = batchNorm2D(x, mul: w.bn1Mul, sub: w.bn1Sub)
    x = maxPool1D(x, pool: 2, stride: 2)

    x = conv1D(input: x, kernel: w.conv2Kernel, bias: w.conv2Bias, kernelSize: 3, inChannels: 32, outChannels: 64)
    x = relu2D(x)
    x = batchNorm2D(x, mul: w.bn2Mul, sub: w.bn2Sub)

    let pooled = globalAveragePool1D(x)
    let d1 = dense(pooled, kernel: w.dense1Kernel, bias: w.dense1Bias, inFeatures: 64, outFeatures: 32, relu: true)
    let d2 = dense(d1, kernel: w.dense2Kernel, bias: w.dense2Bias, inFeatures: 32, outFeatures: 1, relu: false)

    return sigmoid(d2[0])
  }
}
