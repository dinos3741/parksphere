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
    sendEvent("onLocationBatch", ["locations": [[
      "latitude": loc.coordinate.latitude,
      "longitude": loc.coordinate.longitude,
      "accuracy": loc.horizontalAccuracy,
      "altitude": loc.altitude,
      "speed": loc.speed,
      "course": loc.course,
      "timestamp": loc.timestamp.timeIntervalSince1970 * 1000.0
    ]]])
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
