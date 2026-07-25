import Foundation
import CoreLocation

// R7 — Phase A: full port of the foreground JS detection engine
// (parkDetection_HMM.js + the fusion/EMA layer of parkDetectionService.js) to native Swift.
//
// Ported verbatim (states, transition matrix, emission model, forward filter, hysteresis,
// intent-lock, trip accumulation, away/arrival detection, park/clear event detection, the
// Kalman position/speed filters, PGR + pgrConsistency, and the 40/40/20 fusion + second EMA).
//
// Deliberately NOT ported (see the plan's "Explicit scope decisions"):
//  - JS's per-invocation AsyncStorage restore of belief/counters/state (`supplemental.previousState`
//    etc., parkDetection_HMM.js:558-582) — this engine is a persistent class instance living for the
//    life of the native background session, so its own instance state IS the persistence, unlike JS
//    which is stateless per call. Cross-PROCESS-relaunch persistence is a separate Phase E concern.
//  - JS's queue/batch delivery machinery — this engine is fed one fix at a time by the existing
//    liveUpdates loop (VisitMonitorModule.swift), which already proved superior to JS's old
//    TaskManager-batch model.
//  - Bluetooth detection — wired (Phase E) to the existing native AVAudioSession-based signal
//    (VisitMonitorModule's carBtConnected/CarAudioModule), which is strictly better than JS's
//    Android-only name-matching heuristic.
//
// Phase A feeds stepRate/accel/spectralFeatures as neutral placeholders via HMMSupplemental's
// defaults — Phases B/C/D wire in the real CMPedometer/CMMotionManager-FFT/CNN values. The
// formulas below are already complete and correct for when those arrive; only the caller-supplied
// inputs are missing until then.

// MARK: - States & transition matrix (port of parkDetection_HMM.js :8-51)

enum HMMState: String, CaseIterable, Hashable {
  case idle = "IDLE"
  case walking = "WALKING"
  case driving = "DRIVING"
  case stopped = "STOPPED"
  case returning = "RETURNING"
}

typealias HMMBelief = [HMMState: Double]

private let hmmTransitionMatrix: [HMMState: [HMMState: Double]] = [
  .idle: [.idle: 0.72, .walking: 0.2, .returning: 0.03, .driving: 0.04, .stopped: 0.01],
  .walking: [.walking: 0.56, .idle: 0.11, .driving: 0.03, .returning: 0.3],
  .driving: [.driving: 0.85, .stopped: 0.13, .walking: 0.02],
  .stopped: [.stopped: 0.87, .driving: 0.08, .walking: 0.03, .idle: 0.02],
  .returning: [.returning: 0.65, .stopped: 0.25, .idle: 0.05, .walking: 0.05],
]

// MARK: - Observation / context / supplemental / result types

struct HMMActivity {
  var automotive = false
  var walking = false
  var stationary = false
  var unknown = true
  var confidence = 0 // 0 / 1 / 2 — matches JS's numeric activity.confidence (low/medium/high)
}

struct SpectralFeatures {
  var walkingEnergy: Double = 0
  var vehicleEnergy: Double = 0
  var spectralEntropy: Double = 0
  var dominantFreq: Double = 0
}

private struct HMMObservation {
  var speed: Double
  var stepRate: Double
  var accel: Double
  var dist: Double
  var deltaRate: Double
  var accuracy: Double
  var approachAlignment: Double
  var pgr: Double
  var slope: Double
  var pgrConsistency: Double
  var activity: HMMActivity?
  var isPhysicallyStill: Bool
  var bluetoothConnected: Bool
  var spectralFeatures: SpectralFeatures
}

private struct HMMContext {
  var hasParkedLocation: Bool
  var deltaRate: Double
  var stepRate: Double
  var dist: Double
  var speed: Double
  var pgr: Double
  var slope: Double
  var pgrConsistency: Double
  var isAway: Bool
  var activity: HMMActivity?
  var isPhysicallyStill: Bool
  var bluetoothConnected: Bool
  var spectralFeatures: SpectralFeatures
  var drivingCounter: Int
}

// Everything the engine can't derive from the GPS fix alone — port of JS's `supplemental` object.
// Defaults are the Phase-A neutral placeholders (no steps, no accel/spectral evidence yet).
struct HMMSupplemental {
  var stepRate: Double = 0
  var accelerationMagnitude: Double? = nil
  var motionActivity: HMMActivity? = nil
  var bluetoothConnected: Bool = false
  var spectralFeatures: SpectralFeatures? = nil
  var accuracy: Double = 10
}

