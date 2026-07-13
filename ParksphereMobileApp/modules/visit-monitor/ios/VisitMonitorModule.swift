import ExpoModulesCore
import CoreLocation
import UserNotifications
import AVFoundation
import CoreMotion

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
  private static let nativeLogThrottleSec: TimeInterval = 30.0 // was 3s (Build-E liveness proof); 30s keeps
  // the 5000-cap heartbeat from evicting the meaningful tagged events (park/return/state/rearm) on a
  // multi-hour trip — 2026-07-11's 4.5h trip lost its whole first half to 2394 'live' entries. Forced
  // tag logs (park/return/state/rearm/bt) bypass this throttle, so nothing important is lost.
  // ── Lean native park-detector (Build E, 2026-07-08) ──────────────────────────
  // Runs in the liveUpdates loop (proven to execute LIVE in the background while JS sleeps). Declares a
  // park from the fix stream — no HMM — using: saw driving, then stayed within a small radius, slow, for
  // a sustained window (distance-based so a `speed==-1` unknown reading doesn't stall it). A traffic
  // light fails the test (the car drives away → speed climbs → candidate resets). On a confirmed park it
  // fires a LOCAL notification, arms the returning geofence, and persists the spot for JS to reconcile.
  private var parkDriveSeen = false            // saw automotive-range speed this session
  private var parkStopFix: CLLocation?         // candidate rest location
  private var parkStopSince: TimeInterval = 0  // when the candidate rest began
  private var parkDeclared = false             // already declared this session
  private static let parkDriveSpeedMS = 4.0    // ~14.4 km/h — clearly driving
  private static let parkBtMaxSpeedMS = 3.0    // BT-disconnect park only if slow/stopped (reject a mid-drive BT glitch)
  private static let parkStopRadiusM = 40.0    // GPS noise + parking maneuver
  private static let parkStopConfirmSec = 120.0 // sustained stillness to beat a long traffic light
  private static let parkRearmDistM = 150.0     // drove >this from the car at speed ⇒ new trip ⇒ re-arm park detection
  private var nativeParkURL: URL? {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
      .appendingPathComponent("native_park.json")
  }

  // ── Lean native RETURN-detector (Build E, 2026-07-08) ────────────────────────
  // Once a park is declared (or JS hands us the car spot), we keep the live session armed while parked
  // and watch the fix stream for the owner walking back — distance-to-car, no geofence crossing needed,
  // so it works for CLOSE urban parking (park 70m from your destination) where a geofence can't (you
  // never leave a 200m ring). The geofence stays only as a robust backup wake. Fires ONE local
  // notification when: the owner got AWAY from the car, then sustains an APPROACH back toward it.
  private var carLocation: CLLocation?          // known car spot → phase = watch-for-return (nil = look-for-park)
  private var returningNotified = false         // returning signalled (SOFT or COMMIT) — used by state + reset
  private var returnMaxDist: Double = 0          // farthest the owner got from the car (the "away" gate)
  // R2 graded returning: EMA-smoothed GEOMETRY confidence (heading-toward-car alignment, sustained) +
  // distance-weighted returnBoundary (ported from returnBoundary.js). SOFT = "freeing soon", COMMIT
  // (sustained) = "vacating now" + ETA. Confidence updates ONLY on real movement (>returnMinMoveM) so
  // stationary GPS jitter near the car can't fire it (the 2026-07-11 premature return at 40m). Replaces
  // the lean "3 sustained-approach fixes" trigger. No ML (geometry-first per the 2026-07-11 revision).
  private var returnPrevFix: CLLocation?
  private var returnSmoothedConf: Double = 0
  private var returnSoftFired = false
  private var returnCommitFired = false
  private var returnCommitSince: TimeInterval = 0
  private var returnAwaySince: TimeInterval = 0 // when the owner last became clearly away (>reArmDist) — re-arm gate
  private static let returnAwayThresholdM = 40.0 // must get this far from the car to arm return
  private static let returnMinMoveM = 5.0        // ignore sub-5m jitter when updating the confidence
  private static let returnEmaAlpha = 0.30       // confidence smoothing (matches the JS ALPHA)
  private static let returnCommitHoldSec = 8.0   // sustained COMMIT-level confidence before "vacating now"
  private static let returnAlertMaxRange = 200.0 // returnBoundary ALERT_MAX_RANGE
  private static let returnEtaMinSpeed = 0.5     // m/s — below this, no ETA
  private static let returnReArmDistM = 40.0     // clearly away from the car (beyond this) counts toward re-arm
  private static let returnReArmSustainSec = 120.0 // must stay clearly away THIS long to re-arm — beats the hover-flap AND the multi-hour latch
  // R4: log the returning confidence TRAJECTORY (dist/conf/thresholds/zone) periodically while in the
  // watch phase, so the heartbeat shows WHY it fired or didn't → precise threshold tuning.
  private var lastReturnLogAt: TimeInterval = 0
  private static let returnLogThrottleSec: TimeInterval = 10.0

  // ── Native BT car-audio park signal (Build E, 2026-07-09) ────────────────────
  // Mirrors CarAudioModule's route detection but runs IN VisitMonitor so it works in the background
  // (CarAudio's onCarConnectionChange goes to JS, which is suspended). When the car audio disconnects
  // (engine off) after we've driven, declare the park INSTANTLY at the last fix — Apple's parked-car
  // trick — instead of waiting out the 120s stop heuristic. The stop-detector stays as the fallback for
  // cars that don't connect BT. BT can't WAKE a suspended app, but our live session keeps native alive
  // through the drive so we catch the disconnect. Detects .bluetoothHFP / .carAudio (excludes A2DP
  // headphones). Session config mirrors CarAudio (mic usage is declared); idempotent if both run.
  private var carBtObserver: NSObjectProtocol?
  private var carBtConnected = false       // current car-audio route state (edge-detected)
  private var carBtTripSeen = false        // a car connected during this trip (confidence/logging)
  private var lastBtPollAt: TimeInterval = 0
  private var lastLiveFix: CLLocation?     // most recent liveUpdates fix — the BT-park location source

  // ── Native current-state (R1, 2026-07-11) ────────────────────────────────────
  // ONE authoritative state native maintains + persists, so the foreground shows the TRUE state
  // instantly (in sync) instead of re-deriving it (stale flash). Activity from CMMotionActivity (the
  // coprocessor; native is alive under the session so it can stream live in bg), fused with speed + the
  // park/return lifecycle (carLocation/parkDriveSeen/returningNotified). Persisted to native_state.json;
  // JS adopts it on foreground (R3). Coarse now; R2 adds the graded returning confidence.
  private let activityManager = CMMotionActivityManager()
  private var currentActivity = "unknown"    // automotive|cycling|walking|running|stationary|unknown
  private var currentState = "idle"          // idle|driving|stopped|walking|parked|returning
  private var currentStateSince: TimeInterval = 0
  private var nativeStateURL: URL? {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
      .appendingPathComponent("native_state.json")
  }
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
      self.armParkedRegion(latitude, longitude, radius)
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
          // NB: do NOT reset the park/return state here — the session can restart mid-watch (bg↔fg) and
          // we must preserve a declared park. JS calls resetParkDetection() on drive-off/new trip.
          self.liveTask = Task { [weak self] in
            do {
              for try await update in CLLocationUpdate.liveUpdates() {
                if Task.isCancelled { break }
                guard let self = self, let loc = update.location else { continue }
                self.lastLiveFix = loc // freshest fix for the BT-disconnect park (manager.location is stale under liveUpdates)
                // Poll the BT state (reason-agnostic disconnect catcher), throttled; on main to avoid a
                // race with the route-change observer that also drives the edge detector.
                let btNow = Date().timeIntervalSince1970
                if btNow - self.lastBtPollAt > 3.0 {
                  self.lastBtPollAt = btNow
                  DispatchQueue.main.async { self.refreshCarBt(reason: "poll") }
                }
                self.logNativeFix(loc, tag: "live") // native-liveness probe (independent of JS)
                // Phase: no car spot → look for a park; parked & driving away → new trip, re-arm (so
                // multi-trip days work WITHOUT JS, which is suspended between trips); else watch for return.
                if self.carLocation == nil {
                  self.detectPark(loc)
                } else if self.isDriveAwayFromCar(loc) {
                  self.logNativeFix(loc, tag: "rearm", force: true)
                  self.rearmParkDetection()
                  self.detectPark(loc)
                } else {
                  self.detectReturn(loc)
                }
                self.recomputeState() // R1: keep the authoritative current-state fresh per fix
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

    // Post a local notification from native on demand (manual confirmation / future native park alert).
    AsyncFunction("sendLocalNotification") { (title: String, body: String) in
      self.postLocalNotification(title: title, body: body)
    }

    // Native park readback: JS reads the spot the native detector declared in the background and
    // reconciles it (arm SPOT_KEY / update the map) on foreground. Returns the JSON string ("" if none).
    AsyncFunction("readNativePark") { () -> String in
      guard let url = self.nativeParkURL,
            let s = try? String(contentsOf: url, encoding: .utf8) else { return "" }
      return s
    }

    AsyncFunction("clearNativePark") {
      if let url = self.nativeParkURL { try? FileManager.default.removeItem(at: url) }
    }

    // R1: the authoritative current-state {state, activity, since, t}. JS reads it on foreground to show
    // the true state instantly (in sync with the background), then refines it live (R3).
    AsyncFunction("readNativeState") { () -> String in
      guard let url = self.nativeStateURL,
            let s = try? String(contentsOf: url, encoding: .utf8) else { return "" }
      return s
    }

    // JS hands the native watcher a car spot (a park declared by the foreground HMM or reconciled on
    // launch) so native watches for the return even when JS didn't declare the park itself.
    // DEDUPE: if we're already watching this same spot, DON'T re-arm — beginReturnWatch resets
    // returningNotified, so re-arming on a foreground reconciliation of the SAME spot re-fires an
    // already-delivered return (the 2026-07-09 double-return). Only (re)arm for a genuinely new location.
    AsyncFunction("setCarLocation") { (latitude: Double, longitude: Double) in
      let loc = CLLocation(latitude: latitude, longitude: longitude)
      if let car = self.carLocation, car.distance(from: loc) < VisitMonitorModule.parkStopRadiusM { return }
      self.beginReturnWatch(at: loc)
    }

    // JS calls this on drive-off / spot clear (a new trip): drop the car spot + re-arm park detection.
    AsyncFunction("resetParkDetection") {
      self.rearmParkDetection()
      self.carBtTripSeen = (self.firstCarPort() != nil) // re-seed: still in the car ⇒ still a trip
    }

    // House test: schedule a native notification `afterSeconds` in the future. Call it, background the
    // app (or lock the phone), and it lands on the lock screen — confirms native → notification delivery
    // with no drive/GPS. JS wires this to fire on app-background when the house-test flag is on.
    AsyncFunction("scheduleTestNotification") { (afterSeconds: Double) in
      self.postLocalNotification(
        title: "🔧 Native alive (scheduled)",
        body: "Fired from native \(Int(afterSeconds))s after backgrounding.",
        afterSeconds: max(1, afterSeconds)
      )
    }
  }

  // Post a local notification straight from native code. UNUserNotificationCenter delivers even when
  // the RN JS thread is suspended, so a native-detected park can alert the user LIVE in the background
  // — no server, no APNs, no foreground. Shares the app's notification authorization (granted by the JS
  // expo-notifications init); requests it defensively in case it wasn't.
  fileprivate func postLocalNotification(title: String, body: String, afterSeconds: Double = 0) {
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound]) { _, _ in
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      // trigger nil = fire immediately; a time-interval trigger fires N seconds later even if the app
      // has since been backgrounded/suspended — the house test (background the app, notification lands).
      let trigger: UNNotificationTrigger? = afterSeconds > 0
        ? UNTimeIntervalNotificationTrigger(timeInterval: afterSeconds, repeats: false)
        : nil
      let req = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: trigger)
      center.add(req, withCompletionHandler: nil)
    }
  }

  // Arm (or replace) the parked-spot region. Callable from the JS AsyncFunction and from the native
  // park-detector. Region ops must run on the main queue.
  fileprivate func armParkedRegion(_ latitude: Double, _ longitude: Double, _ radius: Double) {
    DispatchQueue.main.async {
      self.ensureManager()
      guard let m = self.manager else { return }
      for r in m.monitoredRegions where r.identifier == VisitMonitorModule.regionId {
        m.stopMonitoring(for: r)
      }
      let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
      let region = CLCircularRegion(center: center, radius: radius, identifier: VisitMonitorModule.regionId)
      region.notifyOnEntry = true
      region.notifyOnExit = true
      m.startMonitoring(for: region)
    }
  }

  // Feed one fix to the native park state machine (called from the liveUpdates loop). See the state
  // declarations above for the logic. On a confirmed park it declares once per session.
  fileprivate func detectPark(_ loc: CLLocation) {
    if parkDeclared { return }
    let sp = loc.speed // m/s, -1 = unknown
    if sp >= VisitMonitorModule.parkDriveSpeedMS {
      parkDriveSeen = true          // clearly driving → (re)start the "still looking for a stop" state
      parkStopFix = nil
      return
    }
    guard parkDriveSeen else { return } // never drove → not a park (ignore walking dwells)
    let now = Date().timeIntervalSince1970
    if let cand = parkStopFix {
      if loc.distance(from: cand) <= VisitMonitorModule.parkStopRadiusM {
        // Still resting near the candidate. Confirmed once we've held it long enough.
        if now - parkStopSince >= VisitMonitorModule.parkStopConfirmSec {
          parkDeclared = true
          declarePark(at: cand)
        }
      } else {
        // Moved off the candidate (a light that turned green, or crept forward) → reset the candidate.
        parkStopFix = loc
        parkStopSince = now
      }
    } else {
      // First slow fix after driving → open a candidate rest point here.
      parkStopFix = loc
      parkStopSince = now
    }
  }

  // A park is confirmed: alert the user, arm the returning geofence, and persist the spot for JS — all
  // native, so it works with the JS thread suspended. JS reconciles native_park.json on next foreground.
  private func declarePark(at loc: CLLocation, source: String = "stop") {
    let lat = loc.coordinate.latitude
    let lon = loc.coordinate.longitude
    postLocalNotification(title: "🅿️ Parked", body: "Saved your car's spot (native).")
    armParkedRegion(lat, lon, 200) // returning geofence — backup wake; ENTER fires even if JS never wakes
    logNativeFix(loc, tag: "park-\(source)", force: true) // source = stop | bt (heartbeat diagnostics)
    beginReturnWatch(at: loc) // keep watching the fix stream for the walk back (primary return signal)
    recomputeState() // → parked, immediately
    let entry: [String: Any] = ["lat": lat, "lon": lon, "acc": loc.horizontalAccuracy, "t": Date().timeIntervalSince1970 * 1000.0, "source": source]
    nativeLogQueue.async { [weak self] in
      guard let self = self, let url = self.nativeParkURL,
            let data = try? JSONSerialization.data(withJSONObject: entry) else { return }
      try? data.write(to: url)
    }
  }

  // ── Native BT car-audio detection (mirrors CarAudioModule; runs in the bg where JS can't) ────────
  // Configure the shared session so car ports surface (setCategory doesn't prompt/require the audio bg
  // mode — we only READ the route), seed the current state, and observe route changes. Registered once.
  private func setupCarBtObserver() {
    if carBtObserver != nil { return }
    try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.allowBluetooth, .mixWithOthers, .defaultToSpeaker])
    carBtConnected = (firstCarPort() != nil)
    carBtTripSeen = carBtConnected
    carBtObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
    ) { [weak self] note in self?.handleCarRouteChange(note) }
  }

  private func handleCarRouteChange(_ note: Notification) {
    guard let info = note.userInfo,
          let reasonV = info[AVAudioSessionRouteChangeReasonKey] as? UInt else { return }
    // Diagnostic: log every route change that touches a car port (prev or now), so the next field test
    // reveals the car's real disconnect behavior — the reason code + whether a car port lingered.
    // Field 2026-07-09 saw 3 connects, 0 disconnects: the disconnect happened (it reconnected) but the
    // old .oldDeviceUnavailable + !routeHasCar() path missed it (likely a lingering HFP input / odd reason).
    let prev = info[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription
    let carPrev = prev.map { ($0.outputs + $0.inputs).contains { VisitMonitorModule.isCarPort($0.portType) } } ?? false
    let carNow = routeHasCar()
    if (carPrev || carNow), let loc = lastLiveFix {
      logNativeFix(loc, tag: "btRoute:r\(reasonV):p\(carPrev ? 1 : 0):n\(carNow ? 1 : 0)", force: true)
    }
    refreshCarBt(reason: "r\(reasonV)")
  }

  // Reason-agnostic BT edge detector. `connected` = a car port in the route (firstCarPort). Called from
  // the route-change observer AND polled in the liveUpdates loop, so a disconnect is caught however the
  // route ends up. On a disconnect after driving (parkDriveSeen, not yet parked) → the fast-path park;
  // the parkDriveSeen gate stops a sit-in-car-and-turn-off false park. Idempotent (acts only on change).
  private func refreshCarBt(reason: String) {
    let now = (firstCarPort() != nil)
    if now == carBtConnected { return }
    carBtConnected = now
    guard let loc = lastLiveFix else { return }
    if now {
      carBtTripSeen = true
      logNativeFix(loc, tag: "btConnect:\(reason)", force: true)
    } else if parkDriveSeen && carLocation == nil && loc.speed < VisitMonitorModule.parkBtMaxSpeedMS {
      // A real park is STATIONARY when BT drops (engine off). A transient BT dropout while DRIVING
      // (2026-07-13: false park-bt @58km/h) must NOT declare a park — gate on low speed. speed==-1
      // (unknown, common when stopped) is < the threshold so it still allows a genuine park.
      declarePark(at: loc, source: "bt")
    } else {
      logNativeFix(loc, tag: "btDisconnect:\(reason)", force: true, extra: ["spd": loc.speed])
    }
  }

  // ── Native current-state (R1) ────────────────────────────────────────────────
  // Stream motion activity from the coprocessor (live while native is alive). Each change re-derives
  // the authoritative current-state. If unavailable, state falls back to speed + lifecycle only.
  private func startActivityUpdatesIfAvailable() {
    guard CMMotionActivityManager.isActivityAvailable() else { return }
    activityManager.startActivityUpdates(to: .main) { [weak self] activity in
      guard let self = self, let a = activity else { return }
      let label: String
      if a.automotive { label = "automotive" }
      else if a.cycling { label = "cycling" }
      else if a.running { label = "running" }
      else if a.walking { label = "walking" }
      else if a.stationary { label = "stationary" }
      else { label = "unknown" }
      if label != self.currentActivity { self.currentActivity = label; self.recomputeState() }
    }
  }

  // Derive the single authoritative state from the park/return lifecycle + motion activity + speed.
  // Persists + logs only on a real change. Called from the fix loop, the activity handler, and every
  // lifecycle transition (park/return/rearm), so native_state.json always holds the true current state.
  fileprivate func recomputeState() {
    let spdKmh = (lastLiveFix?.speed ?? -1) * 3.6
    let newState: String
    if carLocation != nil {
      newState = returningNotified ? "returning" : "parked"        // parked lifecycle owns the state
    } else if currentActivity == "automotive" || currentActivity == "cycling" || spdKmh > 12 {
      newState = "driving"
    } else if currentActivity == "walking" || currentActivity == "running" {
      newState = "walking"
    } else if parkDriveSeen && (currentActivity == "stationary" || (spdKmh >= 0 && spdKmh < 4)) {
      newState = "stopped"                                          // drove, now still (maybe about to park)
    } else {
      newState = "idle"
    }
    if newState == currentState { return }
    currentState = newState
    currentStateSince = Date().timeIntervalSince1970
    persistState()
    if let loc = lastLiveFix { logNativeFix(loc, tag: "state:\(newState)", force: true) }
  }

  private func persistState() {
    let entry: [String: Any] = [
      "state": currentState,
      "activity": currentActivity,
      "since": currentStateSince * 1000.0,
      "t": Date().timeIntervalSince1970 * 1000.0
    ]
    nativeLogQueue.async { [weak self] in
      guard let self = self, let url = self.nativeStateURL,
            let data = try? JSONSerialization.data(withJSONObject: entry) else { return }
      try? data.write(to: url)
    }
  }

  private static func isCarPort(_ port: AVAudioSession.Port) -> Bool {
    return port == .bluetoothHFP || port == .carAudio // excludes .bluetoothA2DP (headphones)
  }
  private func firstCarPort() -> AVAudioSessionPortDescription? {
    let s = AVAudioSession.sharedInstance()
    if let o = s.currentRoute.outputs.first(where: { VisitMonitorModule.isCarPort($0.portType) }) { return o }
    if let i = s.currentRoute.inputs.first(where: { VisitMonitorModule.isCarPort($0.portType) }) { return i }
    return s.availableInputs?.first { VisitMonitorModule.isCarPort($0.portType) }
  }
  private func routeHasCar() -> Bool {
    let s = AVAudioSession.sharedInstance()
    return s.currentRoute.outputs.contains { VisitMonitorModule.isCarPort($0.portType) } ||
           s.currentRoute.inputs.contains { VisitMonitorModule.isCarPort($0.portType) }
  }

  // Re-arm park detection natively (a new trip started). Used when the owner drives away from the
  // parked car, so multi-trip days work WITHOUT JS (suspended between trips). carBtTripSeen is left as
  // is (still in the car ⇒ still a trip); the JS resetParkDetection re-seeds it from the live route.
  private func rearmParkDetection() {
    carLocation = nil
    returningNotified = false
    parkDriveSeen = false
    parkStopFix = nil
    parkDeclared = false
    recomputeState() // → driving/idle, the new trip
  }

  // Owner is driving clearly away from the parked car ⇒ a new trip → time to re-arm park detection.
  private func isDriveAwayFromCar(_ loc: CLLocation) -> Bool {
    guard let car = carLocation else { return false }
    return loc.speed >= VisitMonitorModule.parkDriveSpeedMS && loc.distance(from: car) > VisitMonitorModule.parkRearmDistM
  }

  // Enter the watch-for-return phase around a known car location (from a native park OR a JS handoff).
  fileprivate func beginReturnWatch(at loc: CLLocation) {
    carLocation = loc
    returningNotified = false
    returnMaxDist = 0
    returnPrevFix = nil
    returnSmoothedConf = 0
    returnSoftFired = false
    returnCommitFired = false
    returnCommitSince = 0
    returnAwaySince = 0
  }

  // Feed one fix to the return watcher (called from the liveUpdates loop while parked). Fires once when
  // the owner, having gone AWAY from the car, sustains an APPROACH back toward it — distance-based, so
  // it works for close parking a geofence can't catch.
  fileprivate func detectReturn(_ loc: CLLocation) {
    guard let car = carLocation else { return }
    let dist = loc.distance(from: car)
    if dist > returnMaxDist { returnMaxDist = dist }
    // Track how long the owner has been clearly AWAY from the car (reset when they come back within range).
    if dist > VisitMonitorModule.returnReArmDistM {
      if returnAwaySince == 0 { returnAwaySince = Date().timeIntervalSince1970 }
    } else {
      returnAwaySince = 0
    }
    // Re-arm for a REPEAT return: after a return fired, once the owner has been clearly away for a
    // SUSTAINED period, reset so a fresh approach re-fires. Sustained (not instant) beats the rapid
    // hover-at-40m flap (2026-07-13: 40x soft/rearm); and unlike the reached-car gate it doesn't LATCH a
    // premature return that never reached the car (2026-07-13: an early commit blocked the real 7h-later
    // return). Handles the multi-hour park + "went to car, left, came back". Driving off rearms separately.
    if (returnSoftFired || returnCommitFired) && returnAwaySince != 0
       && Date().timeIntervalSince1970 - returnAwaySince > VisitMonitorModule.returnReArmSustainSec {
      returnSoftFired = false
      returnCommitFired = false
      returnCommitSince = 0
      returnSmoothedConf = 0
      returnPrevFix = nil
      returnAwaySince = 0
      logNativeFix(loc, tag: "return-rearm", force: true)
    }
    guard !returnCommitFired else { return }
    // Update the confidence only on REAL movement — a stationary jitter near the car must not build
    // confidence (that fired the premature return at 40m). approachAlignment ∈ [-1,1] = how much the
    // movement heads toward the car; EMA-smooth it so a single aligned twitch can't trip the boundary.
    if let prev = returnPrevFix {
      if prev.distance(from: loc) >= VisitMonitorModule.returnMinMoveM {
        let inst = max(0, approachAlignment(prev: prev, cur: loc, car: car))
        returnSmoothedConf = VisitMonitorModule.returnEmaAlpha * inst
          + (1 - VisitMonitorModule.returnEmaAlpha) * returnSmoothedConf
        returnPrevFix = loc
      }
    } else {
      returnPrevFix = loc
    }
    guard returnMaxDist > VisitMonitorModule.returnAwayThresholdM else { return } // must have left the car
    let P = returnSmoothedConf
    // R4: log the confidence trajectory (throttled) so a field test shows the curve vs the thresholds.
    let soft = VisitMonitorModule.softThreshold(dist), commit = VisitMonitorModule.commitThreshold(dist)
    let now = Date().timeIntervalSince1970
    if now - lastReturnLogAt > VisitMonitorModule.returnLogThrottleSec {
      lastReturnLogAt = now
      let zone = P > commit ? "COMMIT" : (P > soft ? "SOFT" : "WAIT")
      logNativeFix(loc, tag: "return-traj", force: true, extra: [
        "dist": Int(dist), "conf": (P * 100).rounded() / 100,
        "soft": (soft * 100).rounded() / 100, "commit": (commit * 100).rounded() / 100, "zone": zone
      ])
    }
    // COMMIT — sustained above the (distance-weighted) commit curve → "vacating now" + ETA.
    if P > VisitMonitorModule.commitThreshold(dist) {
      if returnCommitSince == 0 { returnCommitSince = Date().timeIntervalSince1970 }
      if Date().timeIntervalSince1970 - returnCommitSince >= VisitMonitorModule.returnCommitHoldSec {
        returnCommitFired = true
        returningNotified = true
        let eta = VisitMonitorModule.etaSeconds(dist, loc.speed)
        postLocalNotification(title: "🟢 Spot vacating now", body: eta != nil ? "Arriving in ~\(eta!)s." : "You're heading back to the car.")
        logNativeFix(loc, tag: "return-commit", force: true)
        recomputeState()
        return
      }
    } else {
      returnCommitSince = 0 // dropped below the commit curve → restart the hold
    }
    // SOFT — above the soft curve → "freeing soon" (once). Cheap heads-up; COMMIT is the confirmed one.
    if !returnSoftFired && P > VisitMonitorModule.softThreshold(dist) {
      returnSoftFired = true
      returningNotified = true
      postLocalNotification(title: "🟡 Spot freeing soon", body: "You're heading back (~\(Int(dist))m).")
      logNativeFix(loc, tag: "return-soft", force: true)
      recomputeState()
    }
  }

  // Movement-vs-car-direction cosine ∈ [-1,1] (equirectangular; mirrors the JS HMM approachAlignment).
  private func approachAlignment(prev: CLLocation, cur: CLLocation, car: CLLocation) -> Double {
    let kx = cos(cur.coordinate.latitude * .pi / 180)
    let vx = (cur.coordinate.longitude - prev.coordinate.longitude) * kx
    let vy = (cur.coordinate.latitude - prev.coordinate.latitude)
    let dx = (car.coordinate.longitude - cur.coordinate.longitude) * kx
    let dy = (car.coordinate.latitude - cur.coordinate.latitude)
    let magV = (vx * vx + vy * vy).squareRoot()
    let magD = (dx * dx + dy * dy).squareRoot()
    if magV == 0 || magD == 0 { return 0 }
    return (vx * dx + vy * dy) / (magV * magD)
  }

  // returnBoundary (ported from returnBoundary.js) — distance-weighted zone curves + ETA. Far from the
  // car needs HIGH confidence; close needs modest. This is what stops a twitch at 40m from firing.
  private static func softThreshold(_ dist: Double) -> Double {
    let d = min(max(dist, 0), returnAlertMaxRange); return 0.40 + 0.32 * (d / returnAlertMaxRange)
  }
  private static func commitThreshold(_ dist: Double) -> Double {
    let d = min(max(dist, 0), returnAlertMaxRange); return 0.55 + 0.35 * (d / returnAlertMaxRange)
  }
  private static func etaSeconds(_ dist: Double, _ speed: Double) -> Int? {
    if speed < returnEtaMinSpeed { return nil }
    return Int((max(dist, 0) / speed).rounded())
  }

  // Append a native-heartbeat line (throttled) recording that native code ran at wall-clock `now`
  // to process a fix whose GPS time is `gpsMs`. Runs on the liveUpdates Task, off the JS thread.
  fileprivate func logNativeFix(_ loc: CLLocation, tag: String, force: Bool = false, extra: [String: Any] = [:]) {
    let nowSec = Date().timeIntervalSince1970
    if !force && nowSec - lastNativeLogAt < VisitMonitorModule.nativeLogThrottleSec { return }
    lastNativeLogAt = nowSec
    var entry: [String: Any] = [
      "t": nowSec * 1000.0,                                   // native wall-clock when processed
      "gps": loc.timestamp.timeIntervalSince1970 * 1000.0,    // the fix's own GPS timestamp
      "lat": loc.coordinate.latitude,
      "lon": loc.coordinate.longitude,
      "spd": loc.speed,
      "tag": tag
    ]
    for (k, v) in extra { entry[k] = v } // R4: trajectory fields (dist/conf/thresholds/zone)
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
    self.setupCarBtObserver() // start watching car-audio connect/disconnect for the fast-path park
    self.startActivityUpdatesIfAvailable() // R1: motion activity → authoritative current-state
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
