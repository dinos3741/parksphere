import Foundation
import CoreMotion

// R7 — Phase B: step rate, port of parkDetectionService.js's Pedometer wiring (:854-883, :125-141)
// and its staleness-gating (:442-461). Two CMPedometer APIs mirror JS's two Pedometer calls:
//  - startUpdates(from:) → live cumulative count, used ONLY to detect "a step just happened"
//    (mirrors Pedometer.watchStepCount) — updates lastStepTimestamp, nothing else.
//  - queryPedometerData(from:to:) → an 8s trailing window queried on demand for the actual rate
//    (mirrors getRecentStepRate/Pedometer.getStepCountAsync).
//
// Standalone for now (builds and is independently usable) — Phase E wires refreshCurrentStepRate()
// into the liveUpdates loop and gatedStepRate() into HMMSupplemental.stepRate.
final class StepRateProvider {
  private let pedometer = CMPedometer()
  private var lastReportedSteps = 0
  private var lastStepTimestamp: Date = .distantPast // JS's lastStepTimestamp=0 — cold start reads as "ages ago"
  private var currentStepRate: Double = 0

  static var isAvailable: Bool { CMPedometer.isStepCountingAvailable() }

  // Live cumulative-count watch — mirrors watchStepCount (parkDetectionService.js :854-883): only
  // used to detect that a step just happened. Matches JS's "Foreground-Resume Guard" (ignore a
  // non-increasing ping while stationary) and its OS-reset handling (count drops back to 0).
  func start() {
    guard StepRateProvider.isAvailable else { return }
    lastReportedSteps = 0
    pedometer.startUpdates(from: Date()) { [weak self] data, _ in
      guard let self = self, let data = data else { return }
      let steps = data.numberOfSteps.intValue
      if steps > self.lastReportedSteps {
        self.lastReportedSteps = steps
        self.lastStepTimestamp = Date()
      } else if steps < self.lastReportedSteps {
        self.lastReportedSteps = steps
        if steps > 0 { self.lastStepTimestamp = Date() }
      }
    }
  }

  func stop() {
    pedometer.stopUpdates()
  }

  // Port of resetParkDetection's step-rate reset (parkDetectionService.js :1378-1380).
  func reset() {
    currentStepRate = 0
    lastStepTimestamp = .distantPast
    lastReportedSteps = 0
  }

  // 8-second trailing-window rate query — mirrors getRecentStepRate (parkDetectionService.js
  // :125-141). Call periodically (Phase E: once per liveUpdates iteration, matching JS's
  // once-per-foreground-call / once-per-batch cadence) to refresh currentStepRate before reading
  // gatedStepRate().
  @discardableResult
  func refreshCurrentStepRate() async -> Double {
    guard StepRateProvider.isAvailable else {
      currentStepRate = 0
      return 0
    }
    let end = Date()
    let start = end.addingTimeInterval(-8)
    do {
      let data: CMPedometerData = try await withCheckedThrowingContinuation { continuation in
        pedometer.queryPedometerData(from: start, to: end) { data, error in
          if let data = data {
            continuation.resume(returning: data)
          } else {
            continuation.resume(throwing: error ?? NSError(domain: "StepRateProvider", code: -1))
          }
        }
      }
      currentStepRate = data.numberOfSteps.doubleValue / 8.0
    } catch {
      currentStepRate = 0
    }
    return currentStepRate
  }

  // Staleness gating (parkDetectionService.js :442-461 — the isFromSimulator branch is dropped,
  // it has no equivalent for a real native CLLocation fix): trust the freshly-queried rate only
  // while a physical step is recent; force to 0 once stale enough to be just Apple's 8s
  // trailing-average lag rather than real current movement.
  func gatedStepRate() -> Double {
    let timeSinceLastStepMs = Date().timeIntervalSince(lastStepTimestamp) * 1000.0
    if timeSinceLastStepMs < 4000 {
      return currentStepRate
    } else if timeSinceLastStepMs > 5000 {
      currentStepRate = 0
      return 0
    } else {
      return currentStepRate
    }
  }
}
