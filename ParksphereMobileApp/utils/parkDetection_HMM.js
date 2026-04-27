/**
 * Park Detection HMM (Context-aware + Hard Transition Blocking)
 */

// ==============================
// STATES
// ==============================
export const STATES = [
  'IDLE',
  'WALKING',
  'DRIVING',
  'STOPPED',
  'PARKED',
  'AWAY',
  'RETURNING',
  'IN_CAR'
];

// ==============================
// TRANSITIONS (base probabilities)
// ==============================

export const A = {
  IDLE: {
    IDLE: 0.75,
    WALKING: 0.20,
    DRIVING: 0.05
  },

  WALKING: {
    WALKING: 0.75,
    IDLE: 0.08,
    DRIVING: 0.08,
    AWAY: 0.09
  },

  DRIVING: {
    DRIVING: 0.9,
    STOPPED: 0.07,
    PARKED: 0.03
  },

  STOPPED: {
    STOPPED: 0.65,
    DRIVING: 0.22,
    PARKED: 0.13
  },

  PARKED: {
    PARKED: 0.85,
    WALKING: 0.15
  },

  AWAY: {
    AWAY: 0.9,
    RETURNING: 0.1
  },

  RETURNING: {
    RETURNING: 0.75,
    IN_CAR: 0.20,
    AWAY: 0.05
  },

  IN_CAR: {
    IN_CAR: 0.65,
    DRIVING: 0.35
  }
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
// KALMAN FILTER (speed)
// ==============================
class Kalman1D {
  constructor(q = 0.05, r = 2) {
    this.q = q;
    this.r = r;
    this.x = 0;
    this.p = 1;
  }

  update(z) {
    this.p += this.q;
    const k = this.p / (this.p + this.r);
    this.x = this.x + k * (z - this.x);
    this.p = (1 - k) * this.p;
    return this.x;
  }
}

const speedFilter = new Kalman1D(0.1, 2);


// ==============================
// 2D KALMAN FILTER (POSITION)
// ==============================
class Kalman2D {
  constructor() {
    this.x = [0, 0, 0, 0]; // [x, y, vx, vy]

    this.P = mathIdentity(4, 1000); // uncertainty
    this.Q = mathIdentity(4, 0.5);  // process noise (increased for responsiveness)
    this.R = mathIdentity(2, 15);   // measurement noise (increased for smoothness)

    this.lastTime = null;
  }

  update(z, dt) {
    if (!this.lastTime) {
      this.lastTime = Date.now();
      this.x[0] = z[0];
      this.x[1] = z[1];
      return [this.x[0], this.x[1]];
    }

    // State transition matrix
    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];

    // Measurement matrix
    const H = [
      [1, 0, 0, 0],
      [0, 1, 0, 0]
    ];

    // Predict
    this.x = matMul(F, this.x);
    this.P = matAdd(matMul(F, matMul(this.P, transpose(F))), this.Q);

    // Update
    const y = vecSub(z, matMul(H, this.x));
    const S = matAdd(matMul(H, matMul(this.P, transpose(H))), this.R);
    const K = matMul(this.P, matMul(transpose(H), inverse2x2(S)));

    this.x = vecAdd(this.x, matMul(K, y));
    this.P = matMul(matSub(identity(4), matMul(K, H)), this.P);

    return [this.x[0], this.x[1]];
  }
}


//===============================
// MINIMAL MATRIX HELPERS
//===============================

function identity(n) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );
}

function mathIdentity(n, val) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? val : 0))
  );
}

function matMul(A, B) {
  if (Array.isArray(B[0])) {
    return A.map(row =>
      B[0].map((_, j) =>
        row.reduce((sum, val, k) => sum + val * B[k][j], 0)
      )
    );
  } else {
    return A.map(row =>
      row.reduce((sum, val, i) => sum + val * B[i], 0)
    );
  }
}

function transpose(A) {
  return A[0].map((_, i) => A.map(row => row[i]));
}

function matAdd(A, B) {
  return A.map((row, i) =>
    row.map((val, j) => val + B[i][j])
  );
}

