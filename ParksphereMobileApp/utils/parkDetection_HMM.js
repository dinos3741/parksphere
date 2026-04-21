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
  IDLE: { IDLE: 0.8, WALKING: 0.15, DRIVING: 0.05 },
  WALKING: { WALKING: 0.8, IDLE: 0.1, IN_CAR: 0.1 },
  DRIVING: { DRIVING: 0.85, STOPPED: 0.14, PARKED: 0.01 },
  STOPPED: { DRIVING: 0.4, STOPPED: 0.4, PARKED: 0.2 },
  PARKED: { PARKED: 0.7, WALKING_AWAY: 0.25, AWAY: 0.05 },
  WALKING_AWAY: { WALKING_AWAY: 0.6, AWAY: 0.4 },
  AWAY: { AWAY: 0.8, RETURNING: 0.2 },
  RETURNING: { RETURNING: 0.6, IN_CAR: 0.2, AWAY: 0.2 },
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
    case 'IDLE': logp += logGaussian(speed, 0, 0.5); break;
    case 'DRIVING': logp += logGaussian(speed, 40, 15); break;
    case 'STOPPED': logp += logGaussian(speed, 0.3, 0.7); break;
    case 'PARKED': logp += logGaussian(speed, 0.2, 0.4); break;
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
      logp += (state === 'DRIVING' || state === 'STOPPED') ? Math.log(1 + 2.5 * w) : Math.log(0.001);
    } else if (['WALKING', 'RUNNING'].includes(apple_activity)) {
      logp += ['WALKING', 'WALKING_AWAY', 'RETURNING', 'AWAY'].includes(state) ? Math.log(1 + 2.0 * w) : Math.log(0.01);
    } else if (apple_activity === 'STATIONARY') {
      if (['IDLE', 'STOPPED', 'PARKED', 'IN_CAR'].includes(state)) logp += Math.log(1 + 1.0 * w);
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

  const newBelief = updateBelief(belief, obs);
  const newState = stableStateUpdate(newBelief);

  return { state: newState, belief: newBelief, obs };
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
  const best = sorted[0][0];
  const confidence = sorted[0][1];

  if (best !== currentState && confidence > 0.85) {
    currentState = best;
  }
  belief = newBelief;
  return currentState;
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
};
