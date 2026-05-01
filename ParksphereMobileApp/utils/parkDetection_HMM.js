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
  'AWAY',
  'RETURNING',
  'IN_CAR'
];

// ==============================
// TRANSITIONS (base probabilities)
// ==============================

export const A = {

  IDLE: {
    IDLE: 0.6,      // 📉 reduced stickiness
    WALKING: 0.35,  // 📈 easier to start walking
    DRIVING: 0.05
  },

  WALKING: {
    WALKING: 0.5,
    IDLE: 0.15,
    DRIVING: 0.1,   // ✅ direct walk → car → drive (first use case)
    AWAY: 0.15,     // 🚀 new: can start walking away from car immediately
    RETURNING: 0.1  // 🚀 new: can start walking back to car immediately
  },

  DRIVING: {
    DRIVING: 0.75,
    STOPPED: 0.2,
    WALKING: 0.05   // e.g. very short trips / GPS glitches
  },

  STOPPED: {
    STOPPED: 0.55,
    DRIVING: 0.25,
    WALKING: 0.2   // ✅ critical: user exits car
  },

  AWAY: {
    AWAY: 0.7,
    RETURNING: 0.2,
    IDLE: 0.1       // ✅ Allow stopping while away
  },

  RETURNING: {
    RETURNING: 0.6,
    IN_CAR: 0.3,
    IDLE: 0.1       // ✅ Allow stopping while returning
  },

  IN_CAR: {
    IN_CAR: 0.6,
    DRIVING: 0.4
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
    this.Q = mathIdentity(4, 0.1);  // Reduced process noise (Q): less aggressive, more stable
    this.R = mathIdentity(2, 25);   // Increased measurement noise (R): more weight on filter than new noisy data

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
// LAT/LON -> METERS CONVERSION (Corrected for Latitude)
//===============================

const R = 6371000;

function latLonToMeters(lat, lon) {
  // Use a simple local projection approximation (flat earth)
  // This is better than the previous one because it scales lon by cos(lat)
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const x = R * lonRad * Math.cos(latRad);
  const y = R * latRad;
  return [x, y];
}

function metersToLatLon(x, y) {
  const latRad = y / R;
  const lat = latRad * 180 / Math.PI;
  // We need current lat to accurately recover lon, 
  // but for a small local area, this works:
  const lon = (x / (R * Math.cos(latRad))) * 180 / Math.PI;
  return { latitude: lat, longitude: lon };
}

// INSTATIATE KALMAN 2D FILTER
const positionFilter = new Kalman2D();
let lastTimestamp = null;
let smoothedDeltaRate = 0;


// ==============================
// HARD TRANSITION RULES
// ==============================
function isTransitionAllowed(from, to, context) {
  const { hasParkedLocation } = context;

  // 🚫 Cannot go to RETURNING without parked location
  if (to === 'RETURNING' && !hasParkedLocation) return false;

  // 🚫 Cannot go to IN_CAR without parked location
  if (to === 'IN_CAR' && !hasParkedLocation) return false;

  // 🚫 Must be VERY close to the car
  if (to === 'IN_CAR' && context.dist > 8) return false;

  // 🚫 Must be approaching (not moving away)
  if (to === 'IN_CAR' && context.deltaRate > 0) return false;

  // 🚫 Must be slow (entering vehicle)
  if (to === 'IN_CAR' && context.speed > 7) return false;

  // 🚫 Must not have steps (you don't enter a car while walking actively)
  if (to === 'IN_CAR' && context.stepRate > 0.7) return false;

  // 🚫 Cannot jump directly WALKING → IN_CAR without parked location
  if (from === 'WALKING' && to === 'IN_CAR' && !hasParkedLocation) return false;

  // 🚫 Cannot jump WALKING → RETURNING without context (Unless moving towards car)
  if (from === 'WALKING' && to === 'RETURNING' && context.deltaRate >= -0.2) return false;

  // 🚫 AWAY requires distance (Reduced to 1.5m for tight indoor testing)
  if (to === 'AWAY' && context.dist < 1.5) return false;

  // 🚫 RETURNING requires being far enough first (Reduced to 1.5m)
  if (to === 'RETURNING' && context.dist < 1.5) return false;

  // 🚫 Must be close to the car (IN_CAR check) (Relaxed to 5m)
  if (to === 'IN_CAR' && context.dist > 5) return false;

  // 🚫 Must not have steps (you don't enter a car while walking actively)
  if (to === 'IN_CAR' && context.stepRate > 1.5) return false;

  // 🚫 Prevent oscillation
  if (from === 'AWAY' && to === 'RETURNING' && context.deltaRate > 0) return false;

  if (from === 'RETURNING' && to === 'AWAY' && context.deltaRate < 0) return false;

  // AWAY only valid if parked location exists, comes from walking and moving away from car
  if (to === 'AWAY') {
    if (!hasParkedLocation) return false;

    // If we are NEWLY entering AWAY, we must come from WALKING and be moving away
    if (from !== 'AWAY') {
      if (from !== 'WALKING') return false;
      
      // We only strictly enforce a positive deltaRate upon initial entry.
      // Once they are AWAY, we allow GPS bounce without instantly killing the state.
      if (context.deltaRate <= 0.1) return false; 
    }
  }

  // 🚫 Cannot go to IN_CAR from AWAY if moving further away
  if (from === 'AWAY' && to === 'IN_CAR' && context.deltaRate > 0) return false;

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
// SIGMOID (Numerically Stable)
// ==============================
function logSigmoid(x, midpoint, steepness) {
  // z represents how far we are past the threshold, scaled by steepness
  const z = steepness * (x - midpoint);
  
  // Prevent overflow for extreme values
  if (z > 20) return 0;       // Probability approaches 1 (log(1) = 0)
  if (z < -20) return z;      // Probability approaches 0 (log(x) drops linearly)
  
  return -Math.log(1 + Math.exp(-z));
}

// ==============================
// EMISSION MODEL
// ==============================
function emissionLogProb(state, obs) {
  const { speed, stepRate, accel, dist, deltaRate, stopDuration } = obs;

  let logp = 0;
  
  const isStationaryState = ['IDLE', 'STOPPED', 'IN_CAR'].includes(state);
  const isWalkingState = ['WALKING', 'AWAY', 'RETURNING'].includes(state);

  // SPEED
  if (state === 'DRIVING') {
    logp += logGaussian(speed, 40, 20);

  // Strong penalty if clearly not moving
  if (speed < 2) logp -= 10;

  // 🚀 NEW: penalize only if clearly walking
  if (stepRate > 2 && speed < 10) {
    logp -= 6; // not impossible, just unlikely
    }
  }

  else if (isWalkingState) {
    logp += logGaussian(speed, 2.5, 2);
    // 🚀 Nudge: If walking away, favor AWAY state if dist > 5m
    if (state === 'WALKING' && dist > 2 && deltaRate > 0) {
      logp += logGaussian(dist, 10, 5);
    }
    if (state === 'WALKING') {
      logp += 0.5; // small prior boost
    }
  } 
  else {
    logp += logGaussian(speed, 0, 1.5);

    // Add strict distance check for IN_CAR
    if (state === 'IN_CAR') {
      logp += logGaussian(dist, 0, 3);   // 🔒 very tight

      if (dist > 10) logp -= 15; // 🚫 strong rejection

      logp += logGaussian(speed, 1, 2);  // slow movement

      if (stepRate > 0.3) logp -= 10;    // 🚫 walking → not in car
    }
  }

  // STEP RATE (discriminative)
  const hasSteps = stepRate > 0.3; // 📉 lowered threshold for indoor walking
  if (hasSteps) {
    logp += isWalkingState ? Math.log(0.98) : Math.log(0.001); // 🔥 very strong penalty for stationary/driving with steps
    if (isWalkingState) logp += 2.5; // 🚀 extra boost to jump out of IDLE/STOPPED
  } else {
    logp += (isStationaryState || state === 'DRIVING') ? Math.log(0.9) : Math.log(0.1);
  }

  // ACCELERATION
  logp += logGaussian(accel, 1.0, 0.6);

  // 🛡️ STATIONARY GUARD
  // If phone is physically still (accel near 1.0 and no steps), 
  // we heavily penalize movement states to ignore GPS drift.
  const isPhysicallyStill = Math.abs(accel - 1.0) < 0.05 && !hasSteps;
  if (isPhysicallyStill) {
    if (['DRIVING', 'WALKING', 'AWAY', 'RETURNING'].includes(state)) {
      logp -= 10;
    } else {
      logp += 2; // Boost stationary states
    }
  }

  // DISTANCE relevance
  if (state === 'IN_CAR') {
    logp += logGaussian(dist, 0, 2);   // 🔒 very tight

    if (dist > 5) logp -= 15; // 🚫 strong rejection

    logp += logGaussian(speed, 1, 2);  // slow movement
  }

  // DIRECTION/DISTANCE
  if (state === 'RETURNING') {
    // Soft boundary: Must be > 5m away to be returning. 
    // Steepness 1.0 creates a smooth transition between 2m and 8m.
    logp += logSigmoid(dist, 5, 1.0); 

    // Keep the direction signal (Gaussian is okay here since we want a specific speed range)
    logp += logGaussian(deltaRate, -1.0, 0.8); 

    if (deltaRate < 0) logp += 2; // reward approaching
  }

  if (state === 'AWAY') {
    // Soft boundary: Must be > 3m away to be AWAY.
    logp += logSigmoid(dist, 3, 1.5); 

    // Strong direction signal
    logp += logGaussian(deltaRate, 1.0, 0.8);

    if (dist < 1) logp -= 10; // Hard penalty if practically inside the car
    else logp += 2; // Extra reward for being in AWAY state
  }

  return logp;
}

// ==============================
// FORWARD FILTER (Log-Sum-Exp version for stability & smoothing)
// ==============================
function updateBelief(prevBelief, obs, context) {
  const logNewBelief = {};
  let maxLog = -Infinity;

  for (const s of STATES) {
    let transitionSum = 0;

    for (const sp of STATES) {
      if (!isTransitionAllowed(sp, s, context)) continue;

      const p = prevBelief[sp] || 0;
      const a = A[sp]?.[s] || 0;

      transitionSum += p * a;
    }

    if (transitionSum <= 0) {
      logNewBelief[s] = -Infinity;
      continue;
    }

    // 🌡️ TEMPERATURE/SMOOTHING (0.5 balance between stability and speed)
    const logEmission = emissionLogProb(s, obs) * 0.5;
    const logVal = Math.log(transitionSum) + logEmission;

    logNewBelief[s] = logVal;
    if (logVal > maxLog) maxLog = logVal;
  }

  // Normalize in log space to prevent underflow
  let sumExp = 0;
  for (const s of STATES) {
    if (logNewBelief[s] === -Infinity) continue;
    sumExp += Math.exp(logNewBelief[s] - maxLog);
  }

  const logSumExp = maxLog + Math.log(sumExp);
  const newBelief = {};

  for (const s of STATES) {
    if (logNewBelief[s] === -Infinity) {
      newBelief[s] = 0;
    } else {
      newBelief[s] = Math.exp(logNewBelief[s] - logSumExp);
    }
  }

  return newBelief;
}

// ==============================
// MAIN FUNCTION
// ==============================

export function processLocationHMM(location, parkedLocation, supplemental = {}) {
  // Restore state if provided
  if (supplemental.previousState) {
    currentState = supplemental.previousState;
  }
  if (supplemental.previousBelief) {
    belief = supplemental.previousBelief;
  }
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

  const alpha = 0.7; // strong smoothing
  smoothedDeltaRate = alpha * smoothedDeltaRate + (1 - alpha) * deltaRate;
  const stableDeltaRate = smoothedDeltaRate;

  // ==============================
  // OBSERVATION VECTOR
  // ==============================
  const obs = {
    speed,
    stepRate: supplemental.step_rate || 0,
    accel: supplemental.acceleration_magnitude || 1,
    dist,
    deltaRate: stableDeltaRate,
    stopDuration: supplemental.stop_duration || 0
  };

  // ==============================
  // CONTEXT (for hard constraints)
  // ==============================
  const context = {
    hasParkedLocation: !!parkedLocation,
    deltaRate: obs.deltaRate,
    stepRate: obs.stepRate,
    dist: obs.dist,
    speed: obs.speed
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

  // ==============================
  // 🚗 PARKING EVENT DETECTION (CRITICAL)
  // ==============================
  let parkedEvent = false;

  // Detect exit from car: STOPPED → WALKING (or DRIVING -> WALKING via STOPPED)
  const isExitEvent =
    candidate === 'WALKING' &&
    (currentState === 'STOPPED' || currentState === 'DRIVING') && // Must come from STOPPED or DRIVING
    obs.speed < 4 &&
    obs.stepRate > 0.3 &&
    obs.stopDuration > 3 &&
    dist < 5; // Must be relatively close to the car to "exit" it

  if (isExitEvent && !parkedLocation) {
    console.log('[HMM] 🚗 Parking detected via exit event');
    parkedEvent = true;
  }

  // ==============================
  // ⏱️ TEMPORAL CONFIRMATION
  // ==============================
  if (!globalThis._awayCounter) globalThis._awayCounter = 0;
  if (!globalThis._returnCounter) globalThis._returnCounter = 0;
  if (!globalThis._inCarCounter) globalThis._inCarCounter = 0;

  if (candidate === 'AWAY') {
    globalThis._awayCounter++;
  } else {
    globalThis._awayCounter = 0;
  }

  if (candidate === 'RETURNING') {
    globalThis._returnCounter++;
  } else {
    globalThis._returnCounter = 0;
  }

  if (candidate === 'IN_CAR') {
    globalThis._inCarCounter++;
  } else {
    globalThis._inCarCounter = 0;
  }

  const awayConfirmed = globalThis._awayCounter >= 2;
  const returnConfirmed = globalThis._returnCounter >= 2;
  const inCarConfirmed = globalThis._inCarCounter >= 3;

  // Only switch if the candidate is 5% more confident than the current state
  if (candidate !== currentState && candidateConf > (currentConf + 0.05)) {
    if (candidate === 'AWAY' && !awayConfirmed) {
      // wait
    } else if (candidate === 'RETURNING' && !returnConfirmed) {
      // wait
    } else if (candidate === 'IN_CAR' && !inCarConfirmed) {
      // wait
    } else {
      currentState = candidate;
    }
  }

  // ==============================
  // RETURN RESULT
  // ==============================
  return {
    state: currentState,      // The "Official" sticky state
    bestState: candidate,     // The "Raw" leader in the belief
    confidence: candidateConf,
    secondBestState: sorted[1]?.[0],
    secondConfidence: sorted[1]?.[1],
    belief,
    parkedEvent,              // 🚀 Signal the parking event without hiding the WALKING state
    distToParked: dist,
    deltaRate: stableDeltaRate,
    filteredSpeed: speed,
    filteredCoords
  };
}


// ==============================
// DISTANCE (Haversine Formula)
// ==============================
function getDistance(a, b) {
  if (!a || !b) return 0;
  
  console.log(`[ParkDetection] getDistance: A(${a.latitude.toFixed(6)}, ${a.longitude.toFixed(6)}) B(${b.latitude.toFixed(6)}, ${b.longitude.toFixed(6)})`);

  const R = 6371e3; // Earth radius in meters
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  
  const a_haversine = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
  const c = 2 * Math.atan2(Math.sqrt(a_haversine), Math.sqrt(1 - a_haversine));
  const dist = R * c;
  console.log(`[ParkDetection] Calculated distance: ${dist.toFixed(2)}m`);
  return dist; // Distance in meters
}

// ==============================
// HELPERS
// ==============================
export function resetHMM() {
  for (const s of STATES) belief[s] = s === 'IDLE' ? 1 : 0;
  currentState = 'IDLE';
  speedFilter.x = 0;
  speedFilter.p = 1;
  return { shouldClearPersistedState: true }; // New: indicate that service should clear persisted state
}

export function getHMMStatus() {
  return { currentState, belief };
}

// Expo-safe
export function initMotionTracking() {
  console.log('[HMM] Motion tracking disabled');
}
