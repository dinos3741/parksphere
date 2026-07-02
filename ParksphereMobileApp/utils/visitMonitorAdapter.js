// Adapter: VisitMonitor's onLocation payload → the expo-location shape the HMM's handleLocationUpdate
// expects. The native stream emits a flat dict {latitude, longitude, accuracy, altitude, speed,
// course, timestamp}; the HMM reads location.coords.{latitude,longitude,speed,accuracy,...} + a
// top-level timestamp. speed is m/s (-1 = unknown) in both worlds (CLLocation.speed ≙ coords.speed),
// so it passes straight through with no conversion.
export function visitMonitorToLocation(fix) {
  return {
    coords: {
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy,
      altitude: fix.altitude,
      speed: fix.speed,
      heading: fix.course,
    },
    timestamp: fix.timestamp,
  };
}
