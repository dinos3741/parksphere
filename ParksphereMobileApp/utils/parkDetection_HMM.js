/**
 * Park Detection HMM (Expo-compatible + Probabilistic Filtering)
 * - Uses forward algorithm (NOT Viterbi)
 * - Stable real-time inference
 * - Fully based on Expo sensors
 */

// ==============================
// STATES
// ==============================
export const STATES = [
  'IDLE',
  'WALKING',
  'DRIVING',
  'PARKED',
  'AWAY',
  'RETURNING',
  'IN_CAR'
];

// ==============================
// TRANSITION MATRIX (sticky but responsive)
// ==============================
export const A = {
  IDLE:      { IDLE: 0.90, WALKING: 0.10 },

  WALKING:   { WALKING: 0.88, AWAY: 0.06, RETURNING: 0.04, IDLE: 0.02 },

  DRIVING:   { DRIVING: 0.93, PARKED: 0.07 },

  PARKED:    { PARKED: 0.92, WALKING: 0.08 },

  AWAY:      { AWAY: 0.92, RETURNING: 0.08 },

  RETURNING: { RETURNING: 0.93, IN_CAR: 0.05, AWAY: 0.02 },

  IN_CAR:    { IN_CAR: 0.85, DRIVING: 0.15 }
};

// ==============================
// GLOBAL STATE
// ==============================
let belief = {};
let currentState = 'IDLE';

for (const s of STATES) {
  belief[s] = s === 'IDLE' ? 1 : 0;
}

// ==============================
// DELTA SMOOTHING
// ==============================
let deltaHistory = [];
const MAX_DELTA = 5;

function smoothDelta(delta, dt) {
  if (!isFinite(delta)) return 0;

  deltaHistory.push(delta);
  if (deltaHistory.length > MAX_DELTA) deltaHistory.shift();

  const avg = deltaHistory.reduce((a, b) => a + b, 0) / deltaHistory.length;
  return dt > 0 ? avg / dt : 0;
}

// ==============================
// GAUSSIAN LOG LIKELIHOOD
// ==============================
function logGaussian(x, mean, std) {
  const s = Math.max(std, 0.2);
  return -((x - mean) ** 2) / (2 * s * s) - Math.log(Math.sqrt(2 * Math.PI) * s);
}

// ==============================
// EMISSION MODEL (EXPO TUNED)
// ==============================
export function emissionLogProb(state, obs) {
  const { speed, accel, stepRate, dist, deltaRate } = obs;

  let logp = 0;

  // SPEED
  if (state === 'DRIVING') {
    logp += logGaussian(speed, 40, 25);
  } else if (['WALKING', 'AWAY', 'RETURNING'].includes(state)) {
    logp += logGaussian(speed, 4.5, 2.5);
  } else {
    logp += logGaussian(speed, 0, 2.5);
  }

  // STEP RATE (VERY IMPORTANT SIGNAL)
  if (stepRate > 0.3) {
    if (['WALKING', 'AWAY', 'RETURNING'].includes(state)) {
      logp += Math.log(0.95);
    } else {
      logp += Math.log(0.01);
    }
  } else {
    if (['IDLE', 'PARKED', 'DRIVING', 'IN_CAR'].includes(state)) {
      logp += Math.log(0.9);
    } else {
      logp += Math.log(0.2);
    }
  }

  // ACCELERATION (weak signal)
  logp += logGaussian(accel, 1.0, 0.6);

  // DISTANCE
  if (state === 'PARKED' || state === 'IN_CAR') {
    logp += logGaussian(dist, 0, 20);
  }

  if (state === 'AWAY') {
    logp += logGaussian(dist, 80, 80);
  }

  // DIRECTION SIGNAL (key for RETURNING/AWAY)
  if (state === 'RETURNING') {
    logp += logGaussian(deltaRate, -0.5, 1.5);
  }

  if (state === 'AWAY') {
    logp += logGaussian(deltaRate, 0.5, 1.5);
  }

  return logp;
}

// ==============================
// FORWARD ALGORITHM (FILTERING)
// ==============================
export function updateBelief(prevBelief, obs) {
  const newBelief = {};
  let sum = 0;

  for (const s of STATES) {
    let emission = emissionLogProb(s, obs);

    let transitionSum = 0;
    for (const sp of STATES) {
      const p = prevBelief[sp] || 0;
      transitionSum += p * (A[sp]?.[s] || 0);
    }

    const value = Math.exp(Math.log(transitionSum + 1e-12) + emission);

    newBelief[s] = value;
    sum += value;
  }

  // normalize
  for (const s of STATES) {
    newBelief[s] /= sum || 1;
  }

  return newBelief;
}

// ==============================
// MAIN ENTRY
// ==============================
export function processLocationHMM(location, parkedLocation, supplemental = {}) {
  const speed = Math.max(0, (location.coords.speed || 0) * 3.6);

  const dist = getDistance(location.coords, parkedLocation);

  const dt = supplemental.deltaTime || 5;

  const rawDelta =
    supplemental.lastDistanceToCar != null
      ? dist - supplemental.lastDistanceToCar
      : 0;

  const deltaRate = smoothDelta(rawDelta, dt);

  const obs = {
    speed,
    accel: supplemental.acceleration_magnitude || 1,
    stepRate: supplemental.step_rate || 0,
    dist,
    deltaRate
  };

  // forward update
  belief = updateBelief(belief, obs);

  // argmax state
  let bestState = STATES[0];
  let bestVal = -1;

  for (const s of STATES) {
    if (belief[s] > bestVal) {
      bestVal = belief[s];
      bestState = s;
    }
  }

  currentState = bestState;

  // second best
  const sorted = Object.entries(belief).sort((a, b) => b[1] - a[1]);

  return {
    state: bestState,
    bestState,
    confidence: sorted[0][1],
    secondBestState: sorted[1]?.[0],
    secondConfidence: sorted[1]?.[1],
    belief,
    distToParked: dist
  };
}

// ==============================
// DISTANCE
// ==============================
function getDistance(a, b) {
  if (!a || !b) return 0;

  const R = 6371e3;
  const φ1 = a.latitude * Math.PI / 180;
  const φ2 = b.latitude * Math.PI / 180;
  const Δφ = (b.latitude - a.latitude) * Math.PI / 180;
  const Δλ = (b.longitude - a.longitude) * Math.PI / 180;

  const x =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

// ==============================
// HELPERS
// ==============================
export function resetHMM() {
  belief = {};
  for (const s of STATES) belief[s] = s === 'IDLE' ? 1 : 0;
  currentState = 'IDLE';
  deltaHistory = [];
}

export function getHMMStatus() {
  return { currentState, belief };
}

// compatibility (no-op in Expo mode)
export function initMotionTracking() {
  console.log('[HMM] Motion tracking disabled (Expo mode)');
}