function matSub(A, B) {
  return A.map((row, i) =>
    row.map((val, j) => val - B[i][j])
  );
}

function vecAdd(a, b) {
  return a.map((v, i) => v + b[i]);
}

function vecSub(a, b) {
  return a.map((v, i) => v - b[i]);
}

function inverse2x2(M) {
  const det = M[0][0]*M[1][1] - M[0][1]*M[1][0];
  if (Math.abs(det) < 1e-6) return identity(2);
  return [
    [ M[1][1]/det, -M[0][1]/det ],
    [ -M[1][0]/det, M[0][0]/det ]
  ];
}


//===============================
// LAT/LON -> METERS CONVERSION
//===============================

const R = 6371000;

function latLonToMeters(lat, lon) {
  const x = R * lon * Math.PI / 180;
  const y = R * lat * Math.PI / 180;
  return [x, y];
}

function metersToLatLon(x, y) {
  const lat = y / R * 180 / Math.PI;
  const lon = x / R * 180 / Math.PI;
  return { latitude: lat, longitude: lon };
}

// INSTATIATE KALMAN 2D FILTER
const positionFilter = new Kalman2D();
let lastTimestamp = null;


// ==============================
// HARD TRANSITION RULES
// ==============================
function isTransitionAllowed(from, to, context) {
  const { hasParkedLocation } = context;

  // 🚫 BLOCK TELEPORTATION TO PARKED
  // You cannot arrive at PARKED unless you were just DRIVING or STOPPED
  if (to === 'PARKED' && from !== 'PARKED' && !['DRIVING', 'STOPPED'].includes(from)) {
    return false;
  }

  // 🚫 Cannot go to RETURNING without parked location
  if (to === 'RETURNING' && !hasParkedLocation) return false;

  // 🚫 Cannot go to IN_CAR without parked location
  if (to === 'IN_CAR' && !hasParkedLocation) return false;

  // 🚫 Cannot jump directly WALKING → IN_CAR
  if (from === 'WALKING' && to === 'IN_CAR') return false;

  // 🚫 Cannot jump WALKING → RETURNING without context
  if (from === 'WALKING' && to === 'RETURNING') return false;

  // AWAY only valid if parked location exists
  if (to === 'AWAY' && !hasParkedLocation) return false;

  return true;
}

// ==============================
// GAUSSIAN
// ==============================
function logGaussian(x, mean, std) {
  const s = Math.max(std, 0.3);
  return -((x - mean) ** 2) / (2 * s * s);
}

// ==============================
// EMISSION MODEL
// ==============================
function emissionLogProb(state, obs) {
  const { speed, stepRate, accel, dist, deltaRate } = obs;

  let logp = 0;

  const isStationaryState = ['IDLE', 'STOPPED', 'PARKED', 'IN_CAR'].includes(state);
  const isWalkingState = ['WALKING', 'AWAY', 'RETURNING'].includes(state);

  // SPEED
  if (state === 'DRIVING') {
    // Use a wider Gaussian to allow for slow city driving/parking search
    logp += logGaussian(speed, 40, 20); 
  } else if (isWalkingState) {
    logp += logGaussian(speed, 4.5, 2);
  } else {
    logp += logGaussian(speed, 0, 1.5);
  }

  // STEP RATE (discriminative)
  const hasSteps = stepRate > 0.5;
  if (hasSteps) {
    logp += isWalkingState ? Math.log(0.9) : Math.log(0.01); // Penalty for driving/stopped with steps
  } else {
    logp += (isStationaryState || state === 'DRIVING') ? Math.log(0.9) : Math.log(0.1);
  }

  // ACCELERATION
  logp += logGaussian(accel, 1.0, 0.6);

  // DISTANCE relevance
  if (state === 'PARKED') {
    logp += logGaussian(dist, 0, 20);
  }

  // DIRECTION
  if (state === 'RETURNING') {
    logp += logGaussian(deltaRate, -0.5, 1.5);
  }

  if (state === 'AWAY') {
    logp += logGaussian(deltaRate, 0.5, 1.5);
  }

  return logp;
}

