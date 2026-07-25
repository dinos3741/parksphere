import Foundation

// R7 Phase D — port of aiEngine.js's sliding-window buffering + z-score scaling + predictReturning(),
// wrapping ParkReturnCNN's forward pass. Standalone for now (like Phases A/B) — Phase E feeds it
// real per-fix features from the HMM engine's result and wires its output into HMMFusion.
final class ParkReturnPredictor {
  private static let windowSize = 30
  private var featureBuffer: [[Float]] = []

  // Feature order matches scaler_params.json / aiEngine.js exactly:
  // speed, stepRate, accel, pgr, pgrSlope, approachAlignment, deltaRate.
  struct Features {
    var speed: Double
    var stepRate: Double
    var accel: Double
    var pgr: Double
    var pgrSlope: Double
    var approachAlignment: Double
    var deltaRate: Double
  }

  // Port of resetAIBuffer (aiEngine.js :69-71).
  func reset() {
    featureBuffer.removeAll()
  }

  // Returns 0 until the 30-sample buffer is full, exactly like JS (aiEngine.js :28,35).
  @discardableResult
  func predict(_ features: Features) -> Double {
    let raw: [Float] = [
      Float(features.speed), Float(features.stepRate), Float(features.accel),
      Float(features.pgr), Float(features.pgrSlope), Float(features.approachAlignment),
      Float(features.deltaRate),
    ]
    let scaled = raw.enumerated().map { i, v in
      (v - ParkReturnCNNWeights.scalerMean[i]) / ParkReturnCNNWeights.scalerScale[i]
    }

    featureBuffer.append(scaled)
    if featureBuffer.count > ParkReturnPredictor.windowSize { featureBuffer.removeFirst() }
    guard featureBuffer.count == ParkReturnPredictor.windowSize else { return 0 }

    return Double(ParkReturnCNN.predict(featureBuffer))
  }
}
