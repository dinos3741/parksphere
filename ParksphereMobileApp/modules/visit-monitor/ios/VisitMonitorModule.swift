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
  private let backend = BackendClient() // R5.1: native → Parksphere server (works while JS is suspended)
  // R5.2: the server spot this device currently owns (0 = none). Persisted so it survives a background
  // relaunch, and SHARED with JS (foreground) via get/set so native(bg) + the JS HMM(fg) never
  // double-declare — one park = one server spot.
  private var serverSpotId: Int {
    get { UserDefaults.standard.integer(forKey: "psServerSpotId") }
    set { UserDefaults.standard.set(newValue, forKey: "psServerSpotId") }
  }
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
  // R6: accuracy-aware anchor (port of parkDetectionService.js's stoppedCandidateLocation guard,
  // :646-648, and its 90s refinement window, :622-624,652-664) — every return-distance calc is measured
  // FROM this anchor, so a bad-accuracy park fix corrupts everything downstream otherwise.
  private var parkDeclaredAt: TimeInterval = 0        // when declarePark fired — 0 = no active refine window
  private var parkDeclaredAccuracy: Double = 0        // horizontalAccuracy of the currently-declared anchor
  // R7: tightened to match JS's exact gates (parkDetectionService.js:635-668) — was a flat <50m
  // ceiling with no speed guard; now <25m (matching JS's stoppedCandidateLocation) with a separate
  // ceiling on the REFINING fix itself (parkAnchorRefineAccuracyCeilingM, JS's `currentAccuracy<20`).
  private static let parkAnchorGoodAccuracyM = 25.0   // only PREFER a candidate fix at least this accurate
  private static let parkAnchorRefineWindowSec = 90.0 // matches the JS 90s post-park refinement window
  private static let parkAnchorRefineFactor = 0.5     // a refining fix must beat the declared accuracy by 2x
  private static let parkAnchorRefineAccuracyCeilingM = 20.0 // AND itself be under this accuracy
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
  private var returnPrevFiltered: [Double]?      // last FILTERED [x,y] (meters, car=origin), not the raw fix
  private var returnPositionFilter = ReturnPositionFilter() // R6: accuracy-weighted Kalman position filter
  private var returnProgressHistory: [(x: Double, y: Double, dist: Double)] = [] // R6: PGR-lite rolling window
  private var returnSmoothedConf: Double = 0
  private var returnSoftFired = false
  private var returnCommitFired = false
  private var returnCommitSince: TimeInterval = 0
  private var returnSoftSince: TimeInterval = 0  // when conf first crossed the soft curve — SOFT needs it sustained
  private var returnMinDist: Double = .greatestFiniteMagnitude // closest approach since firing — re-arm when they leave it
  private static let returnAwayThresholdM = 40.0 // must get this far from the car to arm return
  private static let returnMinMoveM = 5.0        // ignore sub-5m jitter when updating the confidence
  private static let returnEmaAlpha = 0.30       // confidence smoothing (matches the JS ALPHA)
  private static let returnCommitHoldSec = 8.0   // sustained COMMIT-level confidence before "vacating now"
  private static let returnSoftHoldSec = 5.0     // sustained SOFT-level confidence before "freeing soon" — filters brief spikes
  private static let returnAlertMaxRange = 200.0 // returnBoundary ALERT_MAX_RANGE
  private static let returnEtaMinSpeed = 0.5     // m/s — below this, no ETA
  private static let returnLeaveMarginM = 40.0   // moved this far BACK from the closest approach ⇒ left again ⇒ re-arm
  // R6: GPS-spike robustness — port of the foreground JS HMM's accuracy-awareness (parkDetection_HMM.js)
  // into the native return path, which previously trusted every fix equally regardless of accuracy.
  private static let returnAccuracyRefDist = 20.0      // gpsWeight neutral point (matches JS "accuracy > 20")
  private static let returnAccuracyWeightFloor = 0.2   // gpsWeight floor (matches JS)
  private static let returnDefaultAccuracy = 20.0       // fallback when horizontalAccuracy is invalid (≤0)
  private static let returnProgressWindowSize = 15      // PGR history cap (matches JS PROGRESS_WINDOW_SIZE)
  private static let returnProgressMinSamples = 5       // PGR untrusted below this many samples (matches JS)
  private static let returnProgressNeutral = 0.2        // pgr value at which progressWeight reaches 1.0
  private static let returnProgressWeightFloor = 0.3    // progressWeight floor — damp, don't hard-veto
  // R4: log the returning confidence TRAJECTORY (dist/conf/thresholds/zone) periodically while in the
  // watch phase, so the heartbeat shows WHY it fired or didn't → precise threshold tuning.
  private var lastReturnLogAt: TimeInterval = 0
  private static let returnLogThrottleSec: TimeInterval = 10.0
  // R5.3: confirmation interactive notification (SOFT gating). User taps Yes → spot goes public; No → suppress.
  fileprivate static let notifCategoryReturn = "PARKSPHERE_RETURN_CONFIRM"
  fileprivate static let notifActionYes = "CONFIRM_YES"
  fileprivate static let notifActionNo = "CONFIRM_NO"
  private var notifProxy: ReturnNotifProxy?  // strong ref — owns the delegate chain
  private var notifCategoryRegistered = false        // true once setNotificationCategories has landed
  private var pendingNotifCategoryCallbacks: [() -> Void] = []  // queued posts waiting on registration
  // R5.3 foreground fallback: the banner's Yes/No only work if the user catches it (Temporary banner
  // style auto-dismisses; iOS gives apps no way to force Persistent). So also track "awaiting an answer"
  // here — JS polls this on every foreground and shows an in-app Yes/No popup if still pending.
  private var returnConfirmPending = false
  private var returnConfirmPendingDist = 0
  private var returnSuppressed = false       // user tapped No → suppress COMMIT too; reset on rearm

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

  // ── R7 Phase C spike (2026-07-25) ────────────────────────────────────────────────────────────
  // Before building the full FFT/spectral pipeline (which needs sustained 50Hz accelerometer
  // sampling), confirm that raw CMMotionManager sampling actually survives in the background at
  // all. Unlike CLLocationUpdate.liveUpdates (a SANCTIONED background-delivery API,
  // CLBackgroundActivitySession proven to keep it alive), CMMotionManager has no such guarantee —
  // it only keeps sampling if the PROCESS happens to be alive for another reason (here: the same
  // location session). This just counts samples and logs a throttled heartbeat entry so a field
  // test can show whether a steady spread of counts (native truly alive) or one huge burst at
  // foreground-resume (suspended, exactly the failure mode location itself had pre-Build-E).
  private let motionManager = CMMotionManager()
  private var accelSpikeSampleCount = 0
  private var lastAccelSpikeLogAt: TimeInterval = 0
  private static let accelSpikeLogThrottleSec: TimeInterval = 10.0
  private static let accelSpikeUpdateInterval: TimeInterval = 0.02 // 50Hz — the eventual real FFT rate

  private func startAccelSpike() {
    guard motionManager.isAccelerometerAvailable, !motionManager.isAccelerometerActive else { return }
    motionManager.accelerometerUpdateInterval = VisitMonitorModule.accelSpikeUpdateInterval
    motionManager.startAccelerometerUpdates(to: .main) { [weak self] _, _ in
      guard let self = self else { return }
      self.accelSpikeSampleCount += 1
      let now = Date().timeIntervalSince1970
      guard now - self.lastAccelSpikeLogAt > VisitMonitorModule.accelSpikeLogThrottleSec else { return }
      let count = self.accelSpikeSampleCount
      self.accelSpikeSampleCount = 0
      self.lastAccelSpikeLogAt = now
      guard let loc = self.lastLiveFix else { return } // no fix yet (e.g. cold start) — skip, not an error
      self.logNativeFix(loc, tag: "accel-spike", force: true, extra: ["count": count])
    }
  }

  // ── R7 Phase E: full-HMM engine integration (toggle-gated) ───────────────────────────────────
  // OFF by default — the R1-R6 path above (detectPark/detectReturn) stays live as the proven
  // fallback until the new engine is field-validated across several real trips. Flip to true once
  // validated; both paths share the same side-effect functions (declarePark, rearmParkDetection,
  // postLocalNotification, updateServerStatus, postReturnConfirmNotification) — only the DECISION
  // of when to fire differs. Dedicated hold-timer/fired-flag state below is kept separate from the
  // R1-R6 path's return*/park* fields so the two engines never share state regardless of the toggle.
  private static let useFullHMM = true
  private let hmmEngine = ParkDetectionHMMEngine()
  private let stepRateProvider = StepRateProvider()
  private let returnPredictor = ParkReturnPredictor()
  private var hmmFusion = HMMFusion()
  private var currentActivityDetail = HMMActivity() // rich per-fix activity (confidence + multi-flag), unlike the R1-R6 path's simple `currentActivity` label string
  private var hmmStopCandidate: CLLocation?          // best-accuracy STOPPED fix while hunting for a park (mirrors parkStopFix, port of stoppedCandidateLocation)
  private var hmmSoftFired = false
  private var hmmCommitFired = false
  private var hmmSoftSince: TimeInterval = 0
  private var hmmCommitSince: TimeInterval = 0
  private var lastHmmLogAt: TimeInterval = 0

  public func definition() -> ModuleDefinition {
    Name("VisitMonitor")

    Events("onVisit", "onGeofence", "onLocationBatch", "onLocationPaused", "onLocationResumed")

    AsyncFunction("start") {
      DispatchQueue.main.async {
        self.ensureManager()
        self.manager?.requestAlwaysAuthorization()
        self.manager?.startMonitoringVisits()
        self.ensureNotifCategoryRegistered() // register Yes/No actions early, well before any return can fire
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
          if VisitMonitorModule.useFullHMM { self.stepRateProvider.start() }
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
                // R7: toggle-gated — the full-HMM engine owns BOTH park-hunting and return-watching in
                // one unified call (mirrors JS's single processLocationHMM), so it doesn't need the
                // R1-R6 path's explicit carLocation==nil / isDriveAwayFromCar dispatch below.
                if VisitMonitorModule.useFullHMM {
                  await self.processFullHMM(loc)
                } else if self.carLocation == nil {
                  // Phase: no car spot → look for a park; parked & driving away → new trip, re-arm (so
                  // multi-trip days work WITHOUT JS, which is suspended between trips); else watch for return.
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
        if VisitMonitorModule.useFullHMM { self.stepRateProvider.stop() }
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

    // ── R5.1: native backend client (JS hands over config; native calls the server) ────────────────
    // JS provides the base URL + current Bearer token + car type (native can't read env/AsyncStorage);
    // persisted so native still has it after a background relaunch. Call on login + every foreground.
    AsyncFunction("configureBackend") { (serverUrl: String, token: String, carType: String) in
      self.backend.configure(url: serverUrl, token: token, carType: carType)
      // R7 field-test diagnosability: log that native got (re)configured, and with what URL/car type —
      // never the token itself. If server calls later show code=0, this confirms whether native even
      // had a URL to call at all.
      if let loc = self.lastLiveFix {
        self.logNativeFix(loc, tag: "server-configure", force: true, extra: ["url": serverUrl, "carType": carType, "hasToken": !token.isEmpty])
      }
    }
    // Declare an auto-detected spot (starts 'occupied' = private). Returns spotId (>0) or -1 on failure.
    AsyncFunction("declareSpotNative") { (latitude: Double, longitude: Double, timeToLeave: Int, promise: Promise) in
      Task { promise.resolve(await self.backend.declareSpot(lat: latitude, lon: longitude, timeToLeave: timeToLeave).id) }
    }
    // Update a spot's status (occupied|soon_free|committed|vacating|free) — the returning broadcast.
    AsyncFunction("updateSpotStatusNative") { (spotId: Int, status: String, promise: Promise) in
      Task { promise.resolve(await self.backend.updateStatus(spotId: spotId, status: status).ok) }
    }
    AsyncFunction("deleteSpotNative") { (spotId: Int, promise: Promise) in
      Task { promise.resolve(await self.backend.deleteSpot(spotId: spotId).ok) }
    }

    // R5.2 dedup: the shared serverSpotId (0 = none). JS reads it on foreground to ADOPT a spot native
    // declared in the background (so JS won't re-declare); JS writes it before backgrounding so native
    // owns a spot JS declared in the foreground. One park = one server spot across the fg/bg boundary.
    AsyncFunction("getServerSpotId") { () -> Int in self.serverSpotId }
    AsyncFunction("setServerSpotId") { (spotId: Int) in self.serverSpotId = spotId }
    AsyncFunction("clearServerSpotId") { self.serverSpotId = 0 }

    // R5.3 foreground fallback: JS polls this on every foreground. Returns the pending distance (m) if
    // a SOFT return is still awaiting a Yes/No answer (banner missed/dismissed), or -1 if none is pending.
    AsyncFunction("getPendingReturnConfirmDist") { () -> Int in
      self.returnConfirmPending ? self.returnConfirmPendingDist : -1
    }
    // JS calls this after the user answers the in-app fallback popup — same effect as tapping the
    // notification's own Yes/No action.
    AsyncFunction("respondReturnConfirm") { (yes: Bool) in
      self.handleReturnConfirmAction(yes ? VisitMonitorModule.notifActionYes : VisitMonitorModule.notifActionNo)
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

  // ── R5.2: drive the server spot lifecycle from native detection (background) ──────────────────────
  // Each fires a fire-and-forget URLSession task (native is alive during detection). serverSpotId is the
  // shared handle. declare deletes any prior spot first (backend 409s a 2nd spot for the same user).
  private func declareServerSpot(_ loc: CLLocation) {
    let lat = loc.coordinate.latitude, lon = loc.coordinate.longitude
    Task { [weak self] in
      guard let self = self else { return }
      if self.serverSpotId > 0 {
        let priorId = self.serverSpotId
        let (ok, code) = await self.backend.deleteSpot(spotId: priorId)
        self.logNativeFix(loc, tag: "server-delete", force: true, extra: ["ok": ok, "code": code, "spotId": priorId, "via": "redeclare"])
        self.serverSpotId = 0
      }
      let (id, code) = await self.backend.declareSpot(lat: lat, lon: lon, timeToLeave: 60)
      self.logNativeFix(loc, tag: "server-declare", force: true, extra: ["ok": id > 0, "code": code, "spotId": id])
      if id > 0 { self.serverSpotId = id }
    }
  }
  private func updateServerStatus(_ status: String) {
    let id = serverSpotId
    guard id > 0 else { return }
    let loc = lastLiveFix
    Task { [weak self] in
      guard let self = self else { return }
      let (ok, code) = await self.backend.updateStatus(spotId: id, status: status)
      if let loc = loc { self.logNativeFix(loc, tag: "server-status", force: true, extra: ["ok": ok, "code": code, "spotId": id, "status": status]) }
    }
  }
  private func deleteServerSpot() {
    let id = serverSpotId
    guard id > 0 else { return }
    serverSpotId = 0
    let loc = lastLiveFix
    Task { [weak self] in
      guard let self = self else { return }
      let (ok, code) = await self.backend.deleteSpot(spotId: id)
      if let loc = loc { self.logNativeFix(loc, tag: "server-delete", force: true, extra: ["ok": ok, "code": code, "spotId": id, "via": "rearm"]) }
    }
  }
  private func updateServerSpotLocation(_ loc: CLLocation) {
    let id = serverSpotId
    guard id > 0 else { return }
    let lat = loc.coordinate.latitude, lon = loc.coordinate.longitude
    Task { [weak self] in
      guard let self = self else { return }
      let (ok, code) = await self.backend.updateLocation(spotId: id, lat: lat, lon: lon)
      self.logNativeFix(loc, tag: "server-location", force: true, extra: ["ok": ok, "code": code, "spotId": id])
    }
  }

  // R5.3 ── Confirmation interactive notification for SOFT return. ─────────────────────────────────
  // Fires before broadcasting the spot, so the owner can confirm they're actually returning (Yes)
  // or flag a false alarm (No). Ignore → COMMIT fires naturally on its own, then publishes the spot.
  // iOS wakes the app (background) to call the delegate when the user taps an action button, so the
  // handler runs in native even with JS suspended.
  private func postReturnConfirmNotification(dist: Int) {
    // Wait for the category to be registered before posting — posting first races
    // setNotificationCategories and iOS silently drops the action buttons if it loses.
    withNotifCategoryRegistered {
      let center = UNUserNotificationCenter.current()
      center.requestAuthorization(options: [.alert, .sound]) { _, _ in
        let content = UNMutableNotificationContent()
        content.title = "Are you returning to your car?"
        content.body = "You appear to be heading back (~\(dist)m away). Confirm to alert nearby drivers."
        content.sound = .default
        content.categoryIdentifier = VisitMonitorModule.notifCategoryReturn
        let req = UNNotificationRequest(identifier: "return-confirm-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil)
        center.add(req, withCompletionHandler: nil)
      }
    }
  }

  // Call as early as possible (module "start") so registration has long finished by the
  // time a real SOFT return can fire — avoids racing the first notification post.
  private func ensureNotifCategoryRegistered() {
    withNotifCategoryRegistered {}
  }

  // Installs the forwarding delegate + registers the RETURN_CONFIRM category exactly once;
  // runs `completion` only after registration has landed (queuing callers that arrive mid-registration).
  private func withNotifCategoryRegistered(_ completion: @escaping () -> Void) {
    if notifCategoryRegistered {
      completion()
      return
    }
    pendingNotifCategoryCallbacks.append(completion)
    guard notifProxy == nil else { return } // registration already in flight; queued above

    let center = UNUserNotificationCenter.current()
    let proxy = ReturnNotifProxy(wrapped: center.delegate, module: self)
    center.delegate = proxy
    notifProxy = proxy
    // Merge our category alongside any expo-notifications categories already registered.
    center.getNotificationCategories { [weak self] existing in
      let yes = UNNotificationAction(identifier: VisitMonitorModule.notifActionYes,
                                     title: "Yes, I'm returning", options: [])
      let no  = UNNotificationAction(identifier: VisitMonitorModule.notifActionNo,
                                     title: "No, false alarm", options: .destructive)
      let cat = UNNotificationCategory(identifier: VisitMonitorModule.notifCategoryReturn,
                                       actions: [yes, no], intentIdentifiers: [], options: [])
      var cats = existing
      cats.insert(cat)
      center.setNotificationCategories(cats)
      DispatchQueue.main.async {
        guard let self = self else { return }
        self.notifCategoryRegistered = true
        let callbacks = self.pendingNotifCategoryCallbacks
        self.pendingNotifCategoryCallbacks.removeAll()
        callbacks.forEach { $0() }
      }
    }
  }

  // Called by ReturnNotifProxy when the user taps an action on the confirm notification.
  fileprivate func handleReturnConfirmAction(_ actionId: String) {
    if actionId == VisitMonitorModule.notifActionYes {
      returnConfirmPending = false // answered (via notification action or the in-app fallback popup) — stop asking
      // Confirmed returning — publish the spot immediately (seekers will see it).
      updateServerStatus("soon_free")
      logNativeFix(lastLiveFix ?? CLLocation(), tag: "return-confirm-yes", force: true)
    } else if actionId == VisitMonitorModule.notifActionNo {
      returnConfirmPending = false // answered — stop asking
      // False alarm — suppress the COMMIT too and reset the whole return state.
      returnSuppressed = true
      returnSoftFired = false
      returnCommitFired = false
      returnCommitSince = 0
      returnSoftSince = 0
      returnSmoothedConf = 0
      returnPrevFiltered = nil
      returnProgressHistory.removeAll()
      returningNotified = false
      recomputeState()
      logNativeFix(lastLiveFix ?? CLLocation(), tag: "return-confirm-no", force: true)
    }
    // Default (UNNotificationDefaultActionIdentifier — user tapped the body, no long-press): leave
    // returnConfirmPending untouched so the in-app fallback popup (checkPendingReturnConfirm in
    // useReturnDetection.js) can still catch it once the app opens.
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
        // R6/R7: prefer a materially better-accuracy fix as the anchor candidate WITHOUT resetting
        // the confirm timer — tightened in R7 to match JS's exact stoppedCandidateLocation gate: a
        // genuinely slow/stopped fix (speed unknown, -1, is treated as stopped too, same as JS's -1
        // sentinel) with accuracy under 25m that beats the current candidate (parkDetectionService.js
        // :635-650).
        let isStoppedSpeed = loc.speed * 3.6 < 5
        let candAccuracy = cand.horizontalAccuracy > 0 ? cand.horizontalAccuracy : .greatestFiniteMagnitude
        if isStoppedSpeed && loc.horizontalAccuracy > 0 && loc.horizontalAccuracy < candAccuracy
          && loc.horizontalAccuracy < VisitMonitorModule.parkAnchorGoodAccuracyM {
          parkStopFix = loc
        }
        // Still resting near the candidate. Confirmed once we've held it long enough.
        if now - parkStopSince >= VisitMonitorModule.parkStopConfirmSec {
          parkDeclared = true
          declarePark(at: parkStopFix ?? cand)
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
    // R6/R7: open the anchor-refinement window (see refineParkAnchorIfNeeded) ONLY if this declare
    // itself was on poor accuracy — tightened in R7 to match JS exactly: a good-accuracy declare
    // never opens the window at all (parkDetectionService.js:622-624: `finalAccuracy > 20 ? ... : null`).
    let declareAccuracy = loc.horizontalAccuracy > 0 ? loc.horizontalAccuracy : .greatestFiniteMagnitude
    parkDeclaredAt = declareAccuracy > VisitMonitorModule.parkAnchorRefineAccuracyCeilingM ? Date().timeIntervalSince1970 : 0
    parkDeclaredAccuracy = declareAccuracy
    recomputeState() // → parked, immediately
    declareServerSpot(loc) // R5.2: create the server spot (starts 'occupied' = private to the owner)
    persistNativeParkEntry(loc, source: source)
  }

  // Persist the current anchor for JS to reconcile on next foreground (native_park.json). Factored out
  // of declarePark so the R6 anchor-refinement path (detectReturn) can re-persist after replacing the
  // anchor with a better-accuracy fix, without duplicating the write.
  private func persistNativeParkEntry(_ loc: CLLocation, source: String) {
    let entry: [String: Any] = [
      "lat": loc.coordinate.latitude, "lon": loc.coordinate.longitude,
      "acc": loc.horizontalAccuracy, "t": Date().timeIntervalSince1970 * 1000.0, "source": source
    ]
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
    try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.allowBluetoothHFP, .mixWithOthers, .defaultToSpeaker])
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
      // R7: richer activity signal for the full-HMM path — multi-flag (not just one label) plus the
      // real CMMotionActivityConfidence (.low/.medium/.high = 0/1/2, matching JS's numeric activity.confidence).
      self.currentActivityDetail = HMMActivity(
        automotive: a.automotive, walking: a.walking || a.running, stationary: a.stationary,
        unknown: a.unknown, confidence: Int(a.confidence.rawValue)
      )
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
    deleteServerSpot() // R5.2: owner drove off / new trip → the spot is freed (delete on the server)
    carLocation = nil
    returningNotified = false
    parkDriveSeen = false
    parkStopFix = nil
    parkDeclared = false
    parkDeclaredAt = 0 // R6: close out any still-open anchor-refinement window from the previous park
    parkDeclaredAccuracy = 0
    returnSuppressed = false // R5.3: new trip clears any No-suppression from the previous one
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
    returnPrevFiltered = nil
    returnPositionFilter.reset() // R6: fresh Kalman state — a new anchor means a new local-meters origin
    returnProgressHistory.removeAll()
    returnSmoothedConf = 0
    returnSoftFired = false
    returnCommitFired = false
    returnCommitSince = 0
    returnSoftSince = 0
    returnMinDist = .greatestFiniteMagnitude
    returnConfirmPending = false
    returnConfirmPendingDist = 0
  }

  // Feed one fix to the return watcher (called from the liveUpdates loop while parked). Fires once when
  // the owner, having gone AWAY from the car, sustains an APPROACH back toward it — distance-based, so
  // it works for close parking a geofence can't catch.
  // R6/R7: shared post-park anchor-refinement check (used by both this R1-R6 path and the R7
  // full-HMM path) — if a materially better-accuracy fix arrives inside the window opened by
  // declarePark, replace the anchor IN PLACE (no new notification/re-declare) and re-arm the
  // return-watch tracking (a new anchor is a new local-meters origin for the Kalman filter). Every
  // distance/alignment calc downstream is measured FROM the anchor, so a bad park fix would otherwise
  // corrupt everything regardless of how good the live-fix filtering is. Tightened in R7 to match
  // JS's exact gates (parkDetectionService.js:622-624,652-668): the refining fix must both beat the
  // declared accuracy by 2x AND itself be under parkAnchorRefineAccuracyCeilingM, and the window
  // closes on the FIRST qualifying fix (JS sets parkRefinementExpiry=null after one refine, doesn't
  // keep refining repeatedly). Returns the refined location if the anchor was just replaced.
  @discardableResult
  private func refineParkAnchorIfNeeded(_ loc: CLLocation) -> CLLocation? {
    guard let car = carLocation, parkDeclaredAt > 0,
          Date().timeIntervalSince1970 - parkDeclaredAt < VisitMonitorModule.parkAnchorRefineWindowSec,
          loc.horizontalAccuracy > 0, parkDeclaredAccuracy > 0,
          loc.horizontalAccuracy < parkDeclaredAccuracy * VisitMonitorModule.parkAnchorRefineFactor,
          loc.horizontalAccuracy < VisitMonitorModule.parkAnchorRefineAccuracyCeilingM,
          loc.distance(from: car) <= VisitMonitorModule.parkStopRadiusM else { return nil }
    parkDeclaredAccuracy = loc.horizontalAccuracy
    parkDeclaredAt = 0 // close the window — JS refines once, not repeatedly
    beginReturnWatch(at: loc)
    persistNativeParkEntry(loc, source: "refine")
    logNativeFix(loc, tag: "park-refine", force: true)
    updateServerSpotLocation(loc) // R7: keep the server spot's coordinates in sync with the refined anchor
    return loc
  }

  fileprivate func detectReturn(_ loc: CLLocation) {
    guard var car = carLocation else { return }
    if let refined = refineParkAnchorIfNeeded(loc) { car = refined }
    // R6: accuracy — invalid (≤0, e.g. no fix yet) falls back to a neutral value (no penalty/bonus).
    let accuracy = loc.horizontalAccuracy > 0 ? loc.horizontalAccuracy : VisitMonitorModule.returnDefaultAccuracy
    let gpsWeight = accuracy > VisitMonitorModule.returnAccuracyRefDist
      ? max(VisitMonitorModule.returnAccuracyWeightFloor, VisitMonitorModule.returnAccuracyRefDist / accuracy)
      : 1.0
    // R6: run the raw fix through the accuracy-weighted Kalman filter (car = local-meters origin) before
    // any distance/alignment math — a low-accuracy indoor fix barely moves the filtered position, so
    // stationary GPS jitter can't masquerade as walking toward the car (port of JS Kalman2D, :106-146).
    let rawMeters = VisitMonitorModule.metersFromOrigin(loc, origin: car)
    let filtered = returnPositionFilter.update(rawMeters, at: loc.timestamp.timeIntervalSince1970, accuracy: accuracy)
    let dist = (filtered[0] * filtered[0] + filtered[1] * filtered[1]).squareRoot()
    if dist > returnMaxDist { returnMaxDist = dist }
    // Re-arm for a REPEAT return: after a return fired, track the CLOSEST approach and re-arm only when
    // the owner moves clearly BACK from it (returnLeaveMarginM) — the true "left again" signal. It doesn't
    // flap while still approaching (2026-07-13/14: "away for Ns" was trivially true at 2km), doesn't latch
    // a premature fire (2026-07-13 7h latch), and ignores a hover. Handles multi-hour + "went to car, left,
    // came back". Driving off rearms separately (isDriveAwayFromCar).
    if returnSoftFired || returnCommitFired {
      if dist < returnMinDist { returnMinDist = dist }
      if dist > returnMinDist + VisitMonitorModule.returnLeaveMarginM {
        returnSoftFired = false
        returnCommitFired = false
        returnCommitSince = 0
        returnSoftSince = 0
        returnSmoothedConf = 0
        returnPrevFiltered = nil
        returnProgressHistory.removeAll()
        returnMinDist = .greatestFiniteMagnitude
        returnConfirmPending = false
        logNativeFix(loc, tag: "return-rearm", force: true)
      }
    }
    guard !returnCommitFired else { return }
    // Only detect returning WITHIN the alert range (mirrors JS distToParked < ALERT_MAX_RANGE). A long
    // aligned approach from 2km out must not fire returning at 2km (2026-07-14) — beyond the range no
    // confidence builds and nothing fires; it starts fresh when the owner enters the range.
    if dist >= VisitMonitorModule.returnAlertMaxRange {
      returnSmoothedConf = 0
      returnPrevFiltered = filtered
      returnProgressHistory.removeAll()
      return
    }
    // Update the confidence only on REAL (filtered) movement — a stationary jitter near the car must not
    // build confidence (that fired the premature return at 40m). gpsWeight further damps a low-accuracy
    // fix's contribution (port of JS gpsWeight, parkDetection_HMM.js:352-353) so bad GPS can't push the
    // EMA even once it clears the move gate. approachAlignmentMeters ∈ [-1,1] = how much the FILTERED
    // movement heads toward the car; EMA-smooth it so a single aligned twitch can't trip the boundary.
    if let prev = returnPrevFiltered {
      let moved = ((filtered[0] - prev[0]) * (filtered[0] - prev[0]) + (filtered[1] - prev[1]) * (filtered[1] - prev[1]))
        .squareRoot()
      if moved >= VisitMonitorModule.returnMinMoveM {
        let inst = max(0, VisitMonitorModule.approachAlignmentMeters(prev: prev, cur: filtered))
        let effectiveAlpha = VisitMonitorModule.returnEmaAlpha * gpsWeight
        returnSmoothedConf = effectiveAlpha * inst + (1 - effectiveAlpha) * returnSmoothedConf
        returnPrevFiltered = filtered
        returnProgressHistory.append((x: filtered[0], y: filtered[1], dist: dist))
        if returnProgressHistory.count > VisitMonitorModule.returnProgressWindowSize {
          returnProgressHistory.removeFirst()
        }
      }
    } else {
      returnPrevFiltered = filtered
    }
    guard returnMaxDist > VisitMonitorModule.returnAwayThresholdM else { return } // must have left the car
    // R6: PGR-lite — net distance gained toward the car ÷ total path walked, over the rolling window.
    // Damps (not vetoes) the confidence so a bouncing GPS spike near-zeroes `pgr` even if one instant
    // alignment sample looked good (port of JS calculatePGR, parkDetection_HMM.js:207-241 — consistency
    // and slope are intentionally omitted; this is the "lite" version scoped in the plan).
    let pgr = VisitMonitorModule.calculatePGR(returnProgressHistory)
    let progressWeight = returnProgressHistory.count < VisitMonitorModule.returnProgressMinSamples
      ? 1.0
      : max(VisitMonitorModule.returnProgressWeightFloor, min(1.0, pgr / VisitMonitorModule.returnProgressNeutral))
    let P = returnSmoothedConf * progressWeight
    // R4: log the confidence trajectory (throttled) so a field test shows the curve vs the thresholds.
    let soft = VisitMonitorModule.softThreshold(dist), commit = VisitMonitorModule.commitThreshold(dist)
    let now = Date().timeIntervalSince1970
    if now - lastReturnLogAt > VisitMonitorModule.returnLogThrottleSec {
      lastReturnLogAt = now
      let zone = P > commit ? "COMMIT" : (P > soft ? "SOFT" : "WAIT")
      logNativeFix(loc, tag: "return-traj", force: true, extra: [
        "dist": Int(dist), "conf": (P * 100).rounded() / 100,
        "soft": (soft * 100).rounded() / 100, "commit": (commit * 100).rounded() / 100, "zone": zone,
        "acc": Int(accuracy), "gpsW": (gpsWeight * 100).rounded() / 100, "pgr": (pgr * 100).rounded() / 100,
        "rawDist": Int(loc.distance(from: car))
      ])
    }
    // COMMIT — sustained above the (distance-weighted) commit curve → "vacating now" + ETA.
    // R5.3: suppressed when the user tapped No on the confirm notification — they told us it's a false alarm.
    if !returnSuppressed && P > VisitMonitorModule.commitThreshold(dist) {
      if returnCommitSince == 0 { returnCommitSince = Date().timeIntervalSince1970 }
      if Date().timeIntervalSince1970 - returnCommitSince >= VisitMonitorModule.returnCommitHoldSec {
        returnCommitFired = true
        returningNotified = true
        returnConfirmPending = false // COMMIT auto-publishes now — the SOFT prompt (if any) is moot
        let eta = VisitMonitorModule.etaSeconds(dist, loc.speed)
        postLocalNotification(title: "🟢 Spot vacating now", body: eta != nil ? "Arriving in ~\(eta!)s." : "You're heading back to the car.")
        logNativeFix(loc, tag: "return-commit", force: true)
        recomputeState()
        // R5.3: if user already said Yes (soft→soon_free already sent), just update to committed.
        // If user ignored the SOFT prompt (no action taken), catch up: soon_free first so the spot broadcasts,
        // then committed immediately after so seekers see the full progression.
        if !returnSoftFired { updateServerStatus("soon_free") }
        updateServerStatus("committed") // seekers see "vacating now"
        return
      }
    } else if returnSuppressed {
      returnCommitSince = 0
    } else {
      returnCommitSince = 0 // dropped below the commit curve → restart the hold
    }
    // SOFT — SUSTAINED above the soft curve → "freeing soon" (once). The hold (like COMMIT) filters
    // brief confidence spikes so a momentary alignment while wandering doesn't fire it (2026-07-14: soft
    // was noisy, firing on 0.4–0.5 bounces). COMMIT is the confirmed one; SOFT is the earlier heads-up.
    if P > VisitMonitorModule.softThreshold(dist) {
      if returnSoftSince == 0 { returnSoftSince = Date().timeIntervalSince1970 }
      if !returnSoftFired && Date().timeIntervalSince1970 - returnSoftSince >= VisitMonitorModule.returnSoftHoldSec {
        returnSoftFired = true
        returningNotified = true
        returnConfirmPending = true // JS shows the in-app fallback popup if the banner is missed
        returnConfirmPendingDist = Int(dist)
        postReturnConfirmNotification(dist: Int(dist)) // R5.3: ask Yes/No before going public
        logNativeFix(loc, tag: "return-soft", force: true)
        recomputeState()
        // updateServerStatus("soon_free") is DEFERRED to Yes response (or auto-publish on COMMIT if user ignores)
      }
    } else {
      returnSoftSince = 0 // dropped below the soft curve → restart the hold
    }
  }

  // R7: the full-HMM path (toggle-gated, see useFullHMM) — one unified call per fix, mirroring JS's
  // single processLocationHMM/handleLocationUpdate rather than the R1-R6 path's separate
  // detectPark/detectReturn dispatch. Reuses the SAME side-effect functions the R1-R6 path uses
  // (declarePark, rearmParkDetection, postLocalNotification, updateServerStatus,
  // postReturnConfirmNotification) — only the decision of WHEN to call them differs.
  private func processFullHMM(_ loc: CLLocation) async {
    await stepRateProvider.refreshCurrentStepRate()

    let parkedCoord = carLocation?.coordinate
    let supplemental = HMMSupplemental(
      stepRate: stepRateProvider.gatedStepRate(),
      accelerationMagnitude: nil, // Phase C: pending the accel-spike field-test result
      motionActivity: currentActivityDetail,
      bluetoothConnected: carBtConnected,
      spectralFeatures: nil,
      accuracy: loc.horizontalAccuracy > 0 ? loc.horizontalAccuracy : 10
    )
    let result = hmmEngine.process(location: loc, parkedLocation: parkedCoord, supplemental: supplemental)

    // R7: track the best-accuracy STOPPED fix while hunting for a park — a service-layer concern in
    // JS too (parkDetectionService.js's stoppedCandidateLocation lives outside parkDetection_HMM.js),
    // so it lives here rather than inside ParkDetectionHMMEngine. Same gate as detectPark's candidate
    // preference (speed<5km/h, accuracy<25m and better than the current candidate) — PLUS, as of the
    // 2026-07-26 field-test fix, the same "moved off the candidate → reset" behavior detectPark has
    // (:707-710). Without that reset, a momentary STOPPED reading at a red light or stop sign — if it
    // happened to have better accuracy than the real final parking spot — would stay "best" for the
    // rest of the drive and get used as the anchor, hundreds of metres from where the car actually
    // ended up (exactly what happened in that field test: dist sat at ~570m the whole watch because
    // hmmStopCandidate had locked onto an early, wrong-location stop).
    if carLocation == nil {
      if result.state == .stopped {
        if let cand = hmmStopCandidate, loc.distance(from: cand) > VisitMonitorModule.parkStopRadiusM {
          hmmStopCandidate = loc // moved off the old candidate — it was a different stop, start over
        } else {
          let isStoppedSpeed = loc.speed * 3.6 < 5
          let candAccuracy = hmmStopCandidate?.horizontalAccuracy ?? .greatestFiniteMagnitude
          if hmmStopCandidate == nil {
            hmmStopCandidate = loc // seed a candidate even before any accuracy bar is cleared
          } else if isStoppedSpeed, loc.horizontalAccuracy > 0, loc.horizontalAccuracy < candAccuracy,
                    loc.horizontalAccuracy < VisitMonitorModule.parkAnchorGoodAccuracyM {
            hmmStopCandidate = loc
          }
        }
      }
      if result.parkedEvent {
        let anchor = hmmStopCandidate ?? loc
        hmmStopCandidate = nil
        declarePark(at: anchor, source: "hmm")
      }
      return
    }

    if result.clearParkingEvent {
      rearmParkDetection()
      hmmSoftFired = false; hmmCommitFired = false; hmmSoftSince = 0; hmmCommitSince = 0
      return
    }

    refineParkAnchorIfNeeded(loc)

    // ML prediction + fusion (Phases D + A), then the shared returnBoundary curves/hold-times.
    let aiFeatures = ParkReturnPredictor.Features(
      speed: result.filteredSpeed, stepRate: supplemental.stepRate,
      accel: supplemental.accelerationMagnitude ?? 1.5,
      pgr: result.pgr, pgrSlope: result.slope, approachAlignment: result.approachAlignment,
      deltaRate: result.deltaRate
    )
    let aiConf = returnPredictor.predict(aiFeatures)
    let P = hmmFusion.update(
      hmmBelief: result.belief[.returning] ?? 0, aiConfidence: aiConf,
      approachAlignment: result.approachAlignment, isAway: result.isAway,
      hasParkedLocation: true, distToParked: result.distToParked
    )

    let dist = result.distToParked
    let soft = VisitMonitorModule.softThreshold(dist), commit = VisitMonitorModule.commitThreshold(dist)
    let now = Date().timeIntervalSince1970
    if now - lastHmmLogAt > VisitMonitorModule.returnLogThrottleSec {
      lastHmmLogAt = now
      let zone = P > commit ? "COMMIT" : (P > soft ? "SOFT" : "WAIT")
      // R7 field-test fix (2026-07-26): the R6 return-traj log had acc/gpsW and this didn't — that
      // gap slowed down diagnosing the 2026-07-26 field-test bugs. gpsWeight here is recomputed
      // locally with the same formula the engine uses internally (parkDetection_HMM.js:352-353) —
      // display-only, not read back from inside ParkDetectionHMMEngine.
      let accuracy = supplemental.accuracy
      let gpsWeight = accuracy > 20 ? max(0.2, 20 / accuracy) : 1.0
      logNativeFix(loc, tag: "hmm-traj", force: true, extra: [
        "dist": Int(dist), "conf": (P * 100).rounded() / 100,
        "soft": (soft * 100).rounded() / 100, "commit": (commit * 100).rounded() / 100, "zone": zone,
        "state": result.state.rawValue, "aiConf": (aiConf * 100).rounded() / 100,
        "pgr": (result.pgr * 100).rounded() / 100, "pgrCons": (result.pgrConsistency * 100).rounded() / 100,
        "acc": Int(accuracy), "gpsW": (gpsWeight * 100).rounded() / 100
      ])
    }

    // COMMIT — sustained above the commit curve → "vacating now" + ETA. Re-arm semantics match JS
    // exactly (parkDetectionService.js:744-748): the fired-flag resets the moment the zone drops
    // OUT of COMMIT, not via a leave-margin distance hysteresis like the R1-R6 path uses.
    if !returnSuppressed, P > commit {
      if hmmCommitSince == 0 { hmmCommitSince = now }
      if !hmmCommitFired, now - hmmCommitSince >= VisitMonitorModule.returnCommitHoldSec {
        hmmCommitFired = true
        returningNotified = true
        returnConfirmPending = false
        let eta = VisitMonitorModule.etaSeconds(dist, loc.speed)
        postLocalNotification(title: "🟢 Spot vacating now", body: eta != nil ? "Arriving in ~\(eta!)s." : "You're heading back to the car.")
        logNativeFix(loc, tag: "hmm-commit", force: true)
        recomputeState()
        if !hmmSoftFired { updateServerStatus("soon_free") } // catch up if the SOFT prompt was never answered
        updateServerStatus("committed")
        return
      }
    } else {
      hmmCommitSince = 0
      hmmCommitFired = false
    }

    // SOFT — sustained above the soft curve → confirmation prompt before broadcasting (R5.3's
    // Yes/No gate applies here too — a native-specific UX safeguard kept for both paths, same
    // reasoning as keeping the R1-R6 hold-times: it fixed a real native-observed false-broadcast
    // issue that predates this engine).
    if P > soft {
      if hmmSoftSince == 0 { hmmSoftSince = now }
      if !hmmSoftFired, now - hmmSoftSince >= VisitMonitorModule.returnSoftHoldSec {
        hmmSoftFired = true
        returningNotified = true
        returnConfirmPending = true
        returnConfirmPendingDist = Int(dist)
        postReturnConfirmNotification(dist: Int(dist))
        logNativeFix(loc, tag: "hmm-soft", force: true)
        recomputeState()
      }
    } else {
      hmmSoftSince = 0
      hmmSoftFired = false
    }
  }

  // R6: local flat-earth projection around `origin`, in meters (equirectangular; same convention the
  // old approachAlignment used, and mirrors JS latLonToMeters, parkDetection_HMM.js:180-186). Using the
  // car as origin means the filtered position IS the car-relative (x,y) — no extra lat/lon round-trip.
  private static func metersFromOrigin(_ loc: CLLocation, origin: CLLocation) -> [Double] {
    let latRad = origin.coordinate.latitude * .pi / 180
    let dLat = (loc.coordinate.latitude - origin.coordinate.latitude) * .pi / 180
    let dLon = (loc.coordinate.longitude - origin.coordinate.longitude) * .pi / 180
    return [earthRadiusM * dLon * cos(latRad), earthRadiusM * dLat]
  }
  private static let earthRadiusM = 6371000.0

  // Movement-vs-car-direction cosine ∈ [-1,1], operating on FILTERED positions in the car-as-origin
  // meters frame (so the car itself is always (0,0)) — mirrors the JS HMM approachAlignment, but on
  // Kalman-filtered rather than raw points so GPS noise can't fake an aligned movement.
  private static func approachAlignmentMeters(prev: [Double], cur: [Double]) -> Double {
    let vx = cur[0] - prev[0], vy = cur[1] - prev[1] // movement vector
    let dx = -cur[0], dy = -cur[1]                   // direction to car (origin) from cur
    let magV = (vx * vx + vy * vy).squareRoot()
    let magD = (dx * dx + dy * dy).squareRoot()
    if magV == 0 || magD == 0 { return 0 }
    return (vx * dx + vy * dy) / (magV * magD)
  }

  // R6: net distance gained toward the car ÷ total path walked over the rolling window — PGR-lite port
  // of calculatePGR (parkDetection_HMM.js:222-234; consistency/slope intentionally omitted, see plan).
  private static func calculatePGR(_ history: [(x: Double, y: Double, dist: Double)]) -> Double {
    guard history.count >= returnProgressMinSamples, let start = history.first, let end = history.last else { return 0 }
    let netGain = start.dist - end.dist
    var totalPath = 0.0
    for i in 1..<history.count {
      let dx = history[i].x - history[i - 1].x
      let dy = history[i].y - history[i - 1].y
      totalPath += (dx * dx + dy * dy).squareRoot()
    }
    return totalPath < 1.0 ? 0 : netGain / totalPath
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
    self.startAccelSpike() // R7 Phase C spike: is raw accelerometer sampling alive in the background?
  }
}

// R6 ── 2D constant-velocity Kalman filter in local meters, port of parkDetection_HMM.js's Kalman2D
// (:106-146). Measurement noise scales with accuracy² (floored at 25), so a low-accuracy indoor fix
// barely moves the filtered position — the defense the JS foreground HMM uses against GPS spikes that
// VisitMonitorModule's return-detector previously had none of (raw fixes were trusted equally always).
private struct ReturnPositionFilter {
  private var x = [0.0, 0.0, 0.0, 0.0] // [px, py, vx, vy]
  private var P: [[Double]] = ReturnPositionFilter.diag(1000)
  private var lastTime: TimeInterval?

  private static func diag(_ v: Double) -> [[Double]] {
    (0..<4).map { i in (0..<4).map { j in i == j ? v : 0 } }
  }

  mutating func reset() {
    x = [0, 0, 0, 0]
    P = ReturnPositionFilter.diag(1000)
    lastTime = nil
  }

  // z = [x, y] meters; returns the filtered [x, y]. First call seeds the state directly (no prior to
  // predict from), exactly like the JS version's `if (!this.lastTime)` branch.
  mutating func update(_ z: [Double], at time: TimeInterval, accuracy: Double) -> [Double] {
    guard let last = lastTime else {
      lastTime = time
      x[0] = z[0]; x[1] = z[1]
      return [x[0], x[1]]
    }
    let dt = max(0.001, time - last)
    lastTime = time
    let qv = 0.1, rVal = max(25.0, accuracy * accuracy)

    // Predict: x = F x, P = F P Fᵀ + Q, with F = [[1,0,dt,0],[0,1,0,dt],[0,0,1,0],[0,0,0,1]] (constant
    // velocity) and Q = diag(0.1). Expanded by hand (rather than generic NxM helpers, unlike the JS
    // original) since F/H have a fixed, known structure here.
    x = [x[0] + dt * x[2], x[1] + dt * x[3], x[2], x[3]]
    var fp = [[Double]](repeating: [Double](repeating: 0, count: 4), count: 4)
    for i in 0..<4 {
      for j in 0..<4 {
        fp[i][j] = P[i][j] + (i == 0 ? dt * P[2][j] : 0) + (i == 1 ? dt * P[3][j] : 0)
      }
    }
    for i in 0..<4 {
      for j in 0..<4 {
        P[i][j] = fp[i][j] + (j == 0 ? dt * fp[i][2] : 0) + (j == 1 ? dt * fp[i][3] : 0) + (i == j ? qv : 0)
      }
    }

    // Update against z = [x, y] (H picks the position rows/cols out of the 4-state vector).
    let yx = z[0] - x[0], yy = z[1] - x[1]
    let s00 = P[0][0] + rVal, s01 = P[0][1], s10 = P[1][0], s11 = P[1][1] + rVal
    let det = s00 * s11 - s01 * s10
    guard abs(det) > 1e-6 else { return [x[0], x[1]] }
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
    return [x[0], x[1]]
  }
}

// R5.3 ── Forwarding proxy for UNUserNotificationCenterDelegate. ──────────────────────────────────
// Wraps whatever delegate expo-notifications installed, intercepts PARKSPHERE_RETURN_CONFIRM action
// responses, and forwards everything else unchanged. Installed once on the first SOFT fire (by then
// expo-notifications has certainly set its own delegate). The module holds a strong ref so it lives.
final class ReturnNotifProxy: NSObject, UNUserNotificationCenterDelegate {
  private weak var wrapped: UNUserNotificationCenterDelegate?
  private weak var module: VisitMonitorModule?

  init(wrapped: UNUserNotificationCenterDelegate?, module: VisitMonitorModule) {
    self.wrapped = wrapped; self.module = module
  }

  // Called when the user taps a button (action) on a notification — iOS wakes the app in background
  // just for this. We intercept our category; everything else forwards to expo-notifications.
  func userNotificationCenter(_ center: UNUserNotificationCenter,
                               didReceive response: UNNotificationResponse,
                               withCompletionHandler completionHandler: @escaping () -> Void) {
    if response.notification.request.content.categoryIdentifier == VisitMonitorModule.notifCategoryReturn {
      module?.handleReturnConfirmAction(response.actionIdentifier)
      completionHandler()
    } else {
      wrapped?.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
        ?? completionHandler()
    }
  }

  // Called when a notification is about to be presented while the app is foregrounded. Forward to
  // expo-notifications so its own banner/sound logic is unchanged.
  func userNotificationCenter(_ center: UNUserNotificationCenter,
                               willPresent notification: UNNotification,
                               withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    wrapped?.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
      ?? completionHandler([.banner, .sound])
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

// R5.1 (2026-07-15): native backend client so the app can talk to the Parksphere server from the
// BACKGROUND, where the RN JS thread is suspended and its fetch()/AsyncStorage are unavailable. JS hands
// over the config (base URL + Bearer token + car type) via configureBackend; it's persisted in
// UserDefaults so native still has it after a background relaunch. userId is derived server-side from the
// JWT, so it isn't needed here. Uses URLSession.shared (native is alive during detection); a background
// URLSession is a later robustness upgrade for the fire-then-resuspend case.
final class BackendClient {
  private var baseUrl: String { UserDefaults.standard.string(forKey: "psBackendUrl") ?? "" }
  private var token: String { UserDefaults.standard.string(forKey: "psBackendToken") ?? "" }
  private var carType: String { UserDefaults.standard.string(forKey: "psBackendCarType") ?? "sedan" }

  func configure(url: String, token: String, carType: String) {
    let d = UserDefaults.standard
    d.set(url, forKey: "psBackendUrl")
    d.set(token, forKey: "psBackendToken")
    d.set(carType, forKey: "psBackendCarType")
  }

  private func send(_ path: String, method: String, body: [String: Any]?) async -> (Int, [String: Any]?) {
    guard !baseUrl.isEmpty, !token.isEmpty, let url = URL(string: baseUrl + path) else { return (0, nil) }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.timeoutInterval = 15
    if let body = body {
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    }
    do {
      let (data, resp) = try await URLSession.shared.data(for: req)
      let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
      let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      return (code, json)
    } catch { return (0, nil) }
  }

  // POST /api/declare-spot → (spotId, httpCode). spotId>0 on success, -1 on failure. The httpCode is
  // exposed (R7 field-test diagnosability, alongside the useFullHMM rollout) so a 0 (network/DNS —
  // e.g. the .local hostname didn't resolve) can be told apart from a 401 (bad/demo token) or other
  // 4xx/5xx from the server itself.
  func declareSpot(lat: Double, lon: Double, timeToLeave: Int) async -> (id: Int, code: Int) {
    let body: [String: Any] = [
      "latitude": lat, "longitude": lon, "timeToLeave": timeToLeave,
      "costType": "free", "price": 0, "declaredCarType": carType,
      "comments": "Auto-detected (native)", "isAutoDetected": true
    ]
    let (code, json) = await send("/api/declare-spot", method: "POST", body: body)
    guard (200...299).contains(code) else { return (-1, code) }
    return ((json?["spotId"] as? Int) ?? -1, code)
  }

  // PUT /api/parkingspots/:id/status  (occupied|soon_free|committed|vacating|free)
  func updateStatus(spotId: Int, status: String) async -> (ok: Bool, code: Int) {
    let (code, _) = await send("/api/parkingspots/\(spotId)/status", method: "PUT", body: ["status": status])
    return ((200...299).contains(code), code)
  }

  // DELETE /api/parkingspots/:id
  func deleteSpot(spotId: Int) async -> (ok: Bool, code: Int) {
    let (code, _) = await send("/api/parkingspots/\(spotId)", method: "DELETE", body: nil)
    return ((200...299).contains(code), code)
  }

  // PUT /api/parkingspots/:id/location — R7: keeps the server spot in sync when the post-park
  // anchor-refinement window (declarePark/refineParkAnchorIfNeeded) replaces the anchor with a
  // better-accuracy fix. Port of updateSpotLocation, parkDetectionService.js:210-225.
  func updateLocation(spotId: Int, lat: Double, lon: Double) async -> (ok: Bool, code: Int) {
    let (code, _) = await send("/api/parkingspots/\(spotId)/location", method: "PUT", body: ["latitude": lat, "longitude": lon])
    return ((200...299).contains(code), code)
  }
}
