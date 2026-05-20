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
    IDLE: 0.35,      
    WALKING: 0.5, // 🚀 Boosted for faster initial pick-up
    RETURNING: 0.05, 
    IN_CAR: 0.05,   
    DRIVING: 0.05
  },
  WALKING: {
    WALKING: 0.75, 
    IDLE: 0.1,
    DRIVING: 0.05,   
    RETURNING: 0.1  
  },
  DRIVING: {
    DRIVING: 0.8,
    STOPPED: 0.15,
    WALKING: 0.05   
  },
  STOPPED: {
    STOPPED: 0.60, 
    DRIVING: 0.2,
    WALKING: 0.15,   
    IDLE: 0.05      
  },
  RETURNING: {
    RETURNING: 0.65,
    IN_CAR: 0.25,
    IDLE: 0.05,       
    WALKING: 0.05   
  },
  IN_CAR: {
    IN_CAR: 0.7,
    DRIVING: 0.2,
    WALKING: 0.05,  
    IDLE: 0.05      
  }
};

// ==============================
// GLOBAL STATE (EXPO SAFE)
// ==============================
let belief = {};
let currentState = 'IDLE';
let isAway = false; 
let isReturningIntentLocked = false; 
let minDistDuringReturn = Infinity;  

let _returnCounter = 0;
let _inCarCounter = 0;
let _drivingCounter = 0;
let _walkingCounter = 0;
let _tripDrivingTime = 0; 

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
    this.x = [0, 0, 0, 0]; 
    this.P = mathIdentity(4, 1000); 
    this.Q = mathIdentity(4, 0.1);  
    this.R = mathIdentity(2, 25);   
    this.lastTime = null;
  }
  update(z, dt) {
    if (!this.lastTime) {
      this.lastTime = Date.now();
      this.x[0] = z[0];
      this.x[1] = z[1];
      return [this.x[0], this.x[1]];
    }
    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    const H = [
      [1, 0, 0, 0],
      [0, 1, 0, 0]
    ];
    this.x = matMul(F, this.x);
    this.P = matAdd(matMul(F, matMul(this.P, transpose(F))), this.Q);
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
function identity(n) { return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))); }
function mathIdentity(n, val) { return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? val : 0))); }
function matMul(A, B) {
  if (Array.isArray(B[0])) {
    return A.map(row => B[0].map((_, j) => row.reduce((sum, val, k) => sum + val * B[k][j], 0)));
  } else {
    return A.map(row => row.reduce((sum, val, i) => sum + val * B[i], 0));
  }
}
function transpose(A) { return A[0].map((_, i) => A.map(row => row[i])); }
function matAdd(A, B) { return A.map((row, i) => row.map((val, j) => val + B[i][j])); }
function matSub(A, B) { return A.map((row, i) => row.map((val, j) => val - B[i][j])); }
function vecAdd(a, b) { return a.map((v, i) => v + b[i]); }
function vecSub(a, b) { return a.map((v, i) => v - b[i]); }
function inverse2x2(M) {
  const det = M[0][0]*M[1][1] - M[0][1]*M[1][0];
  if (Math.abs(det) < 1e-6) return identity(2);
  return [[ M[1][1]/det, -M[0][1]/det ], [ -M[1][0]/det, M[0][0]/det ]];
}

//===============================
// LAT/LON -> METERS CONVERSION
//===============================
const R = 6371000;
function latLonToMeters(lat, lon) {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const x = R * lonRad * Math.cos(latRad);
  const y = R * latRad;
  return [x, y];
}
function metersToLatLon(x, y) {
  const latRad = y / R;
  const lat = latRad * 180 / Math.PI;
  const lon = (x / (R * Math.cos(latRad))) * 180 / Math.PI;
  return { latitude: lat, longitude: lon };
}

const positionFilter = new Kalman2D();
let lastTimestamp = null;
let smoothedDeltaRate = 0;

// ==============================
// SLIDING WINDOW FOR PROGRESS
// ==============================
const PROGRESS_WINDOW_SIZE = 15; 
let progressHistory = []; 
let pgrHistory = []; 

function calculateIntentSlope(data) {
  const n = data.length;
  if (n < 5) return 0;
  
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i];
    sumXY += i * data[i];
    sumXX += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  return slope;
}