struct HMMResult {
  var state: HMMState
  var bestState: HMMState
  var confidence: Double
  var belief: HMMBelief
  var parkedEvent: Bool
  var awayEvent: Bool
  var clearParkingEvent: Bool
  var isAway: Bool
  var distToParked: Double
  var deltaRate: Double
  var filteredSpeed: Double
  var filteredCoords: CLLocationCoordinate2D
  var pgr: Double
  var slope: Double
  var pgrConsistency: Double
  var approachAlignment: Double
}

// MARK: - Math helpers (port of parkDetection_HMM.js :325-334)

private func logGaussian(_ x: Double, _ mean: Double, _ std: Double) -> Double {
  let s = max(std, 0.3)
  return -pow(x - mean, 2) / (2 * s * s)
}

private func logSigmoid(_ x: Double, _ midpoint: Double, _ steepness: Double) -> Double {
  let z = steepness * (x - midpoint)
  if z > 20 { return 0 }
  if z < -20 { return z }
  return -log(1 + exp(-z))
}

// MARK: - Position Kalman filter (port of Kalman2D, parkDetection_HMM.js :106-146)
//
// 4-state constant-velocity filter [px, py, vx, vy] in absolute local meters (equirectangular
// projection, matching JS's latLonToMeters — NOT car-relative, unlike R6's ReturnPositionFilter).
// Measurement noise R scales with accuracy² (floored at 25): a low-accuracy fix barely moves the
// filtered estimate. dt is supplied by the caller (the engine's own temporal-replay dt guard) to
// match JS exactly, rather than derived internally from wall-clock time.
private final class HMMKalman2D {
  private(set) var x: [Double] = [0, 0, 0, 0]
  private var P: [[Double]] = HMMKalman2D.diag(1000)
  private var seeded = false

  var vx: Double { x[2] }
  var vy: Double { x[3] }

  private static func diag(_ v: Double) -> [[Double]] {
    (0..<4).map { i in (0..<4).map { j in i == j ? v : 0 } }
  }

  func reset() {
    x = [0, 0, 0, 0]
    P = HMMKalman2D.diag(1000)
    seeded = false
  }

  func update(z: [Double], dt: Double, accuracy: Double) -> (Double, Double) {
    guard seeded else {
      seeded = true
      x[0] = z[0]; x[1] = z[1]
      return (x[0], x[1])
    }
    let qv = 0.1, rVal = max(25.0, accuracy * accuracy)

    // Predict: x = F x, P = F P Fᵀ + Q, F = [[1,0,dt,0],[0,1,0,dt],[0,0,1,0],[0,0,0,1]]
    let px = x[0] + dt * x[2], py = x[1] + dt * x[3]
    x = [px, py, x[2], x[3]]
    var fp = [[Double]](repeating: [Double](repeating: 0, count: 4), count: 4)
    for i in 0..<4 {
      for j in 0..<4 {
        fp[i][j] = P[i][j] + (i == 0 ? dt * P[2][j] : 0) + (i == 1 ? dt * P[3][j] : 0)
      }
    }
    var fpFt = [[Double]](repeating: [Double](repeating: 0, count: 4), count: 4)
    for i in 0..<4 {
      for j in 0..<4 {
        fpFt[i][j] = fp[i][j] + (j == 0 ? dt * fp[i][2] : 0) + (j == 1 ? dt * fp[i][3] : 0)
      }
    }
    for i in 0..<4 { for j in 0..<4 { P[i][j] = fpFt[i][j] + (i == j ? qv : 0) } }

    // Update against z = [x, y] (H picks the position rows/cols)
    let yx = z[0] - x[0], yy = z[1] - x[1]
    let s00 = P[0][0] + rVal, s01 = P[0][1], s10 = P[1][0], s11 = P[1][1] + rVal
    let det = s00 * s11 - s01 * s10
    guard abs(det) > 1e-6 else { return (x[0], x[1]) }
    let si00 = s11 / det, si01 = -s01 / det, si10 = -s10 / det, si11 = s00 / det

    var k = [[Double]](repeating: [0, 0], count: 4)
    for i in 0..<4 {
      k[i][0] = P[i][0] * si00 + P[i][1] * si10
      k[i][1] = P[i][0] * si01 + P[i][1] * si11
    }
    for i in 0..<4 { x[i] += k[i][0] * yx + k[i][1] * yy }

    var newP = P
    for i in 0..<4 {
      for j in 0..<4 {
        newP[i][j] = P[i][j] - k[i][0] * P[0][j] - k[i][1] * P[1][j]
      }
    }
    P = newP
    return (x[0], x[1])
  }
}

// MARK: - Speed Kalman filter (port of Kalman1D, parkDetection_HMM.js :78-99)
private final class HMMKalman1D {
  private let q: Double
  private let r: Double
  private var x: Double = 0
  private var p: Double = 1

  init(q: Double = 0.01, r: Double = 3.0) {
    self.q = q
    self.r = r
  }

  func reset() {
    x = 0
    p = 1
  }

