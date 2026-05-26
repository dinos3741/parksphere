const HMM = require('./parkDetection_HMM.js');
const { SCENARIOS } = require('./simulationScenarios.js');

/**
 * Odyssey Trace Tool
 * Runs the 'Real-Life Odyssey' scenario and prints a detailed lifecycle report.
 */
function traceScenario(scenario) {
    HMM.resetHMM();
    
    // Mock time
    let simulatedTime = Date.now();
    global.Date.now = () => simulatedTime;

    let currentState = 'IDLE';
    let belief = {};
    for (const s of HMM.STATES) belief[s] = s === 'IDLE' ? 1 : 0;

    const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
    let latOffset = 0;
    let activeParkedLocation = null;

    // Internal HMM state persistence
    let stateData = {
        tripDrivingTime: 0,
        tripDrivingDistance: 0,
        drivingCounter: 0,
        walkingCounter: 0,
        returnCounter: 0,
        inCarCounter: 0,
        proximityCounter: 0,
        lastDistanceToCar: undefined,
        lastTripX: null,
        lastTripY: null,
        isAway: false
    };

    console.log(`\n=== TRACING SCENARIO: ${scenario.name} ===`);
    console.log(`Description: ${scenario.description}\n`);
    console.log(`${'TIME'.padEnd(6)} | ${'LABEL'.padEnd(20)} | ${'STATE'.padEnd(10)} | ${'CONF'.padEnd(5)} | ${'DIST'.padEnd(6)} | ${'EVENTS/NOTES'}`);
    console.log('-'.repeat(80));

    let totalSeconds = 0;
    let currentSpeed = 0; // 🚀 PHYSICS: Track real speed for acceleration

    scenario.steps.forEach((step, stepIndex) => {
        if (step.startDistance !== undefined) {
            latOffset = step.startDistance * 0.000009;
            activeParkedLocation = baseLocation;
        }

        for (let t = 0; t < step.duration; t += 2) { // 🚀 2s tick for smoother physics
            simulatedTime += 2000;
            totalSeconds += 2;

            // 🚀 PHYSICS: Smooth acceleration
            const targetSpeed = step.speed / 3.6;
            const accelRate = 1.5; // m/s^2
            if (currentSpeed < targetSpeed) {
                currentSpeed = Math.min(targetSpeed, currentSpeed + (accelRate * 2));
            } else if (currentSpeed > targetSpeed) {
                currentSpeed = Math.max(targetSpeed, currentSpeed - (accelRate * 2 * 2)); // Braking
            }

            const shift = currentSpeed * 2 * 0.000009;
            if (step.moveDirection === 'AWAY') latOffset += shift;
            else if (step.moveDirection === 'TOWARD') latOffset -= shift;

            // 🚀 JITTER: Mock GPS Noise
            const accuracy = step.accuracy || 10;
            const jitterLat = (Math.random() - 0.5) * (accuracy * 0.000009);
            const jitterLon = (Math.random() - 0.5) * (accuracy * 0.000009);

            const mockLocation = {
                coords: {
                    latitude: baseLocation.latitude + latOffset + jitterLat,
                    longitude: baseLocation.longitude + jitterLon,
                    speed: currentSpeed,
                    accuracy: accuracy
                }
            };

            const motionActivity = {};
            if (currentSpeed > 5) motionActivity.automotive = true;
            else if (step.steps > 0 || currentSpeed > 1) motionActivity.walking = true;
            else motionActivity.stationary = true;
            motionActivity.confidence = 2;

            const result = HMM.processLocationHMM(mockLocation, activeParkedLocation, {
                ...stateData,
                previousState: currentState,
                previousBelief: belief,
                step_rate: step.steps || 0,
                acceleration_magnitude: step.accel || 1.0,
                motion_activity: motionActivity,
                bluetoothConnected: step.bluetoothConnected || false,
                accuracy: accuracy
            });

            // Detect changes for logging
            let events = [];
            if (result.state !== currentState) events.push(`🔄 ${currentState}->${result.state}`);
            if (result.parkedEvent) {
                events.push('🅿️ PARKED_EVENT');
                activeParkedLocation = mockLocation.coords;
            }
            if (result.awayEvent) events.push('🚶 AWAY_EVENT');
            if (result.clearParkingEvent) {
                events.push('🏁 SPOT_CLEARED');
                activeParkedLocation = null;
            }
            
            // Log specific progress points
            if (t === 0) events.push(`[Start Step: ${step.label}]`);

            const timeStr = `${totalSeconds}s`.padEnd(6);
            const labelStr = step.label.substring(0, 20).padEnd(20);
            const stateStr = result.state.padEnd(10);
            const confStr = `${(result.confidence * 100).toFixed(0)}%`.padEnd(5);
            const distStr = `${result.distToParked.toFixed(1)}m`.padEnd(6);
            
            if (events.length > 0 || t % 10 === 0) {
                console.log(`${timeStr} | ${labelStr} | ${stateStr} | ${confStr} | ${distStr} | ${events.join(', ')}`);
            }

            // Update persistence
            currentState = result.state;
            belief = result.belief;
            stateData.isAway = result.isAway;
            stateData.tripDrivingTime = result.tripDrivingTime;
            stateData.tripDrivingDistance = result.tripDrivingDistance;
            stateData.drivingCounter = result.drivingCounter;
            stateData.walkingCounter = result.walkingCounter;
            stateData.returnCounter = result.returnCounter;
            stateData.inCarCounter = result.inCarCounter;
            stateData.proximityCounter = result.proximityCounter;
            stateData.lastTripX = result.lastTripX;
            stateData.lastTripY = result.lastTripY;
            stateData.lastDistanceToCar = result.distToParked;
        }
    });

    console.log('\n=== TRACE COMPLETE ===\n');
}

const scenarioName = process.argv[2] && process.argv[2].startsWith('--scenario=') 
    ? process.argv[2].split('=')[1] 
    : (process.argv[3] || 'EXTREME_ODYSSEY');

const scenario = SCENARIOS[scenarioName] || SCENARIOS.EXTREME_ODYSSEY;
traceScenario(scenario);
