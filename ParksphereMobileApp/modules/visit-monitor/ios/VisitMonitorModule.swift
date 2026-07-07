import ExpoModulesCore
import CoreLocation

// Native CoreLocation monitor for the event-based parking lifecycle. Uses only "monitoring"
// services (visits + region monitoring), which coexist and survive app suspension/termination —
// avoiding the single-owner conflict that sank the old expo-location geofence attempt.
//
//   • CLVisit (startMonitoringVisits)        → "you parked here" / "you left" (delayed, coarse).
//   • Region monitoring (startMonitoring)    → geofence ENTER/EXIT around the parked spot. iOS
//     wakes a suspended/terminated app on the crossing. ENTER = owner returning; EXIT = drove off.
//
// One region at a time (id = "parkedSpot"). iOS keeps monitoring the region even after the app is
// killed, so the geofence persists without the JS having to re-arm on every relaunch.
public class VisitMonitorModule: Module {
  private var manager: CLLocationManager?
  private var delegateProxy: LocationDelegate?
  private static let regionId = "parkedSpot"
  // ── Rolling geofence (Build C, Life360-style) ────────────────────────────────
  // A small region re-armed around the CURRENT location on every crossing. Each crossing wakes a
  // suspended app in the background, so we get a periodic movement-triggered wake WITHOUT running
  // continuous location (which — proven 2026-07-05 A/B — makes iOS suspend-and-buffer the whole ride).
  // Separate id from the parked-spot region so they never collide.
  private static let rollingId = "rollingFence"
  private var rollingRadius: Double = 150
  private var rollingActive = false
  private var rollingArmPending = false
  // ── Background activity session (Build D, iOS 17+) ────────────────────────────
  // The 2026-07-05 A/B proved continuous drive-capture location gets suspended-and-buffered (Build B)
  // and that region wakes get throttled (Build C). CLBackgroundActivitySession is the sanctioned
  // iOS 17+ way to keep the app ALIVE receiving location in the background — as long as we HOLD the
  // object (its dealloc auto-invalidates the session). Stored as Any? so it compiles on the 16.4
  // deployment target; all use is guarded by #available(iOS 17.0, *).
  private var bgSession: Any?
  // ── Modern live updates (Build D-v2, iOS 17+) ────────────────────────────────
  // CLBackgroundActivitySession only grants sustained background delivery to the MODERN
  // CLLocationUpdate.liveUpdates async API — not the legacy startUpdatingLocation delegate (Build D
  // buffered anyway). This Task consumes liveUpdates and forwards each fix through the same batch path.
  private var liveTask: Task<Void, Never>?

  // ── Native heartbeat (Build E premise test, 2026-07-07) ──────────────────────
  // Prior "app suspended during the drive" verdicts came from watching the JS heartbeat go silent —
  // but iOS suspends the React Native JS THREAD, not necessarily the native location process. This
  // logs — from Swift, on the liveUpdates Task, independent of JS — the NATIVE wall-clock time each
  // fix is processed alongside the fix's own GPS timestamp. If native runs live during the drive, the
  // `t` values are spread out and `t ≈ gps`; if native is frozen too, they cluster at foreground-resume
  // with a huge `t - gps` delta. Written to a JSON-lines file in Documents; JS merges it on foreground.
  private let nativeLogQueue = DispatchQueue(label: "com.parksphere.nativelog")
  private var lastNativeLogAt: TimeInterval = 0
  private static let nativeLogThrottleSec: TimeInterval = 3.0
  private var nativeLogURL: URL? {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
      .appendingPathComponent("native_heartbeat.jsonl")
  }