function calculatePGR(currentDist, currentX, currentY) {
  if (progressHistory.length < 5) return { pgr: 0, slope: 0, consistency: 0 };
  const start = progressHistory[0];
  const netGain = start.dist - currentDist;
  let totalPath = 0;
  for (let i = 1; i < progressHistory.length; i++) {
    const dX = progressHistory[i].x - progressHistory[i-1].x;
    const dY = progressHistory[i].y - progressHistory[i-1].y;
    totalPath += Math.sqrt(dX * dX + dY * dY);
  }
  const last = progressHistory[progressHistory.length - 1];
  totalPath += Math.sqrt((currentX - last.x)**2 + (currentY - last.y)**2);
  const pgr = totalPath < 1.0 ? 0 : netGain / totalPath;

  pgrHistory.push(pgr);
  if (pgrHistory.length > 15) pgrHistory.shift();

  const slope = calculateIntentSlope(pgrHistory);
  const consistency = pgrHistory.filter(v => v > 0.2).length / pgrHistory.length;
  return { pgr, slope, consistency };
}


// ==============================
// HARD TRANSITION RULES
// ==============================
function isTransitionAllowed(from, to, context) {
  // 🛡️ ESCAPE HATCH: Always allow staying in the current state
  if (from === to) return true;

  const { hasParkedLocation, isAway, activity } = context;

  // 🚶 WALKING Rules
  if (to === 'WALKING' && from !== 'WALKING') {
    const hasSteps = context.stepRate >= 0.05;
    const hasWalkingActivity = activity && activity.walking;
    if (!hasSteps && !hasWalkingActivity) return false;
  }
  if (to === 'WALKING' && context.speed > 12) return false; 

  // 🚗 DRIVING Rules
  if (to === 'DRIVING' && from !== 'DRIVING') {
    if (from === 'IDLE' && context.speed < 12) return false; 
    if (context.stepRate > 0.4 && context.speed < 10) return false;
    // 🚀 We removed the hard OS overrides here. If speed is high enough, let it drive!
    if (from === 'WALKING' && context.speed < 20 && !(activity && activity.automotive)) return false;
  }

  if (to === 'STOPPED' && from !== 'DRIVING' && from !== 'STOPPED') return false;

  if (to === 'RETURNING' && !hasParkedLocation) return false;
  if (to === 'RETURNING' && !isAway) return false;
  if (to === 'RETURNING' && !['WALKING', 'IDLE', 'RETURNING'].includes(from)) return false;
  if (to === 'RETURNING' && context.dist < 1.0) return false;

  if (to === 'IN_CAR' && !hasParkedLocation) return false;
  if (to === 'IN_CAR' && context.dist > 20) return false; 
  if (to === 'IN_CAR' && from !== 'IN_CAR' && context.dist > 15 && context.deltaRate > 0.2) return false; 
  if (to === 'IN_CAR' && context.speed > 10) return false;
  if (to === 'IN_CAR' && context.stepRate > 2.0) return false;

  if (from === 'WALKING' && to === 'IN_CAR' && !hasParkedLocation) return false;
  if (from === 'WALKING' && to === 'RETURNING') {
    if (context.deltaRate >= -0.2 && context.pgr < 0.2) return false;
  }

  return true;
}



// ==============================
// GAUSSIAN / SIGMOID
// ==============================
function logGaussian(x, mean, std) {
  const s = Math.max(std, 0.3);
  return -((x - mean) ** 2) / (2 * s * s);
}
function logSigmoid(x, midpoint, steepness) {
  const z = steepness * (x - midpoint);
  if (z > 20) return 0;       
  if (z < -20) return z;      
  return -Math.log(1 + Math.exp(-z));
}

// ==============================
// EMISSION MODEL
// ==============================
const RETURN_ZONE_RADIUS = 70; 
const AWAY_THRESHOLD = 5;

