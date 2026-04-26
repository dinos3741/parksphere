/**
 * Park Detection HMM
 * Infers the user's state (DRIVING, PARKED, etc.) using a Hidden Markov Model
 */

export const STATES = [
  'IDLE', 'WALKING', 'DRIVING', 'STOPPED', 'PARKED',
  'WALKING_AWAY', 'AWAY', 'RETURNING', 'IN_CAR'
];

// Transition Matrix A[from][to]
export const A = {
  IDLE: { IDLE: 0.6, WALKING: 0.39, DRIVING: 0.01 }, // Removed PARKED, restricted to movement only
  WALKING: { WALKING: 0.85, IDLE: 0.05, RETURNING: 0.05, WALKING_AWAY: 0.05 },
  DRIVING: { DRIVING: 0.9, STOPPED: 0.08, PARKED: 0.02 },
  STOPPED: { STOPPED: 0.5, DRIVING: 0.2, PARKED: 0.2, IN_CAR: 0.1 },
  PARKED: { PARKED: 0.7, WALKING_AWAY: 0.15, STOPPED: 0.05, IN_CAR: 0.1 },
  WALKING_AWAY: { WALKING_AWAY: 0.8, AWAY: 0.15, RETURNING: 0.05 },
  AWAY: { AWAY: 0.9, RETURNING: 0.1 },
  RETURNING: { RETURNING: 0.8, IN_CAR: 0.15, AWAY: 0.05 },
  IN_CAR: { IN_CAR: 0.6, DRIVING: 0.3, STOPPED: 0.1 }
};

// Activity Likelihood Table: P(Activity | State)
const ActivityLikelihood = {
  AUTOMOTIVE: { DRIVING: 0.8, STOPPED: 0.1, IN_CAR: 0.1 },
  WALKING: { WALKING: 0.4, WALKING_AWAY: 0.2, RETURNING: 0.2, AWAY: 0.2 },
  RUNNING: { WALKING: 0.4, WALKING_AWAY: 0.2, RETURNING: 0.2, AWAY: 0.2 },
  STATIONARY: { PARKED: 0.4, IDLE: 0.3, STOPPED: 0.2, AWAY: 0.05, IN_CAR: 0.05 },
  CYCLING: { DRIVING: 0.5, WALKING: 0.5 } 
};

function logGaussian(x, mean, std) {
  const s = Math.max(std, 0.01);
  const variance = s * s;
  return -((x - mean) ** 2) / (2 * variance) + Math.log(1 / (Math.sqrt(2 * Math.PI) * s));
}

// Logistic function for transition probabilities (e.g., stop duration)
function logLogistic(x, threshold, steepness) {
  return -Math.log(1 + Math.exp(-steepness * (x - threshold)));
}

