const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Parksphere HMM Telemetry Replayer
 * Usage: node replay_telemetry.js ParksphereMobileApp/ai/data/telemetry_log15.json
 */

const logFilePath = process.argv[2];

if (!logFilePath) {
  console.error('❌ Error: Please provide a path to a telemetry JSON file.');
  console.log('Usage: node replay_telemetry.js <path_to_log.json>');
  process.exit(1);
}

if (!fs.existsSync(logFilePath)) {
  console.error(`❌ Error: File not found at ${logFilePath}`);
  process.exit(1);
}

// 1. Transform HMM file to CommonJS for Node.js compatibility
const hmmPath = path.join(__dirname, 'ParksphereMobileApp/utils/parkDetection_HMM.js');
const tempHmmPath = path.join(__dirname, 'temp_hmm_replayer.js');

let hmmContent = fs.readFileSync(hmmPath, 'utf8');
hmmContent = hmmContent.replace(/export function/g, 'function');
hmmContent = hmmContent.replace(/export const/g, 'const');
hmmContent += '\nmodule.exports = { processLocationHMM, resetHMM, STATES };';
fs.writeFileSync(tempHmmPath, hmmContent);

try {
  const { processLocationHMM, resetHMM } = require('./temp_hmm_replayer.js');
  const data = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));

  resetHMM();
  let state = 'IDLE';
  let parkedLocation = null;
  let frameCount = 0;

  console.log(`\n🚀 REPLAYING: ${path.basename(logFilePath)}`);
  console.log(`Total Frames: ${data.length}\n`);

  data.forEach((frame, i) => {
    if (!frame.sensors) return;
    frameCount++;

    // Feed sensors into the updated engine
    const res = processLocationHMM(
      { coords: { latitude: 0, longitude: 0, speed: frame.sensors.speed || 0, accuracy: frame.sensors.accuracy || 5 } }, 
      parkedLocation, 
      {
        previousState: state,
        motion_activity: frame.sensors.activity,
        step_rate: frame.sensors.stepRate,
        acceleration_magnitude: frame.sensors.accel,
        bluetoothConnected: frame.sensors.bluetooth,
        spectralFeatures: frame.sensors.spectral
      }
    );

    if (res.state !== state) {
      const speedKmh = (frame.sensors.speed * 3.6).toFixed(1);
      console.log(`[${String(i).padStart(4)}] 🔄 ${state.padEnd(9)} -> ${res.state.padEnd(9)} (Speed: ${speedKmh.padStart(4)} km/h)`);
      state = res.state;
    }

    if (res.parkedEvent) { 
      parkedLocation = { latitude: 0, longitude: 0 }; 
      console.log(`[${String(i).padStart(4)}] 🅿️  PARKED EVENT`); 
    }
    
    if (res.clearParkingEvent) { 
      parkedLocation = null; 
      console.log(`[${String(i).padStart(4)}] 🏁 CLEARED PARKING EVENT`); 
    }
  });

  console.log(`\n✅ Replay finished. Processed ${frameCount} frames.`);

} catch (err) {
  console.error('❌ Replay Error:', err.message);
} finally {
  // Clean up
  if (fs.existsSync(tempHmmPath)) fs.unlinkSync(tempHmmPath);
}