// ==============================
// FORWARD FILTER
// ==============================
function updateBelief(prevBelief, obs, context) {
  const newBelief = {};
  let sum = 0;

  for (const s of STATES) {
    let transitionSum = 0;

    for (const sp of STATES) {
      if (!isTransitionAllowed(sp, s, context)) continue;

      const p = prevBelief[sp] || 0;
      const a = A[sp]?.[s] || 0;

      transitionSum += p * a;
    }

    if (transitionSum === 0) {
      newBelief[s] = 0;
      continue;
    }

    const emission = emissionLogProb(s, obs);
    const value = Math.exp(Math.log(transitionSum) + emission);

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
// MAIN FUNCTION
// ==============================

export function processLocationHMM(location, parkedLocation, supplemental = {}) {
  // ==============================
  // TIME DELTA
  // ==============================
  const now = Date.now();
  const dt = lastTimestamp ? (now - lastTimestamp) / 1000 : 1;
  lastTimestamp = now;

  // ==============================
  // RAW GPS → METERS
  // ==============================
  const rawLat = location.coords.latitude;
  const rawLon = location.coords.longitude;

  const [mx, my] = latLonToMeters(rawLat, rawLon);

  // ==============================
  // 2D KALMAN FILTER (POSITION)
  // ==============================
  const [fx, fy] = positionFilter.update([mx, my], dt);

  const filteredCoords = metersToLatLon(fx, fy);

  // ==============================
  // SPEED (1D KALMAN)
  // ==============================
  const rawSpeed = Math.max(0, (location.coords.speed || 0) * 3.6);
  const speed = speedFilter.update(rawSpeed);

  // ==============================
  // DISTANCE TO PARKED CAR
  // ==============================
  let dist = 0;

  if (parkedLocation) {
    dist = getDistance(filteredCoords, parkedLocation);
  }

  // ==============================
  // DELTA DISTANCE (STABLE)
  // ==============================
  let deltaRate = 0;

  if (supplemental.lastDistanceToCar !== undefined && dt > 0) {
    const delta = dist - supplemental.lastDistanceToCar;

    // clamp extreme GPS jumps (important!)
    const clampedDelta = Math.max(-10, Math.min(10, delta));

    deltaRate = clampedDelta / dt;
  }

  // ==============================
  // OBSERVATION VECTOR
  // ==============================
  const obs = {
    speed,
    stepRate: supplemental.step_rate || 0,
    accel: supplemental.acceleration_magnitude || 1,
    dist,
    deltaRate
  };

  // ==============================
  // CONTEXT (for hard constraints)
  // ==============================
  const context = {
    hasParkedLocation: !!parkedLocation
  };

  // ==============================
  // HMM UPDATE
  // ==============================
  belief = updateBelief(belief, obs, context);

  // ==============================
  // SELECT BEST STATE (with hysteresis)
  // ==============================
  const sorted = Object.entries(belief).sort((a, b) => b[1] - a[1]);
  const candidate = sorted[0][0];
  const candidateConf = sorted[0][1];
  const currentConf = belief[currentState] || 0;

  // Only switch if the candidate is 10% more confident than the current state
  if (candidate !== currentState && candidateConf > (currentConf + 0.10)) {
    currentState = candidate;
  }

  const bestState = currentState;

  // ==============================
  // RETURN RESULT
  // ==============================
  return {
    state: bestState,
    bestState,
    confidence: belief[bestState],
    secondBestState: sorted[0][0] === bestState ? sorted[1]?.[0] : sorted[0][0],
    secondConfidence: sorted[0][0] === bestState ? sorted[1]?.[1] : sorted[0][1],
    belief,
    distToParked: dist,
    deltaRate,
    filteredSpeed: speed,
    filteredCoords
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
  for (const s of STATES) belief[s] = s === 'IDLE' ? 1 : 0;
  currentState = 'IDLE';
  speedFilter.x = 0;
  speedFilter.p = 1;
}

export function getHMMStatus() {
  return { currentState, belief };
}

// Expo-safe
export function initMotionTracking() {
  console.log('[HMM] Motion tracking disabled');
}
