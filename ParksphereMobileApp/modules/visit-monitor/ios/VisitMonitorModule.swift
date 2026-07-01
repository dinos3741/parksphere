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

    Events("onVisit", "onGeofence", "onLocation")

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
  }

  private func ensureManager() {
    if manager != nil { return }
    let m = CLLocationManager()
    let proxy = LocationDelegate(
      onVisit: { [weak self] payload in self?.sendEvent("onVisit", payload) },
      onGeofence: { [weak self] payload in self?.sendEvent("onGeofence", payload) },
      onLocation: { [weak self] payload in self?.sendEvent("onLocation", payload) }
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

  init(
    onVisit: @escaping ([String: Any]) -> Void,
    onGeofence: @escaping ([String: Any]) -> Void,
    onLocation: @escaping ([String: Any]) -> Void
  ) {
    self.onVisit = onVisit
    self.onGeofence = onGeofence
    self.onLocation = onLocation
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
}
