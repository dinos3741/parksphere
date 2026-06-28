// MILESTONE 1 — Bluetooth-background-wake validation probe.
//
// The new event-based architecture hinges on one assumption: iOS delivers the car's
// Bluetooth connect/disconnect (AVAudioSession route change) to our app *while it is
// backgrounded/suspended*. This probe fires a local notification on every CarAudio
// connection change so we can field-test it: park the car with the screen off and see
// whether "🔴 Car disconnected" arrives without opening the app.
//
// It is intentionally standalone (no HMM, no location) so the test isolates exactly the
// BT-wake question. Remove once Milestone 1 is validated.
import { useEffect } from 'react';
import { initNotifications, notifyUser } from '../utils/notificationService';

let CarAudio = null;
try {
  CarAudio = require('../modules/car-audio');
} catch (e) {
  console.warn('[CarProbe] CarAudio native module unavailable (needs a dev/release rebuild):', e.message);
}

export function useCarConnectionProbe() {
  useEffect(() => {
    if (!CarAudio) return;
    let sub;
    (async () => {
      await initNotifications();
      // Log the starting state so we know the listener attached.
      try {
        const start = await CarAudio.isCarConnected();
        console.log('[CarProbe] initial car-connected:', JSON.stringify(start));
      } catch (e) {
        console.warn('[CarProbe] isCarConnected failed:', e.message);
      }
      sub = CarAudio.addCarConnectionListener(async (ev) => {
        const ts = new Date().toLocaleTimeString();
        console.log(`[CarProbe] ${ts} onCarConnectionChange:`, JSON.stringify(ev));
        if (ev?.connected) {
          await notifyUser('🔵 Car connected', `${ev.deviceName || 'car audio'} @ ${ts}`);
        } else {
          await notifyUser('🔴 Car disconnected', `Parked? @ ${ts}`);
        }
      });
    })();
    return () => { try { sub?.remove(); } catch {} };
  }, []);
}