  public func definition() -> ModuleDefinition {
    Name("VisitMonitor")

    Events("onVisit", "onGeofence", "onLocationBatch", "onLocationPaused", "onLocationResumed")

    AsyncFunction("start") {
      DispatchQueue.main.async {
        self.ensureManager()
        self.manager?.requestAlwaysAuthorization()
        self.manager?.startMonitoringVisits()
      }
    }

    AsyncFunction("stop") {
      DispatchQueue.main.async {
        self.manager?.stopMonitoringVisits()
      }
    }

    // Arm (or replace) the geofence around the parked spot.
    AsyncFunction("armGeofence") { (latitude: Double, longitude: Double, radius: Double) in
      DispatchQueue.main.async {
        self.ensureManager()
        guard let m = self.manager else { return }
        // Remove any existing parked-spot region first.
        for r in m.monitoredRegions where r.identifier == VisitMonitorModule.regionId {
          m.stopMonitoring(for: r)
        }
        let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        // iOS clamps radius to the device maximum; ~150 m is a safe, reliable region size.
        let region = CLCircularRegion(center: center, radius: radius, identifier: VisitMonitorModule.regionId)
        region.notifyOnEntry = true
        region.notifyOnExit = true
        m.startMonitoring(for: region)
      }
    }

    AsyncFunction("clearGeofence") {
      DispatchQueue.main.async {
        guard let m = self.manager else { return }
        for r in m.monitoredRegions where r.identifier == VisitMonitorModule.regionId {
          m.stopMonitoring(for: r)
        }
      }
    }

    // ── On-demand continuous location stream (feeds the HMM) ──────────────────
    // The SAME manager that does visits + regions also streams fixes when asked, so there is only
    // ever ONE CLLocationManager in the app — no two-owner conflict. The mode controller (JS) turns
    // this on for the foreground and for the bounded return window after a geofence ENTER, and off
    // otherwise so the app can suspend and native visit/region events keep working.
    AsyncFunction("startLocationUpdates") {
      DispatchQueue.main.async {
        self.ensureManager()
        guard let m = self.manager else { return }
        m.desiredAccuracy = kCLLocationAccuracyBest
        m.distanceFilter = 10 // metres — enough resolution for the HMM without flooding
        m.pausesLocationUpdatesAutomatically = false // don't let iOS pause mid-walk/mid-drive
        m.activityType = .other // mixed use (driving in foreground, walking on return)
        m.showsBackgroundLocationIndicator = true
        m.startUpdatingLocation()
      }
    }

    AsyncFunction("stopLocationUpdates") {
      DispatchQueue.main.async {
        self.manager?.stopUpdatingLocation()
      }
    }

    // ── One-shot fresh fix (Option 1) ─────────────────────────────────────────
    // A single best-accuracy fix on demand, from the SAME manager. The result arrives via
    // didUpdateLocations → onLocationBatch (1-element), so JS handles it through the existing path.
    // Used to densify the sparse background-wake trail (SLC fixes are coarse/cached) so the parked
    // spot can be anchored on the vehicle-stop fix rather than the coarse CLVisit dwell.
    AsyncFunction("requestOneShotLocation") {
      DispatchQueue.main.async {
        self.ensureManager()
        guard let m = self.manager else { return }
        m.desiredAccuracy = kCLLocationAccuracyBest
        m.requestLocation()
      }
    }

    // ── Drive-capture mode: CONTINUOUS location that keeps the app alive through the drive ────────
    // NOTE: we deliberately do NOT use pausesLocationUpdatesAutomatically. Field test 2026-07-04
    // showed that from an SLC-triggered start iOS auto-pauses within ~8s (you're momentarily slow at
    // the start) and SUSPENDS the app for the whole trip — nothing ran in the background. Instead we
    // run continuous location (allowsBackgroundLocationUpdates keeps the app alive the whole drive) so
    // the HMM — fed every fix, with its motion sensors live while the app is awake — detects the real
    // drove→stopped→walked park. JS stops these updates once a spot is declared, so it's bounded to
    // the drive. This is the RNBG-style approach that previously worked.
    AsyncFunction("startDriveLocationUpdates") {
      DispatchQueue.main.async {
        self.ensureManager()
        guard let m = self.manager else { return }
        m.desiredAccuracy = kCLLocationAccuracyBest
        m.distanceFilter = kCLDistanceFilterNone // full resolution during the drive → precise stop
        m.pausesLocationUpdatesAutomatically = false // DON'T let iOS pause — it kills the session + app
        m.activityType = .automotiveNavigation
        m.showsBackgroundLocationIndicator = true
        m.startUpdatingLocation()
      }
    }

    // Significant-location-change monitoring: a low-power service that WAKES a suspended/terminated
    // app after ~500m of movement (i.e. a new drive starting), so drive-capture can be restarted
    // after iOS auto-paused it at the previous park. Coarse locations arrive via onLocation.
    AsyncFunction("startSignificantChangeMonitoring") {
      DispatchQueue.main.async {
        self.ensureManager()
        self.manager?.startMonitoringSignificantLocationChanges()
      }
    }

    AsyncFunction("stopSignificantChangeMonitoring") {
      DispatchQueue.main.async {
        self.manager?.stopMonitoringSignificantLocationChanges()
      }
    }

    // ── Rolling geofence: periodic bg wakes on movement (Build C) ────────────────
    AsyncFunction("startRollingFence") { (radius: Double) in
      DispatchQueue.main.async {
        self.ensureManager()
        guard let m = self.manager else { return }
        self.rollingRadius = radius
        self.rollingActive = true
        if let loc = m.location {
          self.armRolling(m, at: loc.coordinate)
        } else {
          // No cached fix yet — grab one one-shot and arm on arrival (didUpdateLocations).
          self.rollingArmPending = true
          m.requestLocation()
        }
      }
    }

    AsyncFunction("stopRollingFence") {
      DispatchQueue.main.async {
        self.rollingActive = false
        self.rollingArmPending = false
        guard let m = self.manager else { return }
        for r in m.monitoredRegions where r.identifier == VisitMonitorModule.rollingId {
          m.stopMonitoring(for: r)
        }
      }
    }

    // ── Background activity session (Build D) ────────────────────────────────────
    // Hold a CLBackgroundActivitySession (iOS 17+) so continuous location keeps the app alive in the
    // background instead of being suspended-and-buffered. No-op below iOS 17.
    AsyncFunction("startBackgroundSession") {
      DispatchQueue.main.async {
        if #available(iOS 17.0, *) {
          if self.bgSession == nil { self.bgSession = CLBackgroundActivitySession() }
        }
      }
    }