function emissionLogProb(state, obs) {
  const { speed, stepRate, accel, dist, deltaRate, accuracy, approachAlignment, pgr, slope, pgrConsistency, activity } = obs;

  let logp = 0;
  const TEMP = 0.5;

  let gpsWeight = 1.0;
  if (accuracy > 20) gpsWeight = Math.max(0.2, 20 / accuracy);

  const isStationaryState = ['IDLE', 'STOPPED', 'IN_CAR'].includes(state);
  const isWalkingState = ['WALKING', 'RETURNING'].includes(state);

  // 🚀 OS MOTION ACTIVITY BOOST (Balanced "Advisor" Logic)
  if (activity) {
    const { automotive, walking, stationary, unknown, confidence } = activity;
    
    // 🚀 Scaled down weights: 0.5, 1.0, 2.0
    const activityWeight = confidence === 0 ? 0.5 : (confidence === 1 ? 1.0 : 2.0); 

    if (!unknown) {
      // Balanced boosts (Maxes out around +10)
      if (state === 'DRIVING' && automotive) logp += (5.0 * activityWeight);
      if (isWalkingState && walking) logp += (5.0 * activityWeight);
      if (isStationaryState && stationary) logp += (4.0 * activityWeight);
      
      // Balanced penalties (Maxes out around -16)
      if (confidence >= 1) {
        if (state === 'DRIVING' && (walking || stationary)) logp -= (8.0 * activityWeight);
        if (isWalkingState && (automotive || stationary)) logp -= (8.0 * activityWeight);
        if (isStationaryState && (automotive || walking)) logp -= (8.0 * activityWeight);
      }
    }
  }

  // SPEED (GPS)
  if (state === 'DRIVING') {
    logp += logSigmoid(speed, 25, 0.4) * gpsWeight;
    if (speed < 2) logp -= (15 * gpsWeight);
    if (stepRate > 0.5 && speed < 10) logp -= 15; 
  }
  else if (isWalkingState) {
    logp += logGaussian(speed, 2.5, 4.0) * gpsWeight;
    if (state === 'WALKING') logp += 1.0; 
  } 
  else {
    logp += logGaussian(speed, 0, 1.5) * gpsWeight;
    if (state === 'IN_CAR') {
      logp += logGaussian(dist, 0, 6) * gpsWeight;
      if (dist > 15) logp -= (15 * gpsWeight);
      logp += logGaussian(speed, 1, 2) * gpsWeight;
      if (stepRate > 1.2) logp -= 5; 
      
      const magnetRadius = isReturningIntentLocked ? 4.0 : 3.0; 
      if (dist < magnetRadius) {
        logp += 2.8; 
        if (isReturningIntentLocked && speed < 2.0 && stepRate < 1.5) {
           logp += 20.0; 
        }
      }
    }
  }

  // STEP RATE (Sensor - THE FAST PATH)
  const hasSteps = stepRate > 0.3;
  if (hasSteps) {
    // If we have physical steps, WALKING should win regardless of what Apple's classifier says
    logp += isWalkingState ? 25.0 : -35.0; 
  } else {
    logp += (isStationaryState) ? 2.0 : -5.0;
  }

  // ACCELERATION (Sensor)
  logp += logGaussian(accel, 1.0, 0.6);

  // 🛡️ STATIONARY GUARD (Raw Accelerometer)
  // If the phone is literally not moving (e.g. on a desk), penalize movement states heavily.
  const isPhysicallyStill = Math.abs(accel - 1.0) < 0.03 && !hasSteps;
  if (isPhysicallyStill) {
    if (['DRIVING', 'WALKING', 'RETURNING'].includes(state)) {
      logp -= 20; 
    } else {
      logp += 5; 
    }
  }

  // DIRECTION/DISTANCE (GPS)
  if (state === 'RETURNING') {
    logp += logSigmoid(RETURN_ZONE_RADIUS - dist, 0, 0.05) * gpsWeight; 
    logp += logGaussian(deltaRate, -1.2, 1.0) * gpsWeight; 
    const proximityWeight = Math.max(0.2, 1.0 - (dist / RETURN_ZONE_RADIUS));

    let directionalScore = 0;
    if (pgr > 0) directionalScore += (pgr * 6.0); 
    else directionalScore += (pgr * 10.0); 

    if (approachAlignment > 0) directionalScore += (approachAlignment * 3.0); 
    else directionalScore += (approachAlignment * 5.0); 

    const consistentScore = directionalScore * Math.pow(pgrConsistency, 1.5);
    logp += (consistentScore * proximityWeight) * gpsWeight;
    if (slope > 0.01) logp += (slope * 50.0 * proximityWeight) * gpsWeight; 
    if (isReturningIntentLocked) logp += (10.0 * TEMP); 
  }

  return logp * TEMP;
}