  // Asymmetric gain: fast to follow a speed DROP near stopping (<10 km/h) so a real stop isn't
  // smoothed into a phantom drive; slow (normal Kalman gain) everywhere else so GPS jitter can't
  // drag the estimate around.
  func update(_ z: Double) -> Double {
    p += q
    let k = p / (p + r)
    let fastDrop = z < x && z < 10
    let effectiveK = fastDrop ? max(k, 0.5) : k
    x = x + effectiveK * (z - x)
    p = (1 - effectiveK) * p
    return x
  }
}

// MARK: - Fusion (port of parkDetectionService.js :693-706)
//
// A SECOND, separate EMA layer from the smoothing already inside the HMM belief/PGR — JS smooths
// the fused (HMM + AI + alignment) output again as a "flywheel" against residual frame jitter.
struct HMMFusion {
  private(set) var smoothedConfidence: Double = 0
  private static let alpha = 0.2 // JS ALPHA

  @discardableResult
  mutating func update(
    hmmBelief: Double, aiConfidence: Double, approachAlignment: Double,
    isAway: Bool, hasParkedLocation: Bool, distToParked: Double, alertMaxRange: Double = 200
  ) -> Double {
    var raw = 0.0
    if isAway && hasParkedLocation && distToParked < alertMaxRange {
      let pgrNorm = max(0, approachAlignment)
      raw = (hmmBelief * 0.4) + (aiConfidence * 0.4) + (pgrNorm * 0.2)
      if raw.isNaN { raw = 0 }
    }
    smoothedConfidence = (HMMFusion.alpha * raw) + ((1 - HMMFusion.alpha) * smoothedConfidence)
    return smoothedConfidence
  }

  mutating func reset() {
    smoothedConfidence = 0
  }
}

// MARK: - Transition gating (port of isTransitionAllowed, parkDetection_HMM.js :254-318)

private func isHMMTransitionAllowed(from: HMMState, to: HMMState, context: HMMContext) -> Bool {
  // WALKING rules
  if to == .walking && from != .walking {
    let hasSteps = context.stepRate >= 0.05
    let hasWalkingActivity = context.activity?.walking ?? false
    if !hasSteps && !hasWalkingActivity { return false }
  }
  if to == .walking && context.speed > 15 { return false }

  // DRIVING rules
  if to == .driving && from != .driving {
    let hasAutomotiveActivity = (context.activity?.automotive ?? false) && (context.activity?.confidence ?? 0) >= 1
    let hasStrongCarSignal = context.bluetoothConnected || hasAutomotiveActivity
    let effectiveCarSignal = hasStrongCarSignal || from == .stopped
    let speedFloor: Double = effectiveCarSignal ? 2.5 : 10
    if context.speed < speedFloor { return false }
    if context.speed < 20 && !effectiveCarSignal { return false }
    if context.stepRate > 0.35 { return false }
    if from == .idle && context.speed < 15 && !hasStrongCarSignal { return false }
    if from == .walking && context.speed < 25 && !hasStrongCarSignal { return false }
  }

  // STOPPED rules
  if to == .stopped && from != .stopped {
    let hasStrongCarSignal = context.bluetoothConnected || ((context.activity?.automotive ?? false) && (context.activity?.confidence ?? 0) >= 1)
    if from != .driving && from != .returning && !(from == .idle && hasStrongCarSignal) { return false }
  }

  if to == .returning && !context.hasParkedLocation { return false }
  if to == .returning && !context.isAway { return false }
  if to == .returning && ![.walking, .idle, .returning].contains(from) { return false }
  if to == .returning && context.dist < 1.0 { return false }

  if from == .walking && to == .returning {
    if context.deltaRate > -0.1 && context.pgr < 0.2 { return false }
  }

  return true
}

// MARK: - Engine

final class ParkDetectionHMMEngine {
  private static let returnZoneRadius = 200.0
  private static let awayThreshold = 15.0
  private static let progressWindowSize = 15
  private static let pgrHistoryCap = 15
  private static let earthRadiusM = 6371000.0
  // R7 field-test fix (2026-07-26, native-only deviation from JS parity — see the state-switch
  // block below): how close you must actually be to the car for a RETURNING→STOPPED transition to
  // count as "arrived," rather than any stop-anywhere-on-foot coincidentally matching the label.
  private static let returningArrivalProximityM = 20.0

  // Module-level JS state (parkDetection_HMM.js :56-69), as instance state — this class instance
  // itself IS the persistence for as long as the native background session lives; see file header.
  private(set) var belief: HMMBelief = [:]
  private(set) var currentState: HMMState = .idle
  private(set) var isAway = false
  private var isReturningIntentLocked = false
  private var minDistDuringReturn = Double.infinity

