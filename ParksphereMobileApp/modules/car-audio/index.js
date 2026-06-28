// JS interface for the CarAudio native module.
//
// Detects whether the iPhone is connected to the car's audio system via the AVAudioSession
// output route (Bluetooth HFP or CarPlay). This is the only way to detect a car-audio
// connection on iOS — Apple forbids enumerating Bluetooth Classic devices, but the audio
// route is public API.
//
// requireNativeModule throws if the native module isn't in the build (Expo Go / not yet
// rebuilt after adding this module), so callers should guard the import.
import { requireNativeModule } from 'expo-modules-core';

const CarAudio = requireNativeModule('CarAudio');

// Promise<{ connected: boolean, deviceName?: string, deviceUID?: string }>
// connected  — true if a car port (HFP / CarPlay) is active or was recently active.
// deviceName — human-readable port name from AVAudioSession (e.g. "Toyota Audio").
// deviceUID  — stable unique ID for the port; use this to match against a saved car device.
export function isCarConnected() {
  return CarAudio.isCarConnected();
}

// Subscribe to route-change events: listener({ connected, deviceName, deviceUID }). Returns a Subscription.
export function addCarConnectionListener(listener) {
  return CarAudio.addListener('onCarConnectionChange', listener);
}

export default CarAudio;