export function emissionLogProb(state, obs) {
  const { 
    speed, 
    accel, 
    steps, 
    dist, 
    deltaDist, 
    headingChange, 
    stopDuration,
    activity, 
    confidence 
  } = obs;

  let logp = 0;

  // 1. Speed Model (km/h)
  switch (state) {
    case 'IDLE':
    case 'STOPPED':
    case 'PARKED': 
      logp += logGaussian(speed, 0, 0.5); break;
    case 'DRIVING': 
      logp += speed > 10 ? logGaussian(speed, 40, 20) : Math.log(0.01); break;
    case 'WALKING':
    case 'WALKING_AWAY':
    case 'RETURNING': 
      logp += logGaussian(speed, 4.5, 1.5); break;
    case 'AWAY': 
      logp += logGaussian(speed, 3, 5); break; // Broadened for any pedestrian movement
    case 'IN_CAR': 
      logp += logGaussian(speed, 2, 3); break; // Broadened for slow movement/pulling out
  }

  // 2. Acceleration Magnitude (g-force units)
  switch (state) {
    case 'IDLE':
    case 'PARKED':
      logp += logGaussian(accel, 1.0, 0.05); break;
    case 'WALKING':
    case 'WALKING_AWAY':
    case 'RETURNING':
    case 'AWAY':
      logp += logGaussian(accel, 1.2, 0.4); break; // Broadened for AWAY
    case 'DRIVING':
      logp += logGaussian(accel, 1.1, 0.2); break;
  }


  // 3. Step Rate (Zero-Inflated Bernoulli)
  const isWalkingState = ['WALKING', 'WALKING_AWAY', 'RETURNING', 'AWAY'].includes(state);
  if (steps > 0) {
    if (isWalkingState) logp += Math.log(0.9);
    else if (state === 'DRIVING') logp += Math.log(0.0001); // Heavy penalty for driving with steps
    else logp += Math.log(0.01);
  } else {
    logp += isWalkingState ? Math.log(0.1) : Math.log(0.99);
  }

  // 4. Distance and Delta Distance
  if (dist !== null) {
    // Proximity logic for stationary/near-car states
    if (['PARKED', 'STOPPED'].includes(state)) {
      logp += logGaussian(dist, 2, 8);
    }

    if (state === 'IN_CAR') {
      logp += logGaussian(dist, 0, 3); // Very strict: user is AT the car
    }

    // Sigmoid-based "Zone" logic
    const threshold = 50; // meters
    const steepness = 0.1;

    switch (state) {
      case 'WALKING_AWAY': 
        // Expecting positive deltaDist (moving away)
        logp += logGaussian(deltaDist, 1.2, 0.8); 
        // Broadly favor any distance once we start moving away
        logp += logGaussian(dist, 30, 40); 
        break;
      case 'RETURNING': 
        // Expecting negative deltaDist (approaching)
        logp += logGaussian(deltaDist, -1.2, 0.8); 
        // Sigmoid: favors being inside the threshold
        logp += logLogistic(threshold - dist, 0, steepness);
        break;
      case 'AWAY':
        // Sigmoid: favors being outside the threshold
        logp += logLogistic(dist - threshold, 0, steepness);
        break;
    }
  }


  // 5. Heading Change (degrees) - Purposeful vs Wandering
  if (['WALKING_AWAY', 'RETURNING', 'DRIVING'].includes(state)) {
    // Straight movement = low variance heading
    logp += logGaussian(headingChange, 0, 15);
  } else if (state === 'AWAY' || state === 'WALKING') {
    // Wandering = higher variance
    logp += logGaussian(headingChange, 30, 45);
  }

  // 6. Stop Duration Logic (Logistic transition from STOPPED to PARKED)
  if (state === 'PARKED') {
    logp += logLogistic(stopDuration, 120, 0.05); // Probability rises after 2 mins
  } else if (state === 'STOPPED') {
    logp += logLogistic(120 - stopDuration, 0, 0.05); // Probability falls after 2 mins
  }

  // 7. Activity Likelihood (Categorical)
  if (activity && ActivityLikelihood[activity]) {
    const likelihoods = ActivityLikelihood[activity];
    const weight = confidence === 'HIGH' ? 1.0 : (confidence === 'MEDIUM' ? 0.6 : 0.3);

    if (likelihoods[state]) {
      logp += Math.log(likelihoods[state] * weight + 0.01);
    } else {
      logp += Math.log(0.01); // Penalty for mismatched activity
    }
  }

  return logp;
}

let belief = {};
for (const s of STATES) belief[s] = s === 'IDLE' ? 1.0 : 0.0;

let currentState = 'IDLE';
let lastActivityType = 'UNKNOWN';
let lastConfidence = 'LOW';
let MotionActivity = null;

export function initMotionTracking() {
  const { Platform } = require('react-native');
  if (Platform.OS === 'web') return;

  try {
    if (!MotionActivity) {
      MotionActivity = require('react-native-motion-activity-tracker');
    }

    if (MotionActivity && typeof MotionActivity.startTracking === 'function') {
      MotionActivity.startTracking();
      MotionActivity.addMotionStateChangeListener((event) => {
        if (event && event.activityType) {
          lastActivityType = event.activityType;
          lastConfidence = event.confidence;
        }
      });
      console.log('[HMM] Native Motion Tracking initialized.');
    }
  } catch (error) {
    console.warn('[HMM] Motion tracking failed to start:', error.message);
  }
}