  private var returnCounter = 0
  private var drivingCounter = 0
  private var walkingCounter = 0
  private var tripDrivingTime: Double = 0
  private var tripDrivingDistance: Double = 0
  private var lastTripX: Double?
  private var lastTripY: Double?
  private var proximityCounter = 0

  private var smoothedDeltaRate: Double = 0
  private var smoothedStepRate: Double = 0
  private var lastTimestampMs: Double?
  private var lastDistanceToCar: Double?

  private var progressHistory: [(dist: Double, x: Double, y: Double)] = []
  private var pgrHistory: [Double] = []

  private let positionFilter = HMMKalman2D()
  private let speedFilter = HMMKalman1D(q: 0.01, r: 3.0)

  init() {
    for s in HMMState.allCases { belief[s] = s == .idle ? 1 : 0 }
  }

  // Port of resetHMM (parkDetection_HMM.js :1007-1041).
  func reset() {
    for s in HMMState.allCases { belief[s] = s == .idle ? 1 : 0 }
    currentState = .idle
    isAway = false
    isReturningIntentLocked = false
    minDistDuringReturn = .infinity

    speedFilter.reset()
    positionFilter.reset()

    smoothedDeltaRate = 0
    smoothedStepRate = 0
    lastTimestampMs = nil
    lastDistanceToCar = nil
    progressHistory.removeAll()
    pgrHistory.removeAll()

    returnCounter = 0
    drivingCounter = 0
    walkingCounter = 0
    tripDrivingTime = 0
    tripDrivingDistance = 0
    lastTripX = nil
    lastTripY = nil
    proximityCounter = 0
  }

  // MARK: Coordinate helpers (port of latLonToMeters/metersToLatLon, parkDetection_HMM.js :179-192)

  private static func latLonToMeters(_ lat: Double, _ lon: Double) -> (Double, Double) {
    let latRad = lat * .pi / 180
    let lonRad = lon * .pi / 180
    return (earthRadiusM * lonRad * cos(latRad), earthRadiusM * latRad)
  }

  private static func metersToLatLon(_ x: Double, _ y: Double) -> CLLocationCoordinate2D {
    let latRad = y / earthRadiusM
    let lat = latRad * 180 / .pi
    let lon = (x / (earthRadiusM * cos(latRad))) * 180 / .pi
    return CLLocationCoordinate2D(latitude: lat, longitude: lon)
  }

