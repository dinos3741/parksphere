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

  public func definition() -> ModuleDefinition {
    Name("VisitMonitor")

    Events("onVisit", "onGeofence", "onLocation", "onLocationPaused", "onLocationResumed")

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
  }

  private func ensureManager() {
    if manager != nil { return }
    let m = CLLocationManager()
    let proxy = LocationDelegate(
      onVisit: { [weak self] payload in self?.sendEvent("onVisit", payload) },
      onGeofence: { [weak self] payload in self?.sendEvent("onGeofence", payload) },
      onLocation: { [weak self] payload in self?.sendEvent("onLocation", payload) },
      onLocationPaused: { [weak self] in self?.sendEvent("onLocationPaused", [:]) },
      onLocationResumed: { [weak self] in self?.sendEvent("onLocationResumed", [:]) }
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
  private let onLocation: ([String: Any]) -> Void
  private let onLocationPaused: () -> Void
  private let onLocationResumed: () -> Void

  init(
    onVisit: @escaping ([String: Any]) -> Void,
    onGeofence: @escaping ([String: Any]) -> Void,
    onLocation: @escaping ([String: Any]) -> Void,
    onLocationPaused: @escaping () -> Void,
    onLocationResumed: @escaping () -> Void
  ) {
    self.onVisit = onVisit
    self.onGeofence = onGeofence
    self.onLocation = onLocation
    self.onLocationPaused = onLocationPaused
    self.onLocationResumed = onLocationResumed
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
    onGeofence(["type": "enter", "id": region.identifier])
  }

  func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
    onGeofence(["type": "exit", "id": region.identifier])
  }

  // Continuous location stream (only while startLocationUpdates is active). iOS may deliver a batch;
  // forward each fix. speed is m/s (-1 = unknown), matching expo-location's coords.speed semantics so
  // the JS adapter maps cleanly onto the HMM's location shape.
  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    for loc in locations {
      onLocation([
        "latitude": loc.coordinate.latitude,
        "longitude": loc.coordinate.longitude,
        "accuracy": loc.horizontalAccuracy,
        "altitude": loc.altitude,
        "speed": loc.speed,
        "course": loc.course,
        "timestamp": loc.timestamp.timeIntervalSince1970 * 1000.0
      ])
    }
  }

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
