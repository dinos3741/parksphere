import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Accelerometer, Pedometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter, Platform } from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';

console.log('***************************************************');
console.log('🚀 [ParkDetection] ENGINE FILE LOADED - LOGS ACTIVE');
console.log('***************************************************');

import { initMotionTracking, processLocationHMM, resetHMM, getHMMStatus, resetPGRHistory } from './parkDetection_HMM';
import { logTelemetry } from './telemetryService';
import { apiRequest } from './apiService';
import { initAIEngine, predictReturning, resetAIBuffer } from './aiEngine';
import { extractSpectralFeatures } from './fftUtils'; // 🚀 NEW: Spectral Analysis

// 🚀 Dynamic Import for Native Motion Activity (prevents crash in Expo Go)
let MotionActivityTracker = null;
try {
  MotionActivityTracker = require('react-native-motion-activity-tracker');
  console.log('[ParkDetection] MotionActivityTracker module successfully required.');
} catch (e) {
  console.log('[ParkDetection] MotionActivityTracker native module NOT available:', e.message);
}

export const PARK_DETECTION_TASK = 'PARK_DETECTION_TASK';

// ---------------- CONSTANTS ----------------
const STORAGE_KEY = 'PARK_STATE';
let isInitialized = false;

// 🚀 TIMEOUT WRAPPER
const withTimeout = (promise, ms, name = 'unnamed') => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`[Timeout] ${name} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
};

// Sensor data cache
let currentAcceleration = 1.0;
let lastAccelTimestamp = 0; // 🚀 Track stale accel data in background
let currentStepRate = 0;
let lastStepTimestamp = 0; // 🚀 Added to track Fast-Path steps
let lastReportedSteps = 0; // 🚀 ADD THIS NEW VARIABLE
let currentActivity = { state: 'unknown', automotive: false, walking: false, stationary: false, unknown: true, confidence: 0 };
let accelSubscription = null;
let pedometerSubscription = null; // 🚀 Added to keep listener alive
let isPedometerAvailable = null;

// 🚀 NEW: Spectral (FFT) Window State
let spectralBuffer = [];
const SPECTRAL_WINDOW_SIZE = 128; // Power of 2 for FFT
const SAMPLE_RATE_HZ = 50;
let currentSpectralFeatures = {
  walkingEnergy: 0,
  vehicleEnergy: 0,
  spectralEntropy: 0,
  dominantFreq: 0
};

export function simulateMotionActivity(type, intensity = 'HIGH') {
  console.log(`[ParkDetection] Simulating activity: ${type} (${intensity})`);

  if (type === 'AUTOMOTIVE') {
    currentAcceleration = 1.1 + (intensity === 'HIGH' ? 0.4 : 0.1);
    currentStepRate = 0;
    currentActivity = { automotive: true, walking: false, stationary: false, unknown: false, confidence: 2 };
  } else if (type === 'WALKING') {
    currentAcceleration = 1.1 + (intensity === 'HIGH' ? 0.2 : 0.05);
    currentStepRate = intensity === 'HIGH' ? 2.0 : 1.2;
    currentActivity = { automotive: false, walking: true, stationary: false, unknown: false, confidence: 2 };
  } else if (type === 'STATIONARY' || type === 'IDLE') {
    currentAcceleration = 1.0;
    currentStepRate = 0;
    currentActivity = { automotive: false, walking: false, stationary: true, unknown: false, confidence: 2 };
  } else {
    currentAcceleration = 1.0;
    currentStepRate = 0;
    currentActivity = { automotive: false, walking: false, stationary: false, unknown: true, confidence: 0 };
  }
}

// ---------------- HELPERS ----------------
async function checkPedometer() {
  if (isPedometerAvailable !== null) return isPedometerAvailable;
  try {
    isPedometerAvailable = await withTimeout(Pedometer.isAvailableAsync(), 2000, 'Pedometer.isAvailable');
  } catch (e) {
    console.warn('[ParkDetection] Pedometer availability check failed:', e.message);
    isPedometerAvailable = false;
  }
  return isPedometerAvailable;
}

async function getRecentStepRate() {
  try {
    const available = await checkPedometer();
    if (!available) return 0;

    // Look at the last 8 seconds
    const end = new Date();
    const start = new Date();
    start.setSeconds(end.getSeconds() - 8);

    const result = await withTimeout(Pedometer.getStepCountAsync(start, end), 3000, 'Pedometer.getStepCount');
    return (result.steps || 0) / 8.0; // steps per second
  } catch (error) {
    console.error('[ParkDetection] Error fetching step count:', error.message);
    return 0;
  }
}

// ---------------- HELPERS ----------------
async function declareSpot(location) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const userId = await AsyncStorage.getItem('userId');
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP || 'localhost'}:3001`;

    if (!token || !userId) {
      console.warn('[ParkDetection] User token or ID missing, cannot declare spot.');
      return;
    }

    const response = await withTimeout(apiRequest(`${serverUrl}/api/declare-spot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: parseInt(userId, 10),
        latitude: location.latitude,
        longitude: location.longitude,
        timeToLeave: 60,
        costType: 'free',
        price: 0,
        declaredCarType: 'sedan',
        comments: 'Auto-detected parking spot (HMM)',
        isAutoDetected: true,
      }),
    }), 5000, 'fetch.declareSpot');

    if (response.ok) {
      const data = await response.json();
      notify('Spot successfully registered in the system!');
      console.log('[ParkDetection] Declared spot successfully, spotId:', data.spotId);
      return data.spotId;
    } else {
      const errorBody = await response.text();
      console.error('[ParkDetection] Failed to declare spot:', response.status, errorBody);
      notify(`Failed to declare spot: ${response.status}`);
    }
  } catch (error) {
    console.error('[ParkDetection] Error declaring spot:', error.message);
    notify('Error declaring parking spot.');
  }
}

async function updateSpotStatus(spotId, status) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP || 'localhost'}:3001`;
    if (!token || !spotId) return;

    await withTimeout(apiRequest(`${serverUrl}/api/parkingspots/${spotId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    }), 5000, 'fetch.updateSpotStatus');
    console.log(`[ParkDetection] Updated spot ${spotId} status to: ${status}`);
  } catch (error) {
    console.error(`[ParkDetection] Failed to update spot ${spotId} status to ${status}:`, error.message);
  }
}

async function deleteSpot(spotId) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP || 'localhost'}:3001`;
    if (!token || !spotId) return;

    await withTimeout(apiRequest(`${serverUrl}/api/parkingspots/${spotId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }), 5000, 'fetch.deleteSpot');
    console.log(`[ParkDetection] Deleted spot ${spotId} from server.`);
  } catch (error) {
    console.error(`[ParkDetection] Error deleting spot ${spotId}:`, error.message);
  }
}

function notify(message, extraData = {}) {
  console.log(`[ParkDetection] ${message}`);
  DeviceEventEmitter.emit('parkDetectionUpdate', { message, ...extraData });
}

let lastVirtualUpdate = 0;
let isProcessing = false;

async function triggerVirtualUpdate() {
  if (!isInitialized || isProcessing) return;
  
  const now = Date.now();
  // 🚀 FIX: 2-second throttle to prevent AsyncStorage/Bridge flooding
  if (now - lastVirtualUpdate < 2000) return; 
  lastVirtualUpdate = now;
  isProcessing = true;

  try {
    // 🚀 Refresh step rate cache
    currentStepRate = await getRecentStepRate();

    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const stateData = saved ? JSON.parse(saved) : {};
    
    if (stateData.lastLocation) {
      console.log('[ParkDetection] ⚡ Triggering virtual HMM update from sensor fast-path.');
      
      // 🚀 FIX: If the phone is perfectly still, we must ensure we aren't 
      // accidentally reusing "simulated" walking/driving flags from the past.
      const isActuallyStill = Math.abs(currentAcceleration - 1.0) < 0.015;
      const virtualLocation = {
        ...stateData.lastLocation,
        isFromSimulator: stateData.lastLocation.isFromSimulator && !isActuallyStill
      };

      const updatedStateData = await handleLocationUpdate(stateData, virtualLocation);
      if (updatedStateData) {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedStateData));
      }
    }
  } catch (e) {
    console.error('[ParkDetection] Virtual update failed:', e.message);
  } finally {
    isProcessing = false;
  }
}

// ---------------- CORE ENGINE (HMM) ----------------
// 🚀 Store latest Bluetooth state as a module-level variable to be used in HMM calls
let lastBluetoothState = false;

// 🔒 SERIAL QUEUE: Prevents concurrent handleLocationUpdate calls from clobbering state
let updateQueue = Promise.resolve();

export async function handleLocationUpdate(arg1, arg2, isBluetoothUpdate = false) {
  return updateQueue = updateQueue.then(async () => {
    return _handleLocationUpdateInternal(arg1, arg2, isBluetoothUpdate);
  }).catch(e => {
    console.error('[ParkDetection] Queue Error:', e.message);
    return arg2 ? arg1 : {};
  });
}

async function _handleLocationUpdateInternal(arg1, arg2, isBluetoothUpdate = false) {
  if (!isInitialized && !isBluetoothUpdate) {
    return arg2 ? arg1 : {}; 
  }

  // 🚀 If this is a Bluetooth event, just update the state variable
  if (isBluetoothUpdate) {
    const prevState = lastBluetoothState;
    lastBluetoothState = arg1.bluetoothConnected;
    console.log(`[ParkDetection] Bluetooth state updated to: ${lastBluetoothState}`);
    
    // 🔔 Notify user on connection
    if (lastBluetoothState && !prevState) {
      notify('🚗 Connected to car Bluetooth');
      
      // 🚀 BLUETOOTH OVERRIDE: If we connected to our car, we are NOT away from it.
      // If we have a stale spot saved and we are moving, forcefully clear it.
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
           let stateData = JSON.parse(saved);
           if (stateData.parkedLocation && ['DRIVING', 'STOPPED'].includes(stateData.state)) {
              console.log('[ParkDetection] 🔄 Bluetooth Veto: Connected to car while active spot exists. Clearing stale spot...');
              
              if (stateData.serverSpotId && !String(stateData.serverSpotId).startsWith('local-')) {
                updateSpotStatus(stateData.serverSpotId, 'free').catch(e => console.error('BT Veto free failed', e));
              }
              
              stateData.parkingNotified = false;
              stateData.serverSpotId = null;
              stateData.parkedLocation = null;
              stateData.stoppedCandidateLocation = null;
              stateData.lastDistanceToCar = null;
              stateData.isAway = false; // We are definitively in our car
              stateData.vicinityNotified = false;
              stateData._loggedParkedLoc = false;
              stateData.soonFreeNotified = false;
              stateData.smoothedReturningConfidence = 0;
              stateData.returningNotified = false;
              
              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateData));
              notify('🏁 Spot cleared. Ready for next parking.', { clearParkedLocation: true });
              resetPGRHistory();
           }
        }
      } catch (e) {
        console.error('[ParkDetection] Bluetooth Veto check failed:', e.message);
      }
    }
    
    // 🚀 Emit UI update immediately so the blue dot appears without waiting for next GPS ping
    DeviceEventEmitter.emit('parkDetectionDetailedUpdate', {
      ...getHMMStatus(),
      metrics: {
        ...getHMMStatus().metrics,
        bluetoothConnected: lastBluetoothState
      }
    });
    
    return;
  }

  let stateData, location;
  let isInternal = false;

  try {
    if (arg2) { 
      stateData = arg1;
      location = arg2;
      isInternal = true;
    } else { 
      location = arg1;
      // 🚀 Refresh step rate for foreground updates
      currentStepRate = await getRecentStepRate();
      const saved = await withTimeout(AsyncStorage.getItem(STORAGE_KEY), 2000, 'AsyncStorage.getItem');
      stateData = saved ? JSON.parse(saved) : {};
    }
  } catch (e) {
    console.error('[ParkDetection] handleLocationUpdate early failure:', e.message);
    return isInternal ? arg1 : {};
  }

  const prevState = stateData.state || 'IDLE';
  const currentLoc = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };

  const now = Date.now();
  const speed = (location.coords.speed || 0) * 3.6; 
  
  const currentHeading = location.coords.heading || 0;
  let headingChange = 0;
  if (stateData.lastHeading !== undefined) {
    let diff = Math.abs(currentHeading - stateData.lastHeading);
    headingChange = diff > 180 ? 360 - diff : diff;
  }
  stateData.lastHeading = currentHeading;

  if (speed < 3.0) {
    if (!stateData.stopStartTime) {
      stateData.stopStartTime = now;
    }
    stateData.stopDuration = (now - stateData.stopStartTime) / 1000;
  } else {
    stateData.stopStartTime = null;
    stateData.stopDuration = 0;
  }

  let acceleration = currentAcceleration;
  let spectralFeats = { ...currentSpectralFeatures };

  if (Date.now() - lastAccelTimestamp > 5000) {
    // 🚀 BACKGROUND DEGRADATION: Accel stops firing in the background. 
    // We must pass null so the HMM doesn't falsely assume the phone is perfectly still.
    acceleration = null;
    spectralFeats = null;
  }

  let stepRate = 0;
  if (!location.isFromSimulator) {
    const timeSinceLastStep = Date.now() - lastStepTimestamp;
    
    if (timeSinceLastStep < 4000) {
      // 🚀 RESTORED REALISM: Use the actual reported rate instead of forcing 1.2.
      // This prevents minor car vibrations from "hijacking" the system into a WALKING state.
      stepRate = currentStepRate; 
      console.log(`[ParkDetection] 👟 Physical Step Activity: ${stepRate.toFixed(2)}`);
    } else if (timeSinceLastStep > 5000) {
      // 🚀 ANTI-LAG: If it has been more than 5 seconds since a physical step,
      // force stepRate to 0 to override Apple's 8-second trailing average.
      stepRate = 0;
      currentStepRate = 0;
    } else {
      stepRate = currentStepRate;
    }
  } else {
    stepRate = currentStepRate;
  }

  const hmmResult = processLocationHMM(location, stateData.parkedLocation, {
    acceleration_magnitude: acceleration,
    step_rate: stepRate,
    motion_activity: currentActivity,
    heading_change: headingChange,
    stop_duration: stateData.stopDuration,
    lastDistanceToCar: stateData.lastDistanceToCar,
    previousState: stateData.state,
    previousBelief: stateData.belief,
    isAway: stateData.isAway,
    isReturningIntentLocked: stateData.isReturningIntentLocked,
    minDistDuringReturn: stateData.minDistDuringReturn,
    accuracy: location.coords.accuracy,
    bluetoothConnected: lastBluetoothState, 
    // 🚀 NEW: Spectral Features for Frequency Domain Analysis
    spectralFeatures: spectralFeats,
    // Restore counters
    returnCounter: stateData.returnCounter,
    drivingCounter: stateData.drivingCounter,
    walkingCounter: stateData.walkingCounter,
    tripDrivingTime: stateData.tripDrivingTime,
    tripDrivingDistance: stateData.tripDrivingDistance,
    lastTripX: stateData.lastTripX,
    lastTripY: stateData.lastTripY,
    proximityCounter: stateData.proximityCounter,
    smoothedDeltaRate: stateData.smoothedDeltaRate,
    smoothedStepRate: stateData.smoothedStepRate
  });

  // 📡 Telemetry snapshot moved below to include AI returning confidence

  let {
    state: hmmState,
    bestState,
    confidence,
    secondBestState,
    secondConfidence,
    belief: currentBelief,
    distToParked,
    parkedEvent,
    awayEvent,
    clearParkingEvent,
    isAway: hmmIsAway,
    isReturningIntentLocked: hmmIsReturningIntentLocked,
    minDistDuringReturn: hmmMinDistDuringReturn,
    // Get counters for persistence
    returnCounter,
    drivingCounter,
    walkingCounter,
    tripDrivingTime,
    tripDrivingDistance,
    lastTripX,
    lastTripY,
    proximityCounter,
    smoothedDeltaRate,
    smoothedStepRate
  } = hmmResult;

  if (location.forcePark) {
    parkedEvent = true;
    hmmState = 'STOPPED'; 
  }

  stateData.lastDistanceToCar = distToParked;
  const isFirstUpdate = !stateData.lastUpdate;
  stateData.lastUpdate = now;
  stateData.lastLocation = location; // 🚀 Save for virtual updates
  stateData.state = hmmState;
  stateData.belief = currentBelief;
  stateData.isAway = hmmIsAway;
  stateData.isReturningIntentLocked = hmmIsReturningIntentLocked;
  stateData.minDistDuringReturn = hmmMinDistDuringReturn;
  
  // Persist counters
  stateData.returnCounter = returnCounter;
  stateData.drivingCounter = drivingCounter;
  stateData.walkingCounter = walkingCounter;
  stateData.tripDrivingTime = tripDrivingTime;
  stateData.tripDrivingDistance = tripDrivingDistance;
  stateData.lastTripX = lastTripX;
  stateData.lastTripY = lastTripY;
  stateData.proximityCounter = proximityCounter;
  stateData.smoothedDeltaRate = smoothedDeltaRate;
  stateData.smoothedStepRate = smoothedStepRate;

  if (awayEvent && !stateData.vicinityNotified) {
    stateData.vicinityNotified = true;
    notify('🚶 You have left the vicinity of your car.');
  }

  // ✅ CLEAR BEFORE PARK: If both events fire in the same frame (e.g. GPS lock acquired at new
  // location while STOPPED→WALKING also transitions), the clear must run first so that stale
  // candidate locations from the previous session are nulled before finalParkedLoc is computed.
  if (clearParkingEvent) {
    const spotIdToClear = stateData.serverSpotId;

    // 1. CLEAR LOCAL STATE FIRST (Ensures the app doesn't stay 'Parked' if network is slow)
    stateData.parkingNotified = false;
    stateData.serverSpotId = null;
    stateData.parkedLocation = null;
    stateData.stoppedCandidateLocation = null;
    stateData.lastDistanceToCar = null;
    stateData.isAway = false;
    stateData.vicinityNotified = false;
    stateData._loggedParkedLoc = false;
    stateData.soonFreeNotified = false;
    stateData.smoothedReturningConfidence = 0;
    stateData.returningNotified = false;
    resetPGRHistory();

    notify('🏁 Spot cleared. Ready for next parking.', { clearParkedLocation: true });

    // 2. TELL SERVER (Ordered await to ensure reliable sync)
    if (spotIdToClear && !String(spotIdToClear).startsWith('local-')) {
      console.log(`[ParkDetection] Attempting to free spot ${spotIdToClear} on server...`);
      await updateSpotStatus(spotIdToClear, 'free').catch(e => {
        console.error('[ParkDetection] Background server sync failed:', e.message);
      });
    }
  }

  if (parkedEvent) {
    if (stateData.parkedLocation && stateData.serverSpotId && !stateData.parkingNotified) {
       // This means we had an old spot stored, but we are parking AGAIN.
       // This happens if the app missed the departure (indoor GPS blackout).
       console.log(`[ParkDetection] 🔄 Stale spot detected during new park event. Deleting old spot ${stateData.serverSpotId}...`);
       if (!String(stateData.serverSpotId).startsWith('local-')) {
         updateSpotStatus(stateData.serverSpotId, 'free').catch(e => console.error('Stale override free failed', e));
       }
       // Reset the flags and candidates so the new spot uses the current location
       stateData.parkingNotified = false;
       stateData.soonFreeNotified = false;
       stateData.returningNotified = false;
       stateData.smoothedReturningConfidence = 0;
       stateData.stoppedCandidateLocation = null;
       resetPGRHistory();
    }

    if (!stateData.parkingNotified) {
      const finalParkedLoc = location.forcePark ? currentLoc : (stateData.stoppedCandidateLocation || currentLoc);

      stateData.stoppedCandidateLocation = null;

      const spotId = await declareSpot(finalParkedLoc);

      stateData.parkedLocation = finalParkedLoc;
      stateData.serverSpotId = spotId || `local-${Date.now()}`;
      stateData.parkingNotified = true;
      stateData.isAway = false;

      notify('🅿️ Parking confirmed!', { parkedLocation: finalParkedLoc });
    }
  }

  if (stateData.state === 'DRIVING' && stateData.stoppedCandidateLocation) {
    stateData.stoppedCandidateLocation = null;
  }

  if (stateData.state === 'STOPPED') {
    const currentAccuracy = location.coords.accuracy ?? Infinity;
    const savedAccuracy = stateData.stoppedCandidateLocation?.accuracy ?? Infinity;
    if (currentAccuracy < savedAccuracy) {
      stateData.stoppedCandidateLocation = { latitude: location.coords.latitude, longitude: location.coords.longitude, accuracy: currentAccuracy };
    }
  }

  const aiFeatures = {
    speed,
    stepRate,
    accel: acceleration,
    pgr: hmmResult.pgr || 0,
    pgrSlope: hmmResult.slope || 0,
    approachAlignment: hmmResult.approachAlignment || 0,
    deltaRate: hmmResult.deltaRate || 0
  };

  const aiConfidence = await predictReturning(aiFeatures);

  // ==============================
  // 🚀 UNIFIED RETURNING CONFIDENCE (FUSION)
  // ==============================
  // Combine HMM (Holistic), CNN (Pattern), and PGR Alignment (Intent) 
  let rawReturningConfidence = 0;

  if (stateData.isAway && stateData.parkedLocation && distToParked < 100) {
    const hmmBelief = currentBelief['RETURNING'] || 0;
    const aiConf = aiConfidence || 0;
    const pgrNorm = Math.max(0, hmmResult.approachAlignment || 0); // 0 to 1

    // Weighted Fusion: 40% HMM, 40% AI, 20% raw Alignment
    rawReturningConfidence = (hmmBelief * 0.4) + (aiConf * 0.4) + (pgrNorm * 0.2);
    
    if (isNaN(rawReturningConfidence)) rawReturningConfidence = 0;
  }

  // 🚀 EMA SMOOTHING
  // Alpha = 0.2 means 20% current reading, 80% historical memory.
  // This acts as a heavy flywheel, eliminating GPS/AI frame jitter.
  const ALPHA = 0.2;
  const prevSmoothed = stateData.smoothedReturningConfidence || 0;
  const overallReturningConfidence = (ALPHA * rawReturningConfidence) + ((1 - ALPHA) * prevSmoothed);

  stateData.smoothedReturningConfidence = overallReturningConfidence;

  // Trigger 'Soon Free' based on Unified Confidence Agreement (>85%)
  if (overallReturningConfidence > 0.85 && stateData.serverSpotId && !stateData.soonFreeNotified) {
    console.log(`[ParkDetection] 🎯 UNIFIED RETURN CONFIRMED: ${(overallReturningConfidence * 100).toFixed(2)}% -> Triggering Soon Free`);
    updateSpotStatus(stateData.serverSpotId, 'soon_free').catch(e => {});
    stateData.soonFreeNotified = true;
    // Removed notification - too noisy for production
  }

  // 📡 Telemetry: Record snapshot for offline analysis, including AI confidence
  logTelemetry({
    speed: location.coords.speed,
    stepRate: stepRate,
    accel: acceleration,
    accuracy: location.coords.accuracy,
    bluetoothConnected: lastBluetoothState,
    activity: currentActivity,
    spectralFeatures: spectralFeats 
  }, hmmResult, aiConfidence, overallReturningConfidence);

  if (stateData.state !== prevState || isFirstUpdate) {
    const messages = {
      'DRIVING': '🚗 Driving detected...',
      'WALKING': '🚶 Walking detected...',
      'STOPPED': '⏱️ Vehicle stopped...',
      'IDLE': '💤 System Idle.'
    };

    // 🚀 Gate the RETURNING notification behind the unified fusion threshold
    if (stateData.state === 'RETURNING') {
      // Do nothing here, we handle it continuously below
    } else {
      notify(messages[stateData.state] || `System State: ${stateData.state}`, { confidence: Math.round(confidence * 100) });
      stateData.returningNotified = false; // Reset when we leave RETURNING
    }

    if (stateData.state === 'RETURNING' && stateData.serverSpotId) {
      if (!stateData.soonFreeNotified) {
        updateSpotStatus(stateData.serverSpotId, 'soon_free').catch(e => {});
        stateData.soonFreeNotified = true;
      }
    }
  }

  // 🚀 CONTINUOUS RETURNING NOTIFICATION CHECK
  if (stateData.state === 'RETURNING' && overallReturningConfidence > 0.85 && !stateData.returningNotified) {
    notify('📍 Approaching vehicle...', { confidence: Math.round(overallReturningConfidence * 100) });
    stateData.returningNotified = true;
  }

  DeviceEventEmitter.emit('parkDetectionDetailedUpdate', {
    state: stateData.state,
    bestState,
    confidence,
    secondBestState,
    secondConfidence,
    belief: currentBelief,
    location: currentLoc,
    returningConfidence: overallReturningConfidence, // 🚀 NEW: Unified Metric
    metrics: {
      speed,
      acceleration,
      stepRate, // 🚀 Uses the boosted Fast-Path rate
      motionActivity: currentActivity,
      headingChange,
      stopDuration: stateData.stopDuration,
      distToParked,
      bluetoothConnected: lastBluetoothState
    }
  });

  if (!isInternal) {
    try {
      await withTimeout(AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateData)), 2000, 'AsyncStorage.setItem');
    } catch (e) {
      console.error('[ParkDetection] Failed to save state to storage:', e.message);
    }
  }

  return stateData; 
}

// ---------------- SENSORS ----------------
async function startSensors() {
  // 🚀 FFT PREP: Increase frequency to 50Hz (20ms) for high-res spectral analysis
  Accelerometer.setUpdateInterval(20); 
  accelSubscription = Accelerometer.addListener(data => {
    // 1. Calculate magnitude for HMM fast-path logic
    const mag = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
    currentAcceleration = mag;
    lastAccelTimestamp = Date.now();

    // 2. 🚀 FFT SLIDING WINDOW
    spectralBuffer.push(mag);
    if (spectralBuffer.length >= SPECTRAL_WINDOW_SIZE) {
      // Extract features from the latest window
      currentSpectralFeatures = extractSpectralFeatures(spectralBuffer, SAMPLE_RATE_HZ);
      
      // Slide window by 25% (32 samples) for 0.6s overlap
      spectralBuffer = spectralBuffer.slice(32);
    }
    
    // ⚡ FAST-PATH: If we see a sudden burst of movement while IDLE, trigger HMM check
    if (currentAcceleration > 1.6 && isInitialized && getHMMStatus().currentState === 'IDLE') {
       triggerVirtualUpdate();
    }
  });

  // ⚡ FAST-PATH: Direct Pedometer Listener
  try {
    const isPedometerAvailable = await Pedometer.isAvailableAsync();
    if (isPedometerAvailable) {
      console.log('[ParkDetection] Starting Pedometer Watch...');
      lastReportedSteps = 0; // Reset counter on start
      
      pedometerSubscription = Pedometer.watchStepCount(result => {
        // 🚀 FIX: The Foreground-Resume Guard
        // We only trigger if the cumulative step count actually went UP.
        // This ignores React Native's flush/resume pings when the phone is stationary.
        if (result.steps > lastReportedSteps && isInitialized) {
          lastReportedSteps = result.steps;
          console.log(`[ParkDetection] 👣 PHYSICAL STEP DETECTED! Total since start: ${result.steps}`);
          lastStepTimestamp = Date.now(); 
          triggerVirtualUpdate();
        } 
        // Catch OS resets (if Expo resets the watcher count to 0 in the background)
        else if (result.steps < lastReportedSteps) {
          lastReportedSteps = result.steps;
          if (result.steps > 0 && isInitialized) {
            lastStepTimestamp = Date.now();
            triggerVirtualUpdate();
          }
        }
      });
    }
  } catch (e) {
    console.warn('[ParkDetection] Pedometer watch failed:', e.message);
  }

  console.log('[ParkDetection] Initializing Motion Activity Tracker...');
  try {
    if (MotionActivityTracker) {
      console.log('[ParkDetection] MotionActivityTracker available. Methods:', Object.keys(MotionActivityTracker));
      
      if (typeof MotionActivityTracker.getPermissionStatusAsync === 'function') {
        const authStatus = await MotionActivityTracker.getPermissionStatusAsync();
        console.log('[ParkDetection] Motion Activity Authorization status:', authStatus);
      }
      
      if (typeof MotionActivityTracker.addMotionStateChangeListener === 'function') {
        MotionActivityTracker.addMotionStateChangeListener(async (activity) => {
          if (activity) {
            const state = activity.state || 'unknown';
            const confidence = activity.confidence !== undefined ? activity.confidence : 1;
            const prevState = currentActivity.state;
            
            currentActivity = {
              state: state,
              automotive: state === 'automotive',
              walking: state === 'walking' || state === 'running',
              stationary: state === 'stationary',
              unknown: state === 'unknown',
              confidence: confidence
            };

            console.log(`[ParkDetection] RECEIVED Activity: state=${state}, conf=${confidence}`);

            if (state !== prevState && isInitialized) {
              console.log(`[ParkDetection] Activity changed from ${prevState} to ${state}.`);
              triggerVirtualUpdate();
            }
          }
        });
      }

      if (typeof MotionActivityTracker.startTracking === 'function') {
        console.log('[ParkDetection] Starting Motion Activity updates...');
        await MotionActivityTracker.startTracking();
      } else {
        console.warn('[ParkDetection] startTracking method NOT found on MotionActivityTracker.');
      }
    } else {
      console.warn('[ParkDetection] MotionActivityTracker native module is null/undefined.');
    }
  } catch (e) {
    console.error('[ParkDetection] CRITICAL Error starting MotionActivityTracker:', e);
  }

  // 🚀 FIX: Initial Bluetooth State Capture (Android Only)
  if (Platform.OS === 'android' && RNBluetoothClassic) {
    try {
      const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
      const isCarConnected = connectedDevices.some(device => {
        const name = (device.name || '').toLowerCase();
        return name.includes('car') || name.includes('audio') || name.includes('hands-free');
      });
      lastBluetoothState = isCarConnected;
      console.log(`[ParkDetection] Initial Bluetooth state: ${lastBluetoothState}`);
    } catch (err) {
      console.warn('[ParkDetection] Failed to get initial BT state:', err.message);
    }
  }
}

function stopSensors() {
  if (accelSubscription) accelSubscription.remove();
  accelSubscription = null;
  
  if (pedometerSubscription) pedometerSubscription.remove();
  pedometerSubscription = null;
  
  if (MotionActivityTracker && typeof MotionActivityTracker.stopTracking === 'function') {
    MotionActivityTracker.stopTracking();
  }
}

// ---------------- TASK ----------------
TaskManager.defineTask(PARK_DETECTION_TASK, async ({ data, error }) => {
  if (error) {
    console.error(`[ParkDetection] Task Error: ${error.message}`);
    return;
  }
  if (!data || !data.locations) {
    console.warn('[ParkDetection] Received task data without locations.');
    return;
  }

  // 🚀 SHARED MUTEX: Prevent clobbering state if a virtual update is running
  if (isProcessing) {
    console.warn('[ParkDetection] TaskManager update skipped — processing in progress.');
    return;
  }
  isProcessing = true;

  try {
    if (!isInitialized) {
      console.log('[ParkDetection] Engine woke up in background. Initializing...');
      isInitialized = true;
      await initAIEngine();
      await startSensors();
    }

    // 🚀 OPTIMIZATION: Fetch step rate once for the entire batch
    currentStepRate = await getRecentStepRate();

    let stateData = null;
    try {
      const saved = await withTimeout(AsyncStorage.getItem(STORAGE_KEY), 2000, 'TaskManager.getItem');
      if (saved) stateData = JSON.parse(saved);
      else stateData = {};
    } catch (e) {
      console.error('[ParkDetection] Failed to load state from storage in TaskManager:', e.message);
      // 🚀 CRITICAL FIX: If storage fails to load, abort to prevent overwriting with {} and losing parkedLocation
      return;
    }

    for (const loc of data.locations) {
      // Pass the current stateData to handleLocationUpdate for sequential processing
      stateData = await handleLocationUpdate(stateData, loc);
    }

    try {
      await withTimeout(AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateData)), 2000, 'TaskManager.setItem');
    } catch (e) {
      console.error('[ParkDetection] Failed to save state to storage in TaskManager:', e.message);
    }
  } finally {
    isProcessing = false;
  }
});

export const isDetectionEngineRunning = () => isInitialized;

// ---------------- START/STOP ----------------
export const startParkDetection = async () => {
  try {
    console.log('[ParkDetection] Attempting to start park detection...');
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      notify('Foreground location permission denied.');
      return false;
    }
    console.log('[ParkDetection] Foreground location permissions granted.');

    // We can consider the system "initialized" for simulation and foreground tracking
    // even before background permissions are fully resolved.
    isInitialized = true;

    try {
      console.log('[ParkDetection] Requesting background location permissions...');
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        notify('Background location permission denied. HMM will work only in foreground.');
        console.warn('[ParkDetection] Background location permission denied.');
      } else {
        console.log('[ParkDetection] Background location permissions granted.');
      }
    } catch (bgError) {
      console.error('[ParkDetection] Error requesting background permissions:', bgError);
    }

    console.log('[ParkDetection] Initializing HMM components...');
    
    // 🚀 FIX: Load persisted state immediately before starting HMM/Sensors
    // This ensures parkedLocation is available even if handleLocationUpdate 
    // is called by a background task before the UI can pass it in.
    const saved = await withTimeout(AsyncStorage.getItem(STORAGE_KEY), 2000, 'startParkDetection.getItem');
    if (saved) {
       console.log('[ParkDetection] Found persisted state during startup. Restoring...');
       // No-op here, as handleLocationUpdate will load it on its first run if arg2 is null.
       // But we must NOT call resetHMM().shouldClearPersistedState which wipes it.
    }

    resetHMM(); // Reset HMM state to IDLE (but keep isAway if it matches persisted)
    await initAIEngine(); // Initialize TFJS model
    await startSensors();
    
    const { currentState } = getHMMStatus();

    try {
      console.log('[ParkDetection] Checking if background task is already running...');
      const started = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
      if (!started) {
        console.log('[ParkDetection] Starting background location updates...');
        await Location.startLocationUpdatesAsync(PARK_DETECTION_TASK, {
          accuracy: Location.Accuracy.High, // 🚀 Upgraded to High for better low-speed resolution
          timeInterval: 2000,               // 🚀 Reduced to 2s to align with FFT 2.56s window
          distanceInterval: 0,              // 🚀 Force constant updates even if stationary
          deferredUpdatesInterval: 2000,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Parksphere',
            notificationBody: 'Detecting parking activity',
          },
        });
        notify(`Background HMM detection started. State: ${currentState}`);
        console.log('[ParkDetection] Location updates started for PARK_DETECTION_TASK.');
        return true;
      } else {
        console.log('[ParkDetection] PARK_DETECTION_TASK is already running.');
        notify(`Detection engine active. State: ${currentState}`);
        return true; // Return true as it is effectively running
      }
    } catch (taskError) {
      console.error('[ParkDetection] Error starting background task:', taskError);
      notify('Foreground-only detection active (background task failed).');
      return true;
    }
  } catch (error) {
    console.error('[ParkDetection] Critical error in startParkDetection:', error);
    return false;
  }
};

export const stopParkDetection = async () => {
  try {
    console.log('[ParkDetection] Stopping park detection...');
    isInitialized = false;
    stopSensors();
    const started = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
    if (started) {
      await Location.stopLocationUpdatesAsync(PARK_DETECTION_TASK);
      notify('Background HMM detection stopped.');
      console.log('[ParkDetection] Location updates stopped for PARK_DETECTION_TASK.');
    }
  } catch (error) {
    console.error('[ParkDetection] Error in stopParkDetection:', error);
  }
};

export const resetParkDetection = async () => {
  console.log('[ParkDetection] Resetting park detection engine...');
  isInitialized = true; // Ensure engine is ready to process updates after reset
  const { currentState, belief } = resetHMM();
  resetAIBuffer();
  
  try {
    // 🚀 NEW: Try to delete the spot from the server before clearing local storage
    const saved = await withTimeout(AsyncStorage.getItem(STORAGE_KEY), 2000, 'resetParkDetection.getItem');
    if (saved) {
      const stateData = JSON.parse(saved);
      if (stateData.serverSpotId) {
        console.log(`[ParkDetection] Found existing spot ${stateData.serverSpotId}. Deleting...`);
        await deleteSpot(stateData.serverSpotId);
      }
    }

    await withTimeout(AsyncStorage.removeItem(STORAGE_KEY), 2000, 'resetParkDetection.removeItem');
    await withTimeout(AsyncStorage.removeItem('parkedLocation'), 2000, 'resetParkDetection.removeParkedLoc');
    console.log('[ParkDetection] Persisted state and parkedLocation cleared from AsyncStorage.');
    
    // Reset local sensor cache as well
    currentAcceleration = 1.0;
    currentStepRate = 0;
    lastStepTimestamp = 0;
    lastReportedSteps = 0;
    lastBluetoothState = false;

    // Emit a final "IDLE" update to clear UI
    DeviceEventEmitter.emit('parkDetectionDetailedUpdate', {
      state: 'IDLE',
      bestState: 'IDLE',
      confidence: 1.0,
      belief: belief,
      metrics: {
        speed: 0,
        distToParked: 0
      }
    });

    notify('Park detection engine reset.', { clearParkedLocation: true });
  } catch (e) {
    console.error('[ParkDetection] Failed to clear persisted state:', e.message);
    notify('Error resetting park detection engine.');
  }
};