export async function processLocationHMM(location, parkedLocation, supplemental = {}) {
  // Sanitize Inputs
  const rawSpeed = location.coords.speed || 0;
  const speed = !isNaN(rawSpeed) ? Math.max(0, rawSpeed) * 3.6 : 0; // km/h
  
  const effectiveParkedLoc = parkedLocation || {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude
  };
  
  const distToParked = getDistance(location.coords, effectiveParkedLoc) || 0;
  const lastDist = supplemental.lastDistanceToCar;
  const deltaDist = (lastDist !== null && !isNaN(lastDist)) ? (distToParked - lastDist) : 0;

  const obs = {
    speed: isFinite(speed) ? speed : 0,
    accel: isFinite(supplemental.acceleration_magnitude) ? supplemental.acceleration_magnitude : 1.0,
    steps: isFinite(supplemental.step_rate) ? supplemental.step_rate : 0,
    dist: isFinite(distToParked) ? distToParked : 0,
    deltaDist: isFinite(deltaDist) ? deltaDist : 0,
    headingChange: isFinite(supplemental.heading_change) ? supplemental.heading_change : 0,
    stopDuration: isFinite(supplemental.stop_duration) ? supplemental.stop_duration : 0,
    activity: lastActivityType || 'UNKNOWN',
    confidence: lastConfidence || 'LOW'
  };
  
  console.log('[HMM] Validated Obs Vector:', JSON.stringify(obs));

  const newBelief = updateBelief(belief, obs);
  const result = stableStateUpdate(newBelief); 

  return { ...result, belief: newBelief, distToParked }; 
}

export function updateBelief(prevBelief, obs) {
  const logBeliefs = {};
  let maxLog = -Infinity;

  // 1. Calculate log-beliefs
  for (const s of STATES) {
    let transitionProb = 0;
    for (const sp of STATES) {
      const p = prevBelief[sp] || (sp === 'IDLE' ? 1.0 : 0.0);
      transitionProb += p * ((A[sp]?.[s]) || 0); // Strictly use matrix
    }
    
    const logEmission = emissionLogProb(s, obs);
    const lb = Math.log(transitionProb + 1e-10) + logEmission;
    logBeliefs[s] = isFinite(lb) ? lb : -1000; // Cap at a very low number instead of -Infinity
    
    if (logBeliefs[s] > maxLog) maxLog = logBeliefs[s];
  }

  // 2. Log-Sum-Exp Trick
  const newBelief = {};
  let sumExp = 0;

  // If all states are impossible, reset to IDLE
  if (maxLog === -Infinity || isNaN(maxLog)) {
    console.warn('[HMM] Numerical instability detected, resetting belief to IDLE');
    for (const s of STATES) newBelief[s] = s === 'IDLE' ? 1.0 : 0.0;
    return newBelief;
  }

  for (const s of STATES) {
    newBelief[s] = Math.exp(logBeliefs[s] - maxLog);
    sumExp += newBelief[s];
  }

  // Final normalization
  for (const s of STATES) {
    newBelief[s] /= (sumExp || 1);
  }

  return newBelief;
}

export function stableStateUpdate(newBelief) {
  const sorted = Object.entries(newBelief).sort((a, b) => b[1] - a[1]);
  const bestState = sorted[0][0];
  const confidence = sorted[0][1];
  const secondBestState = sorted[1] ? sorted[1][0] : null;
  const secondConfidence = sorted[1] ? sorted[1][1] : 0;

  // Dynamic Confidence threshold for state transition
  // Make IDLE -> WALKING responsive but not 'too soon'
  const threshold = (currentState === 'IDLE' && bestState === 'WALKING') ? 0.45 : 0.55;

  if (bestState !== currentState && confidence > threshold) {
    currentState = bestState;
    console.log(`[HMM] State updated to: ${currentState} (Confidence: ${confidence.toFixed(4)})`);
  }

  belief = newBelief; 
  return { 
    state: currentState, 
    bestState, 
    confidence, 
    secondBestState, 
    secondConfidence 
  }; 
}

function getDistance(a, b) {
  if (!a || !b) return 0;
  const R = 6371e3;
  const φ1 = a.latitude * Math.PI / 180, φ2 = b.latitude * Math.PI / 180;
  const Δφ = (b.latitude - a.latitude) * Math.PI / 180, Δλ = (b.longitude - a.longitude) * Math.PI / 180;
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

export const getHMMStatus = () => ({ currentState, belief });
export const resetHMM = () => {
  currentState = 'IDLE';
  belief = {};
  for (const s of STATES) belief[s] = s === 'IDLE' ? 1.0 : 0.0;
  console.log('[HMM] HMM Reset to IDLE state.');
};