    AsyncFunction("stopBackgroundSession") {
      DispatchQueue.main.async {
        if #available(iOS 17.0, *) {
          (self.bgSession as? CLBackgroundActivitySession)?.invalidate()
        }
        self.bgSession = nil
      }
    }

    // ── Modern live-updates drive capture (Build D-v2) ───────────────────────────
    // Consume CLLocationUpdate.liveUpdates in a Task; paired with a held CLBackgroundActivitySession
    // this is the sanctioned way to keep receiving location in the background. Each fix is forwarded
    // as a 1-element onLocationBatch so the existing HMM pipeline is unchanged.
    AsyncFunction("startDriveLiveUpdates") {
      DispatchQueue.main.async {
        guard self.liveTask == nil else { return }
        if #available(iOS 17.0, *) {
          self.ensureManager() // make sure Always auth has been requested
          self.liveTask = Task { [weak self] in
            do {
              for try await update in CLLocationUpdate.liveUpdates() {
                if Task.isCancelled { break }
                guard let self = self, let loc = update.location else { continue }
                self.logNativeFix(loc, tag: "live") // native-liveness probe (independent of JS)
                self.sendEvent("onLocationBatch", ["locations": [self.fixDict(loc)]])
              }
            } catch {
              // liveUpdates threw (e.g. authorization) — leave the task to end; JS falls back on foreground.
            }
          }
        }
      }
    }

    AsyncFunction("stopDriveLiveUpdates") {
      DispatchQueue.main.async {
        self.liveTask?.cancel()
        self.liveTask = nil
      }
    }

    // ── Native heartbeat readback (Build E premise test) ─────────────────────────
    // JS calls this on foreground to pull the native-captured heartbeat lines and merge them into the
    // telemetry heartbeat, then clears them. Returns the raw JSON-lines file contents ("" if none).
    AsyncFunction("readNativeLog") { () -> String in
      guard let url = self.nativeLogURL,
            let s = try? String(contentsOf: url, encoding: .utf8) else { return "" }
      return s
    }

    AsyncFunction("clearNativeLog") {
      if let url = self.nativeLogURL { try? FileManager.default.removeItem(at: url) }
    }
  }

  // Append a native-heartbeat line (throttled) recording that native code ran at wall-clock `now`
  // to process a fix whose GPS time is `gpsMs`. Runs on the liveUpdates Task, off the JS thread.
  fileprivate func logNativeFix(_ loc: CLLocation, tag: String) {
    let nowSec = Date().timeIntervalSince1970
    if nowSec - lastNativeLogAt < VisitMonitorModule.nativeLogThrottleSec { return }
    lastNativeLogAt = nowSec
    let entry: [String: Any] = [
      "t": nowSec * 1000.0,                                   // native wall-clock when processed
      "gps": loc.timestamp.timeIntervalSince1970 * 1000.0,    // the fix's own GPS timestamp
      "lat": loc.coordinate.latitude,
      "lon": loc.coordinate.longitude,
      "spd": loc.speed,
      "tag": tag
    ]
    nativeLogQueue.async { [weak self] in
      guard let self = self, let url = self.nativeLogURL,
            let data = try? JSONSerialization.data(withJSONObject: entry),
            var line = String(data: data, encoding: .utf8) else { return }
      line += "\n"
      guard let bytes = line.data(using: .utf8) else { return }
      if let handle = try? FileHandle(forWritingTo: url) {
        defer { try? handle.close() }
        handle.seekToEndOfFile()
        handle.write(bytes)
      } else {
        try? bytes.write(to: url) // file doesn't exist yet → create it
      }
    }
  }

  // Encode a CLLocation into the JS fix shape (matches the delegate's onLocationBatch payload).
  fileprivate func fixDict(_ loc: CLLocation) -> [String: Any] {
    return [
      "latitude": loc.coordinate.latitude,
      "longitude": loc.coordinate.longitude,
      "accuracy": loc.horizontalAccuracy,
      "altitude": loc.altitude,
      "speed": loc.speed,
      "course": loc.course,
      "timestamp": loc.timestamp.timeIntervalSince1970 * 1000.0
    ]
  }

  // Re-arm the rolling region centered on `center`, replacing any existing one.
  private func armRolling(_ m: CLLocationManager, at center: CLLocationCoordinate2D) {
    for r in m.monitoredRegions where r.identifier == VisitMonitorModule.rollingId {
      m.stopMonitoring(for: r)
    }
    let region = CLCircularRegion(center: center, radius: rollingRadius, identifier: VisitMonitorModule.rollingId)
    region.notifyOnEntry = true
    region.notifyOnExit = true
    m.startMonitoring(for: region)
  }

  // Called by the delegate when the rolling region is crossed (a background wake). Re-arm at the new
  // location and forward the fix so the HMM sees the path — reusing the existing batch pipeline.
  fileprivate func handleRollingCross(_ m: CLLocationManager) {
    guard rollingActive else { return }
    guard let loc = m.location else {
      // No cached fix on this wake — request one and re-arm when it lands, so the chain can't stall.
      rollingArmPending = true
      m.requestLocation()
      return
    }
    armRolling(m, at: loc.coordinate)
    sendEvent("onLocationBatch", ["locations": [fixDict(loc)]])
  }

  // Called by the delegate on every location delivery — used only to complete a pending initial arm.
  fileprivate func handleLocationsForRolling(_ locations: [CLLocation]) {
    guard rollingArmPending, rollingActive, let m = self.manager, let loc = locations.last else { return }
    rollingArmPending = false
    armRolling(m, at: loc.coordinate)
  }

  private func ensureManager() {
    if manager != nil { return }
    let m = CLLocationManager()
    let proxy = LocationDelegate(
      onVisit: { [weak self] payload in self?.sendEvent("onVisit", payload) },
      onGeofence: { [weak self] payload in self?.sendEvent("onGeofence", payload) },
      onLocationBatch: { [weak self] payload in self?.sendEvent("onLocationBatch", payload) },
      onLocationPaused: { [weak self] in self?.sendEvent("onLocationPaused", [:]) },
      onLocationResumed: { [weak self] in self?.sendEvent("onLocationResumed", [:]) },
      onRollingCross: { [weak self] m in self?.handleRollingCross(m) },
      onLocationsRaw: { [weak self] locs in self?.handleLocationsForRolling(locs) }
    )
    m.delegate = proxy
    m.allowsBackgroundLocationUpdates = true
    self.delegateProxy = proxy
    self.manager = m
  }
}

// Separate NSObject delegate (CLLocationManager holds its delegate weakly; the module retains this
// via delegateProxy). Forwards both visit and region events to the module's sendEvent closures.
private class LocationDelegate: NSObject, CLLocationManagerDelegate {
  private let onVisit: ([String: Any]) -> Void
  private let onGeofence: ([String: Any]) -> Void
  private let onLocationBatch: ([String: Any]) -> Void
  private let onLocationPaused: () -> Void
  private let onLocationResumed: () -> Void
  private let onRollingCross: (CLLocationManager) -> Void
  private let onLocationsRaw: ([CLLocation]) -> Void
  private static let rollingId = "rollingFence" // must match VisitMonitorModule.rollingId

  init(
    onVisit: @escaping ([String: Any]) -> Void,
    onGeofence: @escaping ([String: Any]) -> Void,
    onLocationBatch: @escaping ([String: Any]) -> Void,
    onLocationPaused: @escaping () -> Void,
    onLocationResumed: @escaping () -> Void,
    onRollingCross: @escaping (CLLocationManager) -> Void,
    onLocationsRaw: @escaping ([CLLocation]) -> Void
  ) {
    self.onVisit = onVisit
    self.onGeofence = onGeofence
    self.onLocationBatch = onLocationBatch
    self.onLocationPaused = onLocationPaused
    self.onLocationResumed = onLocationResumed
    self.onRollingCross = onRollingCross
    self.onLocationsRaw = onLocationsRaw
    super.init()
  }