  // Haversine (port of getDistance, parkDetection_HMM.js :991-1002) — kept as an explicit port
  // rather than CLLocation.distance(from:) so it matches the exact formula the ported thresholds
  // (RETURN_ZONE_RADIUS, AWAY_THRESHOLD, etc.) were tuned against.
  private static func getDistance(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
    let R = 6371e3
    let dLat = (b.latitude - a.latitude) * .pi / 180
    let dLon = (b.longitude - a.longitude) * .pi / 180
    let h = sin(dLat / 2) * sin(dLat / 2)
      + cos(a.latitude * .pi / 180) * cos(b.latitude * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
    let c = 2 * atan2(h.squareRoot(), (1 - h).squareRoot())
    return R * c
  }

  // MARK: PGR (port of calculateIntentSlope/calculatePGR, parkDetection_HMM.js :207-241)

  private func calculateIntentSlope(_ data: [Double]) -> Double {
    let n = data.count
    guard n >= 5 else { return 0 }
    var sumX = 0.0, sumY = 0.0, sumXY = 0.0, sumXX = 0.0
    for i in 0..<n {
      let xi = Double(i)
      sumX += xi; sumY += data[i]; sumXY += xi * data[i]; sumXX += xi * xi
    }
    return (Double(n) * sumXY - sumX * sumY) / (Double(n) * sumXX - sumX * sumX)
  }

  private func calculatePGR(currentDist: Double, currentX: Double, currentY: Double) -> (pgr: Double, slope: Double, consistency: Double) {
    guard progressHistory.count >= 5, let start = progressHistory.first, let last = progressHistory.last else {
      return (0, 0, 0)
    }
    let netGain = start.dist - currentDist
    var totalPath = 0.0
    for i in 1..<progressHistory.count {
      let dX = progressHistory[i].x - progressHistory[i - 1].x
      let dY = progressHistory[i].y - progressHistory[i - 1].y
      totalPath += (dX * dX + dY * dY).squareRoot()
    }
    totalPath += ((currentX - last.x) * (currentX - last.x) + (currentY - last.y) * (currentY - last.y)).squareRoot()
    let pgr = totalPath < 1.0 ? 0 : netGain / totalPath

    pgrHistory.append(pgr)
    if pgrHistory.count > ParkDetectionHMMEngine.pgrHistoryCap { pgrHistory.removeFirst() }

    let slope = calculateIntentSlope(pgrHistory)
    let consistency = Double(pgrHistory.filter { $0 > 0.2 }.count) / Double(pgrHistory.count)
    return (pgr, slope, consistency)
  }

  // MARK: Emission model (port of emissionLogProb, parkDetection_HMM.js :346-501)

  private func emissionLogProb(state: HMMState, obs: HMMObservation) -> Double {
    var logp = 0.0
    let TEMP = 0.5

    var gpsWeight = 1.0
    if obs.accuracy > 20 { gpsWeight = max(0.2, 20 / obs.accuracy) }

    let isStationaryState = state == .idle
    let isVehicleState = state == .driving || state == .stopped
    let isWalkingState = state == .walking || state == .returning

    let hasStrongCarSignal = obs.bluetoothConnected || ((obs.activity?.automotive ?? false) && (obs.activity?.confidence ?? 0) >= 1)
    if hasStrongCarSignal {
      logp += isVehicleState ? 15.0 : -15.0
    }

    let sf = obs.spectralFeatures
    if isWalkingState {
      logp += sf.walkingEnergy * 15.0
      if sf.spectralEntropy > 0 && sf.spectralEntropy < 0.6 { logp += 5.0 }
    }
    if isVehicleState {
      logp += sf.vehicleEnergy * 12.0
      if sf.spectralEntropy > 0.8 { logp += 3.0 }
    }
    if state == .idle && !obs.isPhysicallyStill {
      if sf.walkingEnergy > 0.3 || sf.vehicleEnergy > 0.2 { logp -= 10.0 }
    }

    if let activity = obs.activity {
      let activityWeight: Double = activity.confidence == 0 ? 0.5 : (activity.confidence == 1 ? 1.0 : 2.0)
      if !activity.unknown {
        if isVehicleState && activity.automotive { logp += 5.0 * activityWeight }
        if isWalkingState && activity.walking { logp += 5.0 * activityWeight }
        if isStationaryState && activity.stationary { logp += 4.0 * activityWeight }
        if state == .stopped && activity.stationary { logp += 4.0 * activityWeight }
        if activity.confidence >= 1 {
          if isVehicleState && activity.walking { logp -= 8.0 * activityWeight }
          if state == .driving && activity.stationary { logp -= 8.0 * activityWeight }
          if isWalkingState && (activity.automotive || activity.stationary) { logp -= 8.0 * activityWeight }
          if isStationaryState && (activity.automotive || activity.walking) { logp -= 8.0 * activityWeight }
          if state == .stopped && activity.walking { logp -= 8.0 * activityWeight }
        }
      }
    }

    // SPEED (GPS)
    if state == .driving {
      logp += logSigmoid(obs.speed, 12, 0.4) * gpsWeight
      if obs.speed < 2 { logp -= 15 * gpsWeight }
      if hasStrongCarSignal && obs.speed > 10 { logp += 5.0 }
      if obs.stepRate > 0.4 && obs.speed < 25 { logp -= 25 }
    } else if isWalkingState {
      logp += logGaussian(obs.speed, 2.5, 4.0) * gpsWeight
    } else {
      logp += logGaussian(obs.speed, 0, 1.5) * gpsWeight
      if state == .idle && obs.speed > 1.5 { logp -= 10.0 * gpsWeight }
      if state == .stopped && obs.dist < 10 { logp += 2.0 * gpsWeight }
    }

    // STEP RATE (fast path)
    let stepSignal = obs.isPhysicallyStill ? 0 : min(obs.stepRate / 1.0, 1.0)
    if stepSignal > 0 {
      logp += isWalkingState ? (stepSignal * 25.0) : -(stepSignal * 35.0)
    } else {
      logp += isStationaryState ? 2.0 : -5.0
    }

    // ACCELERATION
    logp += logGaussian(obs.accel, 1.0, 0.6)

    // STATIONARY GUARD
    if obs.isPhysicallyStill {
      if state == .driving || state == .walking || state == .returning {
        logp -= 40
      } else {
        logp += 15
      }
    }

    // DIRECTION/DISTANCE (RETURNING)
    if state == .returning {
      let proximityRamp = max(0, 1.0 - (obs.dist / ParkDetectionHMMEngine.returnZoneRadius))
      logp += (proximityRamp * 10.0) * gpsWeight

      logp += logSigmoid(-obs.deltaRate, 0.2, 5.0) * 12.0 * gpsWeight

      let proximityWeight = max(0.2, 1.0 - (obs.dist / ParkDetectionHMMEngine.returnZoneRadius))
      var directionalScore = 0.0
      directionalScore += obs.pgr > 0 ? obs.pgr * 8.0 : obs.pgr * 12.0
      directionalScore += obs.approachAlignment > 0 ? obs.approachAlignment * 5.0 : obs.approachAlignment * 8.0

      let consistentScore = directionalScore * pow(obs.pgrConsistency, 1.5)
      logp += (consistentScore * proximityWeight) * gpsWeight
      if obs.slope > 0.01 { logp += (obs.slope * 50.0 * proximityWeight) * gpsWeight }

      if isReturningIntentLocked { logp += 10.0 * TEMP }
    }

    return logp * TEMP
  }

  // MARK: Forward filter (port of updateBelief, parkDetection_HMM.js :502-552)

  private func updateBelief(prevBelief: HMMBelief, obs: HMMObservation, context: HMMContext) -> HMMBelief {
    var logNewBelief: [HMMState: Double] = [:]
    var maxLog = -Double.infinity

    for s in HMMState.allCases {
      var transitionSum = 0.0
      for sp in HMMState.allCases {
        guard isHMMTransitionAllowed(from: sp, to: s, context: context) else { continue }
        let p = prevBelief[sp] ?? 0
        let a = hmmTransitionMatrix[sp]?[s] ?? 0
        transitionSum += p * a
      }
      if transitionSum <= 0 {
        logNewBelief[s] = -Double.infinity
        continue
      }
      let logVal = log(transitionSum) + emissionLogProb(state: s, obs: obs)
      logNewBelief[s] = logVal
      if logVal > maxLog { maxLog = logVal }
    }

    guard maxLog != -Double.infinity else {
      var reset: HMMBelief = [:]
      for s in HMMState.allCases { reset[s] = s == .idle ? 1 : 0 }
      return reset
    }

    var sumExp = 0.0
    for s in HMMState.allCases {
      let lv = logNewBelief[s] ?? -Double.infinity
      guard lv != -Double.infinity else { continue }
      sumExp += exp(lv - maxLog)
    }
    let logSumExp = maxLog + log(sumExp)

    var newBelief: HMMBelief = [:]
    for s in HMMState.allCases {
      let lv = logNewBelief[s] ?? -Double.infinity
      var v = lv == -Double.infinity ? 0 : exp(lv - logSumExp)
      if v.isNaN { v = 0 }
      newBelief[s] = v
    }
    return newBelief
  }

  // MARK: Main entry point (port of processLocationHMM, parkDetection_HMM.js :557-985)

  @discardableResult
  func process(location: CLLocation, parkedLocation: CLLocationCoordinate2D?, supplemental: HMMSupplemental) -> HMMResult {
    // Temporal replay: dt from the fix's own GPS timestamp, not wall-clock — a background batch
    // delivered in one burst must still see the real inter-fix spacing (parkDetection_HMM.js :584-619).
    let nowMs = location.timestamp.timeIntervalSince1970 * 1000.0
    var dt: Double = 1
    if let last = lastTimestampMs {
      dt = (nowMs - last) / 1000.0
      if dt < 0.05 { dt = 0.05 }
      if dt > 60 {
        // Deep-sleep / Phantom-Park guard: stale trip accumulators from before the gap must not
        // let the post-gap fix satisfy the park condition on their own.
        positionFilter.reset()
        dt = 1
        tripDrivingTime = 0
        tripDrivingDistance = 0
        lastTripX = nil
        lastTripY = nil
      } else {
        dt = min(dt, 5)
      }
    }
    lastTimestampMs = nowMs

    let rawAccuracy = location.horizontalAccuracy > 0 ? location.horizontalAccuracy : 10
    let (mx, my) = ParkDetectionHMMEngine.latLonToMeters(location.coordinate.latitude, location.coordinate.longitude)
    let (fx, fy) = positionFilter.update(z: [mx, my], dt: dt, accuracy: rawAccuracy)
    let filteredCoords = ParkDetectionHMMEngine.metersToLatLon(fx, fy)

    let rawSpeedKmh = max(0, location.speed * 3.6) // CLLocation.speed: m/s, -1 (invalid) collapses to 0 here
    let speed = speedFilter.update(rawSpeedKmh)

    var dist = 0.0
    if let parked = parkedLocation {
      dist = ParkDetectionHMMEngine.getDistance(filteredCoords, parked)
    }

    // deltaRate + EMA (parkDetection_HMM.js :637-648)
    var deltaRate = 0.0
    if let lastDist = lastDistanceToCar, dt > 0, !dist.isNaN {
      let delta = dist - lastDist
      deltaRate = max(-10, min(10, delta)) / dt
    }
    let alpha = 0.3
    smoothedDeltaRate = alpha * smoothedDeltaRate + (1 - alpha) * (deltaRate.isNaN ? 0 : deltaRate)
    if smoothedDeltaRate.isNaN { smoothedDeltaRate = 0 }
    let stableDeltaRate = smoothedDeltaRate
    lastDistanceToCar = dist

    // approachAlignment (parkDetection_HMM.js :650-663)
    var approachAlignment = 0.0
    if let parked = parkedLocation {
      let (parkedMx, parkedMy) = ParkDetectionHMMEngine.latLonToMeters(parked.latitude, parked.longitude)
      let dx = parkedMx - fx, dy = parkedMy - fy
      let vx = positionFilter.vx, vy = positionFilter.vy
      let magD = (dx * dx + dy * dy).squareRoot()
      let magV = (vx * vx + vy * vy).squareRoot()
      if magV > 0.3 && magD > 2 {
        approachAlignment = (vx * dx + vy * dy) / (magV * magD)
      }
    }

    // PGR (parkDetection_HMM.js :665-670) — computed from history BEFORE the current point is
    // appended, matching JS's ordering exactly.
    var pgrVal = 0.0, slopeVal = 0.0, consistencyVal = 0.0
    if parkedLocation != nil, !fx.isNaN, !fy.isNaN {
      let m = calculatePGR(currentDist: dist, currentX: fx, currentY: fy)
      pgrVal = m.pgr; slopeVal = m.slope; consistencyVal = m.consistency
      progressHistory.append((dist: dist, x: fx, y: fy))
      if progressHistory.count > ParkDetectionHMMEngine.progressWindowSize { progressHistory.removeFirst() }
    }

    // Step rate EMA (parkDetection_HMM.js :673-679) — Phase A: supplemental.stepRate is 0 until Phase B.
    let stepAlpha = 0.6
    smoothedStepRate = stepAlpha * supplemental.stepRate + (1 - stepAlpha) * smoothedStepRate
    let stepRate = smoothedStepRate

    // Phase A: accelerationMagnitude is nil until Phase C — accel falls back to the JS "neutral" value.
    let accel = supplemental.accelerationMagnitude ?? 1.5
    let isPhysicallyStill = supplemental.accelerationMagnitude != nil && abs(accel - 1.0) < 0.025 && speed < 1.0

    let obs = HMMObservation(
      speed: speed, stepRate: stepRate, accel: accel, dist: dist, deltaRate: stableDeltaRate,
      accuracy: supplemental.accuracy, approachAlignment: approachAlignment,
      pgr: pgrVal, slope: slopeVal, pgrConsistency: consistencyVal,
      activity: supplemental.motionActivity, isPhysicallyStill: isPhysicallyStill,
      bluetoothConnected: supplemental.bluetoothConnected,
      spectralFeatures: supplemental.spectralFeatures ?? SpectralFeatures()
    )
    let context = HMMContext(
      hasParkedLocation: parkedLocation != nil, deltaRate: obs.deltaRate, stepRate: obs.stepRate,
      dist: obs.dist, speed: obs.speed, pgr: obs.pgr, slope: obs.slope, pgrConsistency: obs.pgrConsistency,
      isAway: isAway, activity: obs.activity, isPhysicallyStill: isPhysicallyStill,
      bluetoothConnected: obs.bluetoothConnected, spectralFeatures: obs.spectralFeatures,
      drivingCounter: drivingCounter
    )

    belief = updateBelief(prevBelief: belief, obs: obs, context: context)

    // Intent stickiness (parkDetection_HMM.js :730-736)
    if isReturningIntentLocked, (belief[.returning] ?? 0) < 0.2 {
      belief[.returning] = 0.2
      let total = belief.values.reduce(0, +)
      if total > 0 {
        for s in HMMState.allCases { belief[s] = (belief[s] ?? 0) / total }
      }
    }

    let sorted = belief.sorted { $0.value > $1.value }
    let candidate = sorted[0].key
    let candidateConf = sorted[0].value
    let hysteresisGap = 0.12

    let hasWalkingSignal = (obs.activity?.walking ?? false) && (obs.activity?.confidence ?? 0) >= 1
    let hasDrivingSignal = (obs.activity?.automotive ?? false) && (obs.activity?.confidence ?? 0) >= 1

    // Gated counters (parkDetection_HMM.js :758-776)
    let hasReturningTrend = obs.pgr > 0.1 && obs.slope > -0.01
    returnCounter = (candidate == .returning && hasReturningTrend) ? returnCounter + 1 : 0
    walkingCounter = (candidate == .walking || (hasWalkingSignal && candidateConf > 0.3)) ? walkingCounter + 1 : 0
    drivingCounter = (candidate == .driving || (hasDrivingSignal && candidateConf > 0.3)) ? drivingCounter + 1 : 0

    // Trip accumulation (parkDetection_HMM.js :778-802)
    let isVehicleState = candidate == .driving || candidate == .stopped
    if isVehicleState {
      tripDrivingTime += dt
      if let lx = lastTripX, let ly = lastTripY {
        let ddx = fx - lx, ddy = fy - ly
        let moved = (ddx * ddx + ddy * ddy).squareRoot()
        if moved > 0.5 && moved < 50 { tripDrivingDistance += moved }
      }
      lastTripX = fx; lastTripY = fy
    } else if candidate == .walking || candidate == .idle {
      lastTripX = nil; lastTripY = nil
    }

    let returnConfirmed = returnCounter >= 2
    let drivingConfirmed = drivingCounter >= 2 || (hasDrivingSignal && drivingCounter >= 1 && speed > 10)
    let walkingConfirmed = walkingCounter >= 2 || (hasWalkingSignal && walkingCounter >= 1)

    // Intent-lock activate/track/break/release (parkDetection_HMM.js :810-831)
    if !isReturningIntentLocked && currentState == .returning && candidateConf > 0.85 {
      isReturningIntentLocked = true
      minDistDuringReturn = dist
    }
    if isReturningIntentLocked {
      if dist < minDistDuringReturn { minDistDuringReturn = dist }
      if dist > minDistDuringReturn + 15 && dist > 10 {
        isReturningIntentLocked = false
        minDistDuringReturn = .infinity
      }
      if currentState == .driving {
        isReturningIntentLocked = false
        minDistDuringReturn = .infinity
      }
    }

    // Away/arrival detection (parkDetection_HMM.js :833-879)
    var awayEvent = false
    let hasCarPresence = obs.bluetoothConnected
      || ([.stopped, .idle, .returning].contains(currentState) && dist < 12.0)
    let isWalkingAway = !isAway && dist > ParkDetectionHMMEngine.awayThreshold && !hasCarPresence
      && (currentState == .walking || currentState == .idle)
    if isWalkingAway {
      isAway = true
      awayEvent = true
    }
    if isAway && hasCarPresence {
      isAway = false
      proximityCounter = 0
    }
    if isAway && dist < 8 {
      proximityCounter += 1
      if proximityCounter >= 3 { isAway = false; proximityCounter = 0 }
    } else if isAway && dist >= 8 && dist < ParkDetectionHMMEngine.awayThreshold {
      proximityCounter += 1
      if proximityCounter >= 20 { isAway = false; proximityCounter = 0 }
    } else {
      proximityCounter = 0
    }

    // State switch (parkDetection_HMM.js :881-902)
    if candidate != currentState, candidateConf > (belief[currentState] ?? 0) + hysteresisGap {
      var blocked = false
      if candidate == .returning && !returnConfirmed { blocked = true }
      else if candidate == .driving && !drivingConfirmed { blocked = true }
      else if candidate == .walking && !walkingConfirmed { blocked = true }
      else if isReturningIntentLocked && currentState == .returning && (candidate == .idle || candidate == .walking) { blocked = true }

      if !blocked {
        // R7 field-test fix (2026-07-26): JS resets isAway unconditionally on RETURNING→STOPPED,
        // assuming that transition always means "arrived at the car." It doesn't — walking away from
        // the car toward some OTHER destination and stopping there (e.g. arriving home, still ~120m
        // from the car) produces the exact same state-label transition, and the unconditional reset
        // then let a stale "trip time" dwell satisfy isVacatingSpot's clear-the-spot condition despite
        // never having gone anywhere near the car. Gate the reset on actually being close to it.
        if currentState == .returning && candidate == .stopped && dist < ParkDetectionHMMEngine.returningArrivalProximityM {
          isAway = false
          proximityCounter = 0
        }
        currentState = candidate
      }
    }

    // Parking-event detection (parkDetection_HMM.js :904-935)
    var parkedEvent = false
    let timeThresh = 30.0, tripDistThresh = 100.0, clearDistThresh = 50.0
    let isExitEvent = candidate == .walking && walkingConfirmed && !hasDrivingSignal
      && [.stopped, .driving, .idle, .walking].contains(currentState)
      && tripDrivingTime >= timeThresh && tripDrivingDistance >= tripDistThresh
    if isExitEvent {
      parkedEvent = true
      tripDrivingTime = 0
      tripDrivingDistance = 0
      lastTripX = nil; lastTripY = nil
      isAway = false
    }

    // Clear-parking-event detection (parkDetection_HMM.js :937-950)
    var clearParkingEvent = false
    let isVacatingSpot = parkedLocation != nil && (currentState == .driving || currentState == .stopped)
      && !isAway && dist > clearDistThresh && tripDrivingTime >= timeThresh
    if isVacatingSpot { clearParkingEvent = true }

    return HMMResult(
      state: currentState, bestState: candidate, confidence: candidateConf, belief: belief,
      parkedEvent: parkedEvent, awayEvent: awayEvent, clearParkingEvent: clearParkingEvent,
      isAway: isAway, distToParked: dist, deltaRate: stableDeltaRate, filteredSpeed: speed,
      filteredCoords: filteredCoords, pgr: pgrVal, slope: slopeVal, pgrConsistency: consistencyVal,
      approachAlignment: approachAlignment
    )
  }
}
