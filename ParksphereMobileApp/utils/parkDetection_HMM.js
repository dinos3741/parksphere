/**
 * Park Detection HMM
 * Infers the user's state (DRIVING, PARKED, etc.) using a Hidden Markov Model
 * based on speed, distance to parked location, and Apple Motion Activity.
 */

export const STATES = [
  'IDLE',
  'WALKING',
  'DRIVING',
  'STOPPED',
  'PARKED',
  'WALKING_AWAY',
  'AWAY',
  'RETURNING',
  'IN_CAR'
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

/**
 * Utility for Gaussian log-probability
 */
function logGaussian(x, mean, std) {
  const s = Math.max(std, 0.01); // avoid division by zero
  const variance = s * s;
  const term1 = -((x - mean) ** 2) / (2 * variance);
  const term2 = Math.log(1 / (Math.sqrt(2 * Math.PI) * s));
  return term1 + term2;
}

/**
 * Calculates the log-emission probability P(Observation | State)
 */
export function emissionLogProb(state, obs) {
  const { speed, distToParked, apple_activity, apple_confidence } = obs;
  let logp = 0;

  // --- SPEED MODELS ---
  switch (state) {
    case 'IDLE':
      logp += logGaussian(speed, 0, 0.5);
      break;
    case 'DRIVING':
      logp += logGaussian(speed, 40, 15);
      break;
    case 'STOPPED':
      logp += logGaussian(speed, 0.3, 0.7);
      break;
    case 'PARKED':
      logp += logGaussian(speed, 0.2, 0.4);
      break;
    case 'WALKING':
    case 'WALKING_AWAY':
    case 'RETURNING':
      logp += logGaussian(speed, 4.5, 1.5);
      break;
    case 'AWAY':
      logp += logGaussian(speed, 2, 5); // Highly variable
      break;
    case 'IN_CAR':
      logp += logGaussian(speed, 1.5, 2);
      break;
  }

  // --- DISTANCE MODELS ---
  if (distToParked !== null && distToParked !== undefined) {
    switch (state) {
      case 'PARKED':
      case 'IN_CAR':
        logp += logGaussian(distToParked, 2, 5);
        break;
      case 'WALKING_AWAY':
        logp += logGaussian(distToParked, 30, 20);
        break;
      case 'RETURNING':
        logp += logGaussian(distToParked, 15, 15);
        break;
      case 'AWAY':
        logp += logGaussian(distToParked, 100, 50);
        break;
    }
  }

  // --- APPLE MOTION ACTIVITY ---
  if (apple_activity) {
    const w = apple_confidence === 'high' ? 1.0 : (apple_confidence === 'medium' ? 0.5 : 0.2);
    
    // AUTOMOTIVE
    if (apple_activity.automotive) {
      if (state === 'DRIVING' || state === 'STOPPED') {
        logp += Math.log(1 + 2.5 * w);
      } else {
        logp += Math.log(Math.max(0.001, 1 - 0.8 * w));
      }
    }

    // WALKING / RUNNING
    if (apple_activity.walking || apple_activity.running) {
      if (['WALKING', 'WALKING_AWAY', 'RETURNING', 'AWAY'].includes(state)) {
        logp += Math.log(1 + 2.0 * w);
      } else {
        logp += Math.log(Math.max(0.001, 1 - 0.6 * w));
      }
    }

    // STATIONARY
    if (apple_activity.stationary) {
      if (['IDLE', 'STOPPED', 'PARKED', 'IN_CAR'].includes(state)) {
        logp += Math.log(1 + 1.0 * w);
      }
    }
  }

  return logp;
}

// Internal State
let belief = {};
for (const s of STATES) {
  belief[s] = s === 'IDLE' ? 1.0 : 0.0;
}

let currentState = 'IDLE';

/**
 * Updates the belief vector based on a new observation (Forward Algorithm)
 */
export function updateBelief(prevBelief, obs) {
  const newBelief = {};

  for (const s of STATES) {
    let sum = 0;
    for (const sp of STATES) {
      const transition = (A[sp]?.[s]) || 0.0001;
      sum += prevBelief[sp] * transition;
    }

    const emission = Math.exp(emissionLogProb(s, obs));
    newBelief[s] = sum * emission;
  }

  // Normalize
  const total = Object.values(newBelief).reduce((a, b) => a + b, 0);
  for (const s of STATES) {
    newBelief[s] /= total || 1;
  }

  return newBelief;
}

/**
 * Returns the state with the highest probability
 */
export function getMostLikelyState(beliefVector) {
  return Object.entries(beliefVector)
    .sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Updates the current stable state with hysteresis
 */
export function stableStateUpdate(newBelief) {
  const best = getMostLikelyState(newBelief);
  const confidence = newBelief[best];

  // Only switch state if confidence is significantly high to avoid flickering
  if (best !== currentState && confidence > 0.85) {
    currentState = best;
  }

  belief = newBelief;
  return currentState;
}

export const getHMMStatus = () => ({
  currentState,
  belief
});

export const resetHMM = () => {
  currentState = 'IDLE';
  belief = {};
  for (const s of STATES) {
    belief[s] = s === 'IDLE' ? 1.0 : 0.0;
  }
};
