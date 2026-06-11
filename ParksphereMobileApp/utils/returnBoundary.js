// ==============================================================================
// 2D DECISION BOUNDARY for "returning to car" alerts
// ==============================================================================
// Distance and return-probability are BOTH evidence. A fixed probability
// threshold treats "85% @ 180m" (could easily reverse) the same as "85% @ 12m"
// (almost certain). Instead we use two downward-sloping threshold curves over
// the (distance x probability) plane:
//
//   COMMIT zone  (P above commit curve, sustained) -> alert network "vacating now"
//   SOFT zone    (P above soft curve)              -> cheap "soon free" heads-up
//   WAIT zone    (P below soft curve)              -> do not alert
//
// Far from the car you need very high confidence; close to the car a modest
// confidence is enough, because almost nobody turns back from 10m. A detour
// needs no special logic: confidence drops below the curve, and the user simply
// re-earns their way across it.
// ==============================================================================

// Max range (m) at which we START computing/alerting. Note this is NOT where
// alerts fire — the soft curve sits at 0.72 out here, so far-away alerts only
// happen when confidence is genuinely very high.
export const ALERT_MAX_RANGE = 200;

// How long (ms) confidence must stay above the commit curve before we fire the
// commit alert. Filters a brief spike-and-retreat. ~3-4 GPS updates.
export const COMMIT_HOLD_MS = 25000;

// Minimum speed (m/s) required to produce an ETA. Below this the owner is effectively
// still (stopped, distracted, waiting to cross) so time-to-arrival is unknown — we return
// null, which the UI shows as "N/A" rather than a divide-by-~0 blow-up. 0.5 m/s ≈ 1.8 km/h,
// below a slow walk.
export const ETA_MIN_SPEED = 0.5;

// Commit curve: P_required from 0.55 (at the car) up to 0.90 (at 200m).
export function commitThreshold(dist) {
  const d = Math.min(Math.max(dist, 0), ALERT_MAX_RANGE);
  return 0.55 + 0.35 * (d / ALERT_MAX_RANGE);
}

// Soft-alert curve: runs ~0.15 below the commit curve (0.40 at the car, 0.72 at 200m).
export function softThreshold(dist) {
  const d = Math.min(Math.max(dist, 0), ALERT_MAX_RANGE);
  return 0.40 + 0.32 * (d / ALERT_MAX_RANGE);
}

// Classify a (probability, distance) point into a zone.
export function returnZone(P, dist) {
  if (P > commitThreshold(dist)) return 'COMMIT';
  if (P > softThreshold(dist)) return 'SOFT';
  return 'WAIT';
}

// Estimated seconds until the owner reaches the car (and the spot frees), from the
// remaining distance and the owner's current speed (m/s). Returns null when too slow/still
// to estimate — there's no meaningful ETA for someone who isn't moving toward the car.
export function etaSeconds(dist, speed) {
  if (!speed || speed < ETA_MIN_SPEED) return null;
  return Math.round(Math.max(dist, 0) / speed);
}

// Format an ETA (seconds, or null/undefined) as "M:SS", or "N/A" when unknown.
export function formatEta(seconds) {
  if (seconds == null || !isFinite(seconds)) return 'N/A';
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