// ==============================
// FORWARD FILTER
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

  // 🛡️ BELIEF COLLAPSE GUARD
  if (maxLog === -Infinity) {
    console.warn('[HMM] Belief collapse detected! All states blocked or 0 probability. Resetting to IDLE.');
    const reset = {};
    for (const s of STATES) reset[s] = s === 'IDLE' ? 1 : 0;
    return reset;
  }

  let sumExp = 0;
  for (const s of STATES) {
    if (logNewBelief[s] === -Infinity) continue;
    sumExp += Math.exp(logNewBelief[s] - maxLog);
  }

  const logSumExp = maxLog + Math.log(sumExp);
  const newBelief = {};
  for (const s of STATES) {
    newBelief[s] = logNewBelief[s] === -Infinity ? 0 : Math.exp(logNewBelief[s] - logSumExp);
    if (isNaN(newBelief[s])) newBelief[s] = 0; // Final NaN defense
  }
  return newBelief;
}

// ==============================
// MAIN FUNCTION
// ==============================
export function processLocationHMM(location, parkedLocation, supplemental = {}) {
  // Restore state with 🚀 NaN Quarantine 
  if (supplemental.previousState) currentState = supplemental.previousState;

  if (supplemental.previousBelief && !isNaN(supplemental.previousBelief['IDLE']) && supplemental.previousBelief['IDLE'] !== null) {
    belief = supplemental.previousBelief;
  } else {
    console.log('[HMM] NaN/Missing belief detected in restoration. Resetting.');
    for (const s of STATES) belief[s] = s === 'IDLE' ? 1 : 0;
  }

  if (supplemental.isAway !== undefined) isAway = supplemental.isAway;
  if (supplemental.isReturningIntentLocked !== undefined) isReturningIntentLocked = supplemental.isReturningIntentLocked;
  if (supplemental.minDistDuringReturn !== undefined) minDistDuringReturn = supplemental.minDistDuringReturn;

  // Restore Counters
  _returnCounter = supplemental.returnCounter || 0;
  _inCarCounter = supplemental.inCarCounter || 0;
  _drivingCounter = supplemental.drivingCounter || 0;
  _walkingCounter = supplemental.walkingCounter || 0;
  _tripDrivingTime = supplemental.tripDrivingTime || 0;

  const now = Date.now();
  let dt = 1;

  if (lastTimestamp) {
    dt = (now - lastTimestamp) / 1000;

    // 🚀 dt Guard: Prevent 0 or extremely small dt from causing Infinity/NaN
    if (dt < 0.05) {
      dt = 0.05; 
    }

    // 🚀 FIX: The Locker Room Time-Warp Guard
    if (dt > 60) {
      console.log('[HMM] ⚠️ Deep sleep detected (>60s). Resetting Kalman Physics to prevent NaN jump.');
      positionFilter.x = [0, 0, 0, 0]; 
      positionFilter.P = mathIdentity(4, 1000);
      positionFilter.lastTime = null; // Forces filter to snap perfectly to new GPS ping
      dt = 1; 
    } else {
      dt = Math.min(dt, 5); // Cap at 5s to prevent minor physics spikes
    }
  }
  lastTimestamp = now;

  const rawLat = location.coords.latitude;
  const rawLon = location.coords.longitude;
  const [mx, my] = latLonToMeters(rawLat, rawLon);
  const [fx, fy] = positionFilter.update([mx, my], dt);
  const filteredCoords = metersToLatLon(fx, fy);

  const rawSpeed = Math.max(0, (location.coords.speed || 0) * 3.6);
  const speed = speedFilter.update(rawSpeed);

  let dist = parkedLocation ? getDistance(filteredCoords, parkedLocation) : 0;

  // ==============================
  // DELTA DISTANCE & NaN STABILIZER
  // ==============================
  let deltaRate = 0;
  if (supplemental.lastDistanceToCar !== undefined && dt > 0 && !isNaN(dist)) {
    const delta = dist - supplemental.lastDistanceToCar;
    deltaRate = Math.max(-10, Math.min(10, delta)) / dt;
  }

  const alpha = 0.7; 
  smoothedDeltaRate = alpha * smoothedDeltaRate + (1 - alpha) * (isNaN(deltaRate) ? 0 : deltaRate);
  
  // 🚀 FIX: Prevent rate values from infecting the state with NaN
  if (isNaN(smoothedDeltaRate)) smoothedDeltaRate = 0;
  const stableDeltaRate = smoothedDeltaRate;

  let approachAlignment = 0;
  if (parkedLocation) {
    const [parkedMx, parkedMy] = latLonToMeters(parkedLocation.latitude, parkedLocation.longitude);
    const dx = parkedMx - fx;
    const dy = parkedMy - fy;
    const vx = positionFilter.x[2];
    const vy = positionFilter.x[3];
    const magD = Math.sqrt(dx * dx + dy * dy);
    const magV = Math.sqrt(vx * vx + vy * vy);
    
    if (magV > 0.3 && magD > 2) {
      approachAlignment = (vx * dx + vy * dy) / (magV * magD);
    }
  }

  let pgrMetrics = { pgr: 0, trend: 0, consistency: 0 };
  if (parkedLocation && !isNaN(fx) && !isNaN(fy)) {
    pgrMetrics = calculatePGR(dist, fx, fy);
    progressHistory.push({ dist, x: fx, y: fy, time: now });
    if (progressHistory.length > PROGRESS_WINDOW_SIZE) progressHistory.shift();
  }

  const obs = {
    speed,
    stepRate: supplemental.step_rate || 0,
    accel: supplemental.acceleration_magnitude || 1,
    dist,
    deltaRate: stableDeltaRate,
    stopDuration: supplemental.stop_duration || 0,
    accuracy: supplemental.accuracy || 10, 
    approachAlignment, 
    pgr: pgrMetrics.pgr, 
    slope: pgrMetrics.slope,
    pgrConsistency: pgrMetrics.consistency,
    activity: supplemental.motion_activity
  };

  const context = {
    hasParkedLocation: !!parkedLocation,
    deltaRate: obs.deltaRate,
    stepRate: obs.stepRate,
    dist: obs.dist,
    speed: obs.speed,
    pgr: obs.pgr,
    slope: obs.slope,
    pgrConsistency: obs.pgrConsistency,
    isAway,
    activity: obs.activity
  };

  belief = updateBelief(belief, obs, context);

  const sorted = Object.entries(belief).sort((a, b) => b[1] - a[1]);
  const candidate = sorted[0][0];
  const candidateConf = sorted[0][1];
  const currentConf = belief[currentState] || 0;

  // ==============================
  // ⏱️ SECURE TEMPORAL CONFIRMATION
  // ==============================
  const hasWalkingSignal = obs.activity && obs.activity.walking && obs.activity.confidence >= 1;
  const hasDrivingSignal = obs.activity && obs.activity.automotive && obs.activity.confidence >= 1;
  const hasStillSignal = obs.activity && obs.activity.stationary && obs.activity.confidence >= 1;

  // ==============================
  // 🔒 GATED RETURN COUNTER
  // ==============================
  const hasReturningTrend = obs.pgr > 0.1 && obs.slope > -0.01;
  if (candidate === 'RETURNING' && hasReturningTrend) {
    _returnCounter++;
  } else {
    _returnCounter = 0;
  }
  if (candidate === 'IN_CAR') _inCarCounter++; else _inCarCounter = 0;
  
  // Resilient Walking Counter
  if (candidate === 'WALKING' || (hasWalkingSignal && candidateConf > 0.3)) {
    _walkingCounter++;
  } else {
    _walkingCounter = 0;
  }

  // Resilient Driving Counter
  if (candidate === 'DRIVING' || (hasDrivingSignal && candidateConf > 0.3)) {
    _drivingCounter++;
  } else {
    _drivingCounter = 0;
  }

  // 🚀 FIX: The Phantom Trip Guard
  // Only accumulate trip time if we are actually moving in a vehicle.
  // This prevents the timer from filling up while drinking coffee next to the parked car!
  if (candidate === 'DRIVING' || (candidate === 'IN_CAR' && speed > 5)) {
    _tripDrivingTime += dt; 
  }
  // Note: We intentionally DO NOT reset the timer to 0 here. 
  // It naturally pauses at red lights, and only resets to 0 when a true parking event occurs.

  const returnConfirmed = _returnCounter >= 2;
  const inCarConfirmed = _inCarCounter >= 2;
  
  // Confirmation thresholds
  const drivingConfirmed = _drivingCounter >= 2 || (hasDrivingSignal && _drivingCounter >= 1 && speed > 10);
  const walkingConfirmed = _walkingCounter >= 2 || (hasWalkingSignal && _walkingCounter >= 1); 

  // ==============================
  // 🔒 INTENT LOCK LOGIC (RETURNING)
  // ==============================
  if (!isReturningIntentLocked && currentState === 'RETURNING' && candidateConf > 0.85) {
    console.log('[HMM] 🔒 Intent Lock ACTIVATED: User is likely returning.');
    isReturningIntentLocked = true;
    minDistDuringReturn = dist;
  }

  if (isReturningIntentLocked) {
    if (dist < minDistDuringReturn) minDistDuringReturn = dist;
    if (dist > minDistDuringReturn + 15 && dist > 10) {
      console.log(`[HMM] 🔓 Intent Lock BROKEN: User walked away (+15m from closest approach).`);
      isReturningIntentLocked = false;
      minDistDuringReturn = Infinity;
    }
    if (currentState === 'IN_CAR' || currentState === 'DRIVING') {
      console.log('[HMM] 🔓 Intent Lock RELEASED: Arrival/Driving confirmed.');
      isReturningIntentLocked = false;
      minDistDuringReturn = Infinity;
    }
  }

  // ==============================
  // 🚗 PARKING EVENT DETECTION
  // ==============================
  let parkedEvent = false;

  const isExitEvent =
    candidate === 'WALKING' &&
    walkingConfirmed &&
    ['STOPPED', 'DRIVING', 'IN_CAR', 'IDLE'].includes(currentState) &&
    _tripDrivingTime >= 10; 
  
  if (isExitEvent) {
    console.log('[HMM] 🚗 Parking detected via confirmed exit event');
    parkedEvent = true;
    _tripDrivingTime = 0; 
  }

  // ==============================
  // 🛑 CLEAR PARKING EVENT
  // ==============================
  let clearParkingEvent = false;

  if (parkedLocation && currentState === 'DRIVING' && _tripDrivingTime >= 10 && dist > 50) {
    console.log(`[HMM] 🛑 Parking spot cleared. Sustained driving away from spot detected (>50m).`);
    clearParkingEvent = true;
  }

  // ==============================
  // 📍 AWAY EVENT DETECTION
  // ==============================
  let awayEvent = false;
  if (!isAway && dist > AWAY_THRESHOLD && (currentState === 'WALKING' || currentState === 'IDLE')) {
    console.log(`[HMM] 📍 User left vicinity (> ${AWAY_THRESHOLD}m)`);
    isAway = true;
    awayEvent = true;
  }

  if (isAway && (currentState === 'IN_CAR' || (currentState === 'DRIVING' && dist < 20))) {
    console.log('[HMM] 🏠 User back at car. Resetting isAway flag.');
    isAway = false;
  }

  // ==============================
  // STATE SWITCH
  // ==============================
  if (candidate !== currentState && candidateConf > (currentConf + 0.05)) {
    if (candidate === 'RETURNING' && !returnConfirmed) {} 
    else if (candidate === 'IN_CAR' && !inCarConfirmed) {} 
    else if (candidate === 'DRIVING' && !drivingConfirmed) {} 
    else if (candidate === 'WALKING' && !walkingConfirmed) {} 
    else {
      currentState = candidate;
    }
  }

  return {
    state: currentState,      
    bestState: candidate,     
    confidence: candidateConf,
    secondBestState: sorted[1]?.[0],
    secondConfidence: sorted[1]?.[1],
    belief,
    parkedEvent,              
    awayEvent,                
    clearParkingEvent,        
    isAway,                   
    isReturningIntentLocked,  
    minDistDuringReturn,      
    distToParked: dist,
    deltaRate: stableDeltaRate,
    filteredSpeed: speed,
    filteredCoords,
    // Export counters for persistence
    returnCounter: _returnCounter,
    inCarCounter: _inCarCounter,
    drivingCounter: _drivingCounter,
    walkingCounter: _walkingCounter,
    tripDrivingTime: _tripDrivingTime
  };
}

// ==============================
// DISTANCE
// ==============================
function getDistance(a, b) {
  if (!a || !b) return 0;
  const R = 6371e3; 
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const a_haversine = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a_haversine), Math.sqrt(1 - a_haversine));
  return R * c; 
}

// ==============================
// HELPERS
// ==============================
export function resetHMM() {
  for (const s of STATES) belief[s] = s === 'IDLE' ? 1 : 0;
  currentState = 'IDLE';
  isAway = false; 
  isReturningIntentLocked = false; 
  minDistDuringReturn = Infinity;  

  speedFilter.x = 0;
  speedFilter.p = 1;
  positionFilter.x = [0, 0, 0, 0];
  positionFilter.P = mathIdentity(4, 1000);
  positionFilter.lastTime = null;

  smoothedDeltaRate = 0;
  lastTimestamp = null;
  progressHistory = []; 
  pgrHistory = [];      

  _returnCounter = 0;
  _inCarCounter = 0;
  _drivingCounter = 0;
  _walkingCounter = 0;
  _tripDrivingTime = 0; 

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

export function initMotionTracking() {
  console.log('[HMM] Motion tracking disabled');
}