import { DeviceEventEmitter, Platform } from 'react-native';

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
  IDLE: { IDLE: 0.745, WALKING: 0.2, DRIVING: 0.05, PARKED: 0.005 },
  WALKING: { WALKING: 0.8, IDLE: 0.15, IN_CAR: 0.01, RETURNING: 0.04 },
  DRIVING: { DRIVING: 0.85, STOPPED: 0.12, PARKED: 0.03 },
  STOPPED: { DRIVING: 0.2, STOPPED: 0.4, PARKED: 0.2, WALKING_AWAY: 0.2 }, // Reduced PARKED, increased STOPPED
  PARKED: { PARKED: 0.6, WALKING_AWAY: 0.25, AWAY: 0.05, DRIVING: 0.05, STOPPED: 0.05 },
  WALKING_AWAY: { WALKING_AWAY: 0.7, AWAY: 0.3 },
  AWAY: { AWAY: 0.8, RETURNING: 0.2 },
  RETURNING: { RETURNING: 0.7, IN_CAR: 0.2, AWAY: 0.1 },
  IN_CAR: { DRIVING: 0.7, STOPPED: 0.3 }
};

function logGaussian(x, mean, std) {
  const s = Math.max(std, 0.01);
  const variance = s * s;
  return -((x - mean) ** 2) / (2 * variance) + Math.log(1 / (Math.sqrt(2 * Math.PI) * s));
}

export function emissionLogProb(state, obs) {
  const { speed, distToParked, apple_activity, apple_confidence } = obs;
  let logp = 0;

  // Speed Models
  switch (state) {
    case 'IDLE':
    case 'STOPPED':
    case 'PARKED': logp += logGaussian(speed, 0, 1.0); break; // Standardized stationary model
    case 'DRIVING': logp += logGaussian(speed, 40, 15); break;
    case 'WALKING':
    case 'WALKING_AWAY':
    case 'RETURNING': logp += logGaussian(speed, 4.5, 1.5); break;
    case 'AWAY': logp += logGaussian(speed, 2, 5); break;
    case 'IN_CAR': logp += logGaussian(speed, 1.5, 2); break;
  }

  // Distance Models
  if (distToParked !== null) {
    switch (state) {
      case 'PARKED':
      case 'IN_CAR': logp += logGaussian(distToParked, 2, 5); break;
      case 'WALKING_AWAY': logp += logGaussian(distToParked, 30, 20); break;
      case 'RETURNING': logp += logGaussian(distToParked, 15, 15); break;
      case 'AWAY': logp += logGaussian(distToParked, 100, 50); break;
    }
  }

  // Activity Logic
  if (apple_activity && apple_activity !== 'UNKNOWN') {
    const w = apple_confidence === 'HIGH' ? 1.0 : (apple_confidence === 'MEDIUM' ? 0.5 : 0.2);
    if (apple_activity === 'AUTOMOTIVE') {
      logp += (state === 'DRIVING' || state === 'STOPPED' || state === 'IN_CAR') ? Math.log(1 + 3.0 * w) : Math.log(0.001);
    } else if (['WALKING', 'RUNNING'].includes(apple_activity)) {
      // If speed is very low, it's likely shaking or jitter, not actual walking
      const isSpeedWalking = speed > 2.0;
      if (['WALKING', 'WALKING_AWAY', 'RETURNING', 'AWAY'].includes(state)) {
        logp += isSpeedWalking ? Math.log(1 + 2.5 * w) : Math.log(1 + 0.5 * w);
      } else {
        // Less penalty if speed is low, allowing IDLE/STOPPED/PARKED to stay active
        logp += isSpeedWalking ? Math.log(0.01) : Math.log(0.1);
      }
    } else if (apple_activity === 'STATIONARY') {
      // Heavily favor PARKED, IDLE, or STOPPED when stationary
      if (['PARKED', 'IDLE', 'STOPPED'].includes(state)) logp += Math.log(1 + 4.0 * w);
      else logp += Math.log(0.01);
    }
  }

  return logp;
}

let belief = {};
for (const s of STATES) belief[s] = s === 'IDLE' ? 1.0 : 0.0;

let currentState = 'IDLE';
let lastActivityType = 'UNKNOWN';
let lastConfidence = 'LOW';
let isTrackingAvailable = false;
let MotionActivity = null;

export function initMotionTracking() {
  if (Platform.OS === 'web') return;

  try {
    // Lazy load the module only when needed to avoid crash at startup
    if (!MotionActivity) {
      MotionActivity = require('react-native-motion-activity-tracker');
    }

    // Check if the native module is actually loaded and functional
    if (MotionActivity && typeof MotionActivity.startTracking === 'function') {
      MotionActivity.startTracking();
      MotionActivity.addMotionStateChangeListener((event) => {
        if (event && event.activityType) {
          lastActivityType = event.activityType;
          lastConfidence = event.confidence;
        }
      });
      isTrackingAvailable = true;
      console.log('[HMM] Native Motion Tracking initialized.');
    } else {
      console.warn('[HMM] MotionActivity native module not found. Are you in Expo Go?');
    }
  } catch (error) {
    console.warn('[HMM] Motion tracking failed to start. This is expected in Expo Go:', error.message);
  }
}

export function simulateMotionActivity(type, confidence) {
  lastActivityType = type;
  lastConfidence = confidence;
  console.log(`[HMM Simulation] Overriding activity to: ${type} (${confidence})`);
}

// Modified processLocationHMM to return belief, state, candidate and confidence
export async function processLocationHMM(location, parkedLocation) {
  // Ensure speed is not negative (invalid GPS data)
  const rawSpeed = location.coords.speed || 0;
  const speed = Math.max(0, rawSpeed) * 3.6; // km/h
  let distToParked = parkedLocation ? getDistance(location.coords, parkedLocation) : null;

  const obs = {
    speed,
    distToParked,
    apple_activity: lastActivityType,
    apple_confidence: lastConfidence
  };
  console.log('[HMM] Observed Data Vector:', obs); // Log observed data vector

  const newBelief = updateBelief(belief, obs);
  const { state: newState, bestState, confidence, secondBestState, secondConfidence } = stableStateUpdate(newBelief); 

  // Return the new state, best candidate, confidence and belief distribution
  return { state: newState, bestState, confidence, secondBestState, secondConfidence, belief: newBelief }; 
}

// Modified updateBelief to log newBelief
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

  console.log('[HMM] Belief Distribution:', newBelief); // Log belief distribution
  return newBelief;
}

// Modified stableStateUpdate to return state, top two candidates and confidences
export function stableStateUpdate(newBelief) {
  const sorted = Object.entries(newBelief).sort((a, b) => b[1] - a[1]);
  const bestState = sorted[0][0];
  const confidence = sorted[0][1];
  const secondBestState = sorted[1] ? sorted[1][0] : null;
  const secondConfidence = sorted[1] ? sorted[1][1] : 0;

  console.log(`[HMM] Best State Candidate: ${bestState} (${confidence.toFixed(4)}), Second: ${secondBestState} (${secondConfidence.toFixed(4)})`);

  // Update currentState only if confidence is high enough and the best state is different from current
  if (bestState !== currentState && confidence > 0.70) {
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
  if (!a || !b) return Infinity;
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
