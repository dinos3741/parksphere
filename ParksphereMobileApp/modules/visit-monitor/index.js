// JS interface for the VisitMonitor native module (iOS CLVisit).
//
// requireNativeModule throws if the native module isn't in the build (Expo Go / not yet rebuilt),
// so callers should guard the import.
import { requireNativeModule } from 'expo-modules-core';

const VisitMonitor = requireNativeModule('VisitMonitor');

// Begin CLVisit monitoring. iOS will deliver arrival/departure events — even after the app is
// suspended or terminated — once it's confident (delayed by minutes). Safe to call repeatedly.
export function startVisitMonitoring() {
  return VisitMonitor.start();
}

export function stopVisitMonitoring() {
  return VisitMonitor.stop();
}

// listener({ type: 'arrival'|'departure', latitude, longitude, accuracy, arrival, departure }).
// Returns a Subscription.
export function addVisitListener(listener) {
  return VisitMonitor.addListener('onVisit', listener);
}

export default VisitMonitor;