  func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
    let isArrival = visit.departureDate == Date.distantFuture
    onVisit([
      "type": isArrival ? "arrival" : "departure",
      "latitude": visit.coordinate.latitude,
      "longitude": visit.coordinate.longitude,
      "accuracy": visit.horizontalAccuracy,
      "arrival": visit.arrivalDate.timeIntervalSince1970 * 1000.0,
      "departure": isArrival ? 0.0 : visit.departureDate.timeIntervalSince1970 * 1000.0
    ])
  }

  func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
    emitRegion("enter", region, manager)
  }

  func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
    emitRegion("exit", region, manager)
  }

  private func emitRegion(_ type: String, _ region: CLRegion, _ manager: CLLocationManager) {
    var payload: [String: Any] = ["type": type, "id": region.identifier]
    // For the rolling fence, attach the crossing location so the heartbeat can plot each wake.
    if region.identifier == LocationDelegate.rollingId, let c = manager.location?.coordinate {
      payload["lat"] = c.latitude
      payload["lon"] = c.longitude
    }
    onGeofence(payload)
    if region.identifier == LocationDelegate.rollingId { onRollingCross(manager) }
  }

  // Location delivery. CRITICAL: when the app was SUSPENDED during a drive (iOS won't keep it alive —
  // proven), iOS BUFFERS the fixes and delivers them here as an ARRAY (a ~6-min batch) on the next
  // wake. Forward the WHOLE array as one batch so JS can process it through the proven pipeline
  // (temporal replay from each fix's timestamp + historical activity backfill). speed is m/s
  // (-1 = unknown), matching expo-location's coords.speed so the adapter maps cleanly.
  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    let fixes: [[String: Any]] = locations.map { loc in
      [
        "latitude": loc.coordinate.latitude,
        "longitude": loc.coordinate.longitude,
        "accuracy": loc.horizontalAccuracy,
        "altitude": loc.altitude,
        "speed": loc.speed,
        "course": loc.course,
        "timestamp": loc.timestamp.timeIntervalSince1970 * 1000.0
      ]
    }
    onLocationBatch(["locations": fixes])
    onLocationsRaw(locations) // completes a pending rolling-fence initial arm
  }

  // requestLocation() surfaces failures here; ignore so a transient error doesn't crash the delegate.
  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

  // iOS auto-paused location because the device has been stationary (parked). This is the park signal
  // in drive-capture mode — the JS side treats the last fix before this as the parking spot.
  func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
    onLocationPaused()
  }

  // iOS resumed after a pause (movement detected). Informational; a new drive is usually (re)started
  // from significant-location-change wakes rather than relying on this.
  func locationManagerDidResumeLocationUpdates(_ manager: CLLocationManager) {
    onLocationResumed()
  }
}
