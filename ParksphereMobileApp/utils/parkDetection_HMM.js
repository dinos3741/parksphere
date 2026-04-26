/**
 * Park Detection HMM
 * Infers the user's state (DRIVING, PARKED, etc.) using a Hidden Markov Model
 */

export const STATES = [
  'IDLE', 'WALKING', 'DRIVING', 'STOPPED', 'PARKED',
  'WALKING_AWAY', 'AWAY', 'RETURNING', 'IN_CAR'
];

// Transition Matrix A[from][to]
// Refined for more realistic transitions and stability
export const A = {
  IDLE: { IDLE: 0.7, WALKING: 0.15, DRIVING: 0.1, PARKED: 0.05 },
  WALKING: { WALKING: 0.8, IDLE: 0.1, RETURNING: 0.05, WALKING_AWAY: 0.05 },
  DRIVING: { DRIVING: 0.85, STOPPED: 0.1, PARKED: 0.05 },
  STOPPED: { STOPPED: 0.5, DRIVING: 0.2, PARKED: 0.2, IN_CAR: 0.1 },
  PARKED: { PARKED: 0.7, WALKING_AWAY: 0.15, STOPPED: 0.05, IN_CAR: 0.1 },
  WALKING_AWAY: { WALKING_AWAY: 0.8, AWAY: 0.15, RETURNING: 0.05 },
  AWAY: { AWAY: 0.9, RETURNING: 0.1 },
  RETURNING: { RETURNING: 0.8, IN_CAR: 0.15, AWAY: 0.05 },
  IN_CAR: { IN_CAR: 0.5, DRIVING: 0.3, STOPPED: 0.2 }
};

// Activity Likelihood Table: P(Activity | State)
const ActivityLikelihood = {
  AUTOMOTIVE: { DRIVING: 0.7, STOPPED: 0.1, IN_CAR: 0.2 },
  WALKING: { WALKING: 0.3, WALKING_AWAY: 0.25, RETURNING: 0.25, AWAY: 0.2 },
  RUNNING: { WALKING: 0.3, WALKING_AWAY: 0.25, RETURNING: 0.25, AWAY: 0.2 },
  STATIONARY: { PARKED: 0.35, IDLE: 0.25, STOPPED: 0.2, IN_CAR: 0.15, AWAY: 0.05 },
  CYCLING: { DRIVING: 0.5, WALKING: 0.5 } // Ambiguous, split weight
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
    logp += isWalkingState ? Math.log(0.9) : Math.log(0.01);
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
  const rawSpeed = location.coords.speed || 0;
  const speed = Math.max(0, rawSpeed) * 3.6; // km/h

  // Use parked location or current location as fallback if we haven't detected parking yet
  const effectiveParkedLoc = parkedLocation || {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude
  };

  const distToParked = getDistance(location.coords, effectiveParkedLoc);
  const deltaDist = supplemental.lastDistanceToCar !== null ? (distToParked - supplemental.lastDistanceToCar) : 0;

  const obs = {
    speed,
    accel: supplemental.acceleration_magnitude || 1.0,
    steps: supplemental.step_rate || 0,
    dist: distToParked,
    deltaDist: deltaDist,
    headingChange: supplemental.heading_change || 0,
    stopDuration: supplemental.stop_duration || 0,
    activity: lastActivityType,
    confidence: lastConfidence
  };

  console.log('[HMM] Observed Data Vector:', obs);

  const newBelief = updateBelief(belief, obs);
  const result = stableStateUpdate(newBelief); 

  return { ...result, belief: newBelief, distToParked }; 
}

export function updateBelief(prevBelief, obs) {
  const newBelief = {};
  for (const s of STATES) {
    let sum = 0;
    for (const sp of STATES) {
      sum += prevBelief[sp] * ((A[sp]?.[s]) || 0.0001);
    }
    newBelief[s] = sum * Math.exp(emissionLogProb(s, obs));
  }
  const total = Object.values(newBelief).reduce((a, b) => a + b, 0) || 1;
  for (const s of STATES) newBelief[s] /= total;

  return newBelief;
}

export function stableStateUpdate(newBelief) {
  const sorted = Object.entries(newBelief).sort((a, b) => b[1] - a[1]);
  const bestState = sorted[0][0];
  const confidence = sorted[0][1];
  const secondBestState = sorted[1] ? sorted[1][0] : null;
  const secondConfidence = sorted[1] ? sorted[1][1] : 0;

  // Confidence threshold for state transition
  if (bestState !== currentState && confidence > 0.65) {
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

