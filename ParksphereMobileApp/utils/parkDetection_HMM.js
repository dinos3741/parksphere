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
  'RETURNING',
  'IN_CAR'
];

// ==============================
// TRANSITIONS (base probabilities)
// ==============================

export const A = {

  IDLE: {
    IDLE: 0.4,      
    WALKING: 0.3,  // Boosted since AWAY is gone
    RETURNING: 0.1, 
    IN_CAR: 0.15,   
    DRIVING: 0.05
  },

  WALKING: {
    WALKING: 0.65, // Boosted since AWAY is gone
    IDLE: 0.15,
    DRIVING: 0.1,   // ✅ direct walk → car → drive (first use case)
    RETURNING: 0.1  // 🚀 new: can start walking back to car immediately
  },

  DRIVING: {
    DRIVING: 0.7,
    STOPPED: 0.25,
    WALKING: 0.05   // e.g. very short trips / GPS glitches
  },

  STOPPED: {
    STOPPED: 0.50, // Reduced to allow for IDLE transition
    DRIVING: 0.25,
    WALKING: 0.2,   // ✅ critical: user exits car
    IDLE: 0.05      // ✅ NEW: Allow transition back to IDLE after being stopped
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
let isAway = false; // 🚀 NEW: Contextual flag for being far from car

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

const speedFilter = new Kalman1D(0.1, 1);


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
// SLIDING WINDOW FOR PROGRESS
// ==============================
const PROGRESS_WINDOW_SIZE = 15; // Increased window for better trend analysis
let progressHistory = []; 
let pgrHistory = []; // Track recent PGR values to detect trends

function calculatePGR(currentDist, currentX, currentY) {
  if (progressHistory.length < 5) return { pgr: 0, trend: 0, consistency: 0 };
  
  const start = progressHistory[0];
  const netGain = start.dist - currentDist;
  
  let totalPath = 0;
  for (let i = 1; i < progressHistory.length; i++) {
    const dX = progressHistory[i].x - progressHistory[i-1].x;
    const dY = progressHistory[i].y - progressHistory[i-1].y;
    totalPath += Math.sqrt(dX * dX + dY * dY);
  }
  
  const last = progressHistory[progressHistory.length - 1];
  const dX = currentX - last.x;
  const dY = currentY - last.y;
  totalPath += Math.sqrt(dX * dX + dY * dY);

  const pgr = totalPath < 1.0 ? 0 : netGain / totalPath;

  // Update PGR History
  pgrHistory.push(pgr);
  if (pgrHistory.length > 10) pgrHistory.shift();

  // Calculate Trend (Simple Linear Regression Slope approximation)
  let trend = 0;
  if (pgrHistory.length >= 5) {
    const firstHalf = pgrHistory.slice(0, Math.floor(pgrHistory.length/2));
    const secondHalf = pgrHistory.slice(Math.floor(pgrHistory.length/2));
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    trend = avgSecond - avgFirst; // Positive if PGR is improving
  }

  // Consistency: How many of the last samples are "returning-like" (> 0.2)
  const consistency = pgrHistory.filter(v => v > 0.2).length / pgrHistory.length;

  return { pgr, trend, consistency };
}

// ==============================
// HARD TRANSITION RULES
// ==============================
function isTransitionAllowed(from, to, context) {
  const { hasParkedLocation, isAway } = context;

  // 🚫 Cannot enter WALKING if there are literally zero steps
  if (to === 'WALKING' && from !== 'WALKING' && context.stepRate < 0.05) return false;

  // 🚫 Cannot enter STOPPED unless coming from DRIVING or if already in STOPPED state
  if (to === 'STOPPED' && from !== 'DRIVING' && from !== 'STOPPED') return false;

  // 🚫 Cannot go to RETURNING without parked location
  if (to === 'RETURNING' && !hasParkedLocation) return false;

  // 🚫 RETURNING requires being "Away" first (contextual flag)
  if (to === 'RETURNING' && !isAway) return false;

  // 🚫 RETURNING can only be reached from WALKING or IDLE (Now that AWAY is gone)
  if (to === 'RETURNING' && !['WALKING', 'IDLE', 'RETURNING'].includes(from)) return false;

  // 🚫 Cannot go to IN_CAR without parked location
  if (to === 'IN_CAR' && !hasParkedLocation) return false;

  // 🚫 Must be VERY close to the car
  if (to === 'IN_CAR' && context.dist > 8) return false;

  // 🚫 Must be approaching, BUT ONLY if we are still a few meters out.
  // If we are within 3 meters, ignore deltaRate to prevent GPS bounce from blocking entry.
  if (to === 'IN_CAR' && from !== 'IN_CAR' && context.dist > 3 && context.deltaRate > 0) {
      return false; 
  }

  // 🚫 Must be slow (entering vehicle)
  if (to === 'IN_CAR' && context.speed > 7) return false;

  // 🚫 Must not be actively walking (Relaxed to 1.2 to account for pedometer lag when sitting down)
  if (to === 'IN_CAR' && context.stepRate > 1.2) return false;

  // 🚫 Cannot jump directly WALKING → IN_CAR without parked location
  if (from === 'WALKING' && to === 'IN_CAR' && !hasParkedLocation) return false;

  // 🚫 Cannot jump WALKING → RETURNING without context (Unless moving towards car)
  if (from === 'WALKING' && to === 'RETURNING') {
    if (context.deltaRate >= -0.2 && context.pgr < 0.2) return false;
  }

  // 🚫 RETURNING requires being far enough first (Reduced to 1.5m)
  if (to === 'RETURNING' && context.dist < 1.5) return false;

  // 🚫 Must not have steps (you don't enter a car while walking actively)
  if (to === 'IN_CAR' && context.stepRate > 1.2) return false;

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
const RETURN_ZONE_RADIUS = 70; // 🚀 Configurable midpoint for returning detection (meters)
const AWAY_THRESHOLD = 30;    // 🚀 RESTORED: More robust against GPS noise (30m)

function emissionLogProb(state, obs) {
  const { speed, stepRate, accel, dist, deltaRate, stopDuration, accuracy, approachAlignment, pgr, pgrTrend, pgrConsistency } = obs;

  let logp = 0;
  
  // 🌡️ TEMPERATURE/SMOOTHING (0.5 balance between stability and speed)
  const TEMP = 0.5;

  // 🚀 GPS ACCURACY PENALTY (Internal)
  // If accuracy is poor (> 20m), reduce influence of GPS-derived metrics.
  let gpsWeight = 1.0;
  if (accuracy > 20) {
    gpsWeight = Math.max(0.2, 20 / accuracy);
  }

  const isStationaryState = ['IDLE', 'STOPPED', 'IN_CAR'].includes(state);
  const isWalkingState = ['WALKING', 'RETURNING'].includes(state);

  // SPEED (GPS)
  if (state === 'DRIVING') {
    logp += logSigmoid(speed, 15, 0.5) * gpsWeight;
    if (speed < 2) logp -= (15 * gpsWeight);
    if (stepRate > 0.5 && speed < 25) logp -= 10;
  }
  else if (isWalkingState) {
    logp += logGaussian(speed, 2.5, 2) * gpsWeight;
    // Removed distance-based penalty for WALKING
    if (state === 'WALKING') logp += 1.0; // Steady boost for walking
  } 
  else {
    logp += logGaussian(speed, 0, 1.5) * gpsWeight;
    if (state === 'IN_CAR') {
      logp += logGaussian(dist, 0, 4) * gpsWeight;
      if (dist > 8) logp -= (15 * gpsWeight);
      logp += logGaussian(speed, 1, 2) * gpsWeight;
      if (stepRate > 0.5) logp -= 5;
      if (dist < 5) logp += 1.5;
    }
  }

  // STEP RATE (Sensor)
  const hasSteps = stepRate > 0.3;
  if (hasSteps) {
    logp += isWalkingState ? Math.log(0.98) : Math.log(0.001);
    if (isWalkingState) logp += 2.5;
  } else {
    logp += (isStationaryState) ? Math.log(0.9) : Math.log(0.1);
  }

  // ACCELERATION (Sensor)
  logp += logGaussian(accel, 1.0, 0.6);

  // 🛡️ STATIONARY GUARD (Sensor)
  const isPhysicallyStill = Math.abs(accel - 1.0) < 0.05 && !hasSteps;
  if (isPhysicallyStill) {
    if (['DRIVING', 'WALKING', 'RETURNING'].includes(state)) {
      logp -= 10;
    } else {
      logp += 2;
    }
  }

  // DIRECTION/DISTANCE (GPS)
  if (state === 'RETURNING') {
    // 1. Basic distance gate (Sigmoid ensures it's harder to be "returning" when very far)
    logp += logSigmoid(RETURN_ZONE_RADIUS - dist, 0, 0.05) * gpsWeight; 

    // 2. Velocity towards car (deltaRate) - Gaussian centered at -1.2 m/s (standard walking pace)
    logp += logGaussian(deltaRate, -1.2, 1.0) * gpsWeight; 

    // 3. Distance-based scaling factor (Higher importance as we get closer)
    const proximityWeight = Math.max(0.2, 1.0 - (dist / RETURN_ZONE_RADIUS));

    // 4. Directional Evidence (PGR + Alignment)
    // PGR: 1.0 = walking perfectly straight at car, -1.0 = perfectly away
    // approachAlignment: 1.0 = velocity vector points at car
    let directionalScore = 0;
    
    // Smooth linear boosts/penalties instead of binary tripwires
    if (pgr > 0) {
      directionalScore += (pgr * 6.0); // Reward progress
    } else {
      directionalScore += (pgr * 10.0); // Heavier penalty for moving away
    }

    if (approachAlignment > 0) {
      directionalScore += (approachAlignment * 3.0); // Reward vector pointing at car
    } else {
      directionalScore += (approachAlignment * 5.0); // Penalty for facing away
    }

    // 5. Temper the score by consistency (0.0 to 1.0)
    // A high consistency (steady path) amplifies the score.
    const consistentScore = directionalScore * Math.pow(pgrConsistency, 1.5);

    // 6. Apply proximity weighting
    logp += (consistentScore * proximityWeight) * gpsWeight;

    // 7. Trend Boost (Reward consistent improvement in progress)
    if (pgrTrend > 0) {
      logp += (pgrTrend * 30.0 * proximityWeight) * gpsWeight; 
    }
  }

  return logp * TEMP;
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

    const logEmission = emissionLogProb(s, obs);
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
  if (supplemental.isAway !== undefined) {
    isAway = supplemental.isAway;
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
  // APPROACH ALIGNMENT (Vector Math)
  // ==============================
  let approachAlignment = 0;

  if (parkedLocation) {
    // 1. Get parked car coordinates in meters
    const [parkedMx, parkedMy] = latLonToMeters(parkedLocation.latitude, parkedLocation.longitude);
    
    // 2. Vector pointing from current location TO the car
    const dx = parkedMx - fx;
    const dy = parkedMy - fy;
    
    // 3. Current velocity vector from your Kalman Filter
    const vx = positionFilter.x[2];
    const vy = positionFilter.x[3];
    
    // 4. Magnitudes
    const magD = Math.sqrt(dx * dx + dy * dy);
    const magV = Math.sqrt(vx * vx + vy * vy);
    
    // Only calculate if the user is actually moving and not standing on the hood of the car
    if (magV > 0.3 && magD > 2) {
      // Dot product divided by magnitudes = Cosine of the angle between them
      approachAlignment = (vx * dx + vy * dy) / (magV * magD);
    }
  }

  // ==============================
  // SLIDING WINDOW UPDATE (PGR)
  // ==============================
  let pgrMetrics = { pgr: 0, trend: 0, consistency: 0 };
  if (parkedLocation) {
    pgrMetrics = calculatePGR(dist, fx, fy);
    
    progressHistory.push({ dist, x: fx, y: fy, time: now });
    if (progressHistory.length > PROGRESS_WINDOW_SIZE) {
      progressHistory.shift();
    }
  }

  // ==============================
  // OBSERVATION VECTOR
  // ==============================
  const obs = {
    speed,
    stepRate: supplemental.step_rate || 0,
    accel: supplemental.acceleration_magnitude || 1,
    dist,
    deltaRate: stableDeltaRate,
    stopDuration: supplemental.stop_duration || 0,
    accuracy: supplemental.accuracy || 10, // Use passed accuracy
    approachAlignment, // 🚀 NEW
    pgr: pgrMetrics.pgr, // 🚀 NEW: Proximity Gain Ratio
    pgrTrend: pgrMetrics.trend,
    pgrConsistency: pgrMetrics.consistency
  };

  // ==============================
  // CONTEXT (for hard constraints)
  // ==============================
  const context = {
    hasParkedLocation: !!parkedLocation,
    deltaRate: obs.deltaRate,
    stepRate: obs.stepRate,
    dist: obs.dist,
    speed: obs.speed,
    pgr: obs.pgr,
    pgrTrend: obs.pgrTrend,
    pgrConsistency: obs.pgrConsistency,
    isAway // 🚀 NEW
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
  // ⏱️ TEMPORAL CONFIRMATION
  // ==============================
  if (!globalThis._returnCounter) globalThis._returnCounter = 0;
  if (!globalThis._inCarCounter) globalThis._inCarCounter = 0;
  if (!globalThis._drivingCounter) globalThis._drivingCounter = 0;
  if (!globalThis._walkingCounter) globalThis._walkingCounter = 0;

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

  if (candidate === 'DRIVING') {
    globalThis._drivingCounter++;
  } else {
    globalThis._drivingCounter = 0;
  }

  if (candidate === 'WALKING') {
    globalThis._walkingCounter++;
  } else {
    globalThis._walkingCounter = 0;
  }

  const returnConfirmed = globalThis._returnCounter >= 2;
  const inCarConfirmed = globalThis._inCarCounter >= 2;
  const drivingConfirmed = globalThis._drivingCounter >= 2;
  const walkingConfirmed = globalThis._walkingCounter >= 3; // 🚀 Requires sustained steps

  // ==============================
  // 🚗 PARKING EVENT DETECTION (CRITICAL)
  // ==============================
  let parkedEvent = false;

  // Detect exit from car: STOPPED → WALKING (or DRIVING -> WALKING via STOPPED)
  // We fire this ONLY when walking is confirmed, but we are still in a vehicle state.
  const isExitEvent =
    candidate === 'WALKING' &&
    walkingConfirmed &&
    (currentState === 'STOPPED' || currentState === 'DRIVING');
  
    // By removing the !parkedLocation check here, you can detect re-parking!
  if (isExitEvent) {
    console.log('[HMM] 🚗 Parking detected via confirmed exit event');
    parkedEvent = true;
  }

  // ==============================
  // 📍 AWAY EVENT DETECTION (NEW)
  // ==============================
  let awayEvent = false;
  // Threshold AWAY_THRESHOLD, requires being in walking/idle state behaviorally
  if (!isAway && dist > AWAY_THRESHOLD && (currentState === 'WALKING' || currentState === 'IDLE')) {
    console.log(`[HMM] 📍 User left vicinity (> ${AWAY_THRESHOLD}m)`);
    isAway = true;
    awayEvent = true;
  }

  // Reset isAway flag when back in car or driving
  if (isAway && (currentState === 'IN_CAR' || currentState === 'DRIVING')) {
    console.log('[HMM] 🏠 User back at car. Resetting isAway flag.');
    isAway = false;
  }

  // Only switch if the candidate is 5% more confident than the current state
  if (candidate !== currentState && candidateConf > (currentConf + 0.05)) {
    if (candidate === 'RETURNING' && !returnConfirmed) {
      // wait
    } else if (candidate === 'IN_CAR' && !inCarConfirmed) {
      // wait
    } else if (candidate === 'DRIVING' && !drivingConfirmed) {
      // wait
    } else if (candidate === 'WALKING' && !walkingConfirmed) {
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
    awayEvent,                // 🚀 NEW: Signal the "Left Vicinity" event
    isAway,                   // 🚀 NEW: Provide the flag status
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
  // 1. Reset Beliefs and State
  for (const s of STATES) belief[s] = s === 'IDLE' ? 1 : 0;
  currentState = 'IDLE';
  isAway = false; // 🚀 NEW

  // 2. Reset Kalman Filters
  speedFilter.x = 0;
  speedFilter.p = 1;

  positionFilter.x = [0, 0, 0, 0];
  positionFilter.P = mathIdentity(4, 1000);
  positionFilter.lastTime = null;

  // 3. Reset supplemental state
  smoothedDeltaRate = 0;
  lastTimestamp = null;
  progressHistory = []; // 🚀 NEW
  pgrHistory = [];      // 🚀 NEW

  // 4. Reset Global Counters (Temporal Confirmation)
  globalThis._returnCounter = 0;
  globalThis._inCarCounter = 0;
  globalThis._drivingCounter = 0;
  globalThis._walkingCounter = 0;

  console.log('[HMM] Engine fully reset to IDLE.');
  return { 
    shouldClearPersistedState: true,
    currentState,
    belief
  };
}

export function getHMMStatus() {
  return { currentState, belief };
}

// Expo-safe
export function initMotionTracking() {
  console.log('[HMM] Motion tracking disabled');
}
