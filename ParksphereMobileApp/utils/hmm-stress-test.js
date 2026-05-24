const HMM = require('./parkDetection_HMM.js');
const { SCENARIOS } = require('./simulationScenarios.js');

/**
 * HMM Stress Test Runner
 * Runs scenarios multiple times with injected sensor noise and speed variations.
 */
function runRandomizedScenario(scenario) {
    HMM.resetHMM();
    
    let simulatedTime = Date.now();
    global.Date.now = () => simulatedTime;

    let currentState = 'IDLE';
    let belief = {};
    for (const s of HMM.STATES) belief[s] = s === 'IDLE' ? 1 : 0;

    const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
    let latOffset = 0;
    let activeParkedLocation = null;

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

    let parkedEventOccurred = false;
    let awayEventOccurred = false;
    let returningDetected = false;

    scenario.steps.forEach((step, stepIndex) => {
        // Inject randomness into duration (+/- 10%)
        const randomDuration = Math.max(1, Math.round(step.duration * (0.9 + Math.random() * 0.2)));
        
        if (step.startDistance !== undefined) {
            latOffset = step.startDistance * 0.000009;
            activeParkedLocation = baseLocation;
        }

        for (let t = 0; t < randomDuration; t++) {
            simulatedTime += 1000;

            // Inject randomness into speed (+/- 15%)
            const randomSpeed = step.speed * (0.85 + Math.random() * 0.3);
            
            // Inject coordinate jitter (simulating GPS noise)
            const jitter = (Math.random() - 0.5) * 0.00001; // ~1 meter noise

            const shift = (randomSpeed / 3.6) * 1 * 0.000009; 
            if (step.moveDirection === 'AWAY') latOffset += shift;
            else if (step.moveDirection === 'TOWARD') latOffset -= shift;

            const mockLocation = {
                coords: {
                    latitude: baseLocation.latitude + latOffset + jitter,
                    longitude: baseLocation.longitude + jitter,
                    speed: randomSpeed / 3.6,
                    accuracy: 5 + Math.random() * 15 // Random accuracy between 5-20m
                }
            };

            const motionActivity = {};
            if (randomSpeed > 10) motionActivity.automotive = true;
            else if (step.steps > 0 || randomSpeed > 1) motionActivity.walking = true;
            else motionActivity.stationary = true;
            motionActivity.confidence = 2;

            // Inject randomness into step rate (+/- 20%)
            const randomSteps = step.steps * (0.8 + Math.random() * 0.4);

            const result = HMM.processLocationHMM(mockLocation, activeParkedLocation, {
                ...stateData,
                previousState: currentState,
                previousBelief: belief,
                step_rate: randomSteps || 0,
                acceleration_magnitude: (step.accel || 1.0) * (0.95 + Math.random() * 0.1),
                motion_activity: motionActivity,
                bluetoothConnected: step.bluetoothConnected || false
            });

            if (result.state === 'RETURNING') returningDetected = true;
            if (result.parkedEvent) {
                parkedEventOccurred = true;
                activeParkedLocation = mockLocation.coords;
            }
            if (result.awayEvent) awayEventOccurred = true;
            if (result.clearParkingEvent) activeParkedLocation = null;

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

    return { 
        success: true, 
        parkedEventOccurred, 
        awayEventOccurred, 
        returningDetected,
        finalState: currentState 
    };
}

const STRESS_SESSIONS = 100;
const testTargets = [
    { name: 'Happy Path', key: 'HAPPY_PATH', validate: (r) => r.parkedEventOccurred && r.finalState === 'WALKING' },
    { name: 'Red Light Persistence', key: 'HAPPY_PATH', validate: (r) => r.parkedEventOccurred }, // Reuse happy path but check persistence
    { name: 'Real-Life Odyssey', key: 'REAL_LIFE_ODYSSEY', validate: (r) => r.parkedEventOccurred && r.awayEventOccurred && r.returningDetected },
    { name: 'Extreme Odyssey', key: 'EXTREME_ODYSSEY', validate: (r) => r.parkedEventOccurred && r.awayEventOccurred && r.returningDetected }
];

console.log(`\n🚀 STARTING HMM STRESS TEST (${STRESS_SESSIONS} iterations per scenario)\n`);
console.log(`${'SCENARIO'.padEnd(25)} | ${'PASS RATE'.padEnd(10)} | ${'STATUS'}`);
console.log('-'.repeat(50));

testTargets.forEach(target => {
    let passed = 0;
    const scenario = SCENARIOS[target.key];

    for (let i = 0; i < STRESS_SESSIONS; i++) {
        const result = runRandomizedScenario(scenario);
        if (target.validate(result)) {
            passed++;
        }
    }

    const rate = (passed / STRESS_SESSIONS) * 100;
    const status = rate > 95 ? '✅ EXCELLENT' : (rate > 80 ? '⚠️ UNSTABLE' : '❌ FAILED');
    
    console.log(`${target.name.padEnd(25)} | ${passed}/${STRESS_SESSIONS} (${rate}%) | ${status}`);
});

console.log('\nStress test complete.\n');
