// MILESTONE 1 — Bluetooth-background-wake validation probe.
//
// Mirrors feat/rnbg-v2's iOS BT detection: an event listener (catches route changes, e.g.
// headphones / active audio) PLUS a 10s poll of isCarConnected() (catches an idle car HFP, which
// changes no audio route and therefore fires NO route-change event). The poll is the part that
// actually detects the car — the earlier probe had only the listener, so the car was never seen.
//
// Fires a local notification on every connect→disconnect transition (with device name, so you can
// tell the car from headphones). Standalone — no HMM, no location — to isolate the BT-wake test.
//
// NOTE: the poll is setInterval-based, so it only runs while JS is alive (foreground / briefly
// awake). This proves the car is *detectable*; whether the event wakes a *suspended* app is the
// separate linchpin we still need to confirm.
import { useEffect, useRef } from 'react';
import { initNotifications, notifyUser } from '../utils/notificationService';

let CarAudio = null;
try {
  CarAudio = require('../modules/car-audio');
} catch (e) {
  console.warn('[CarProbe] CarAudio native module unavailable (needs a rebuild):', e.message);
}

export function useCarConnectionProbe() {
  const prevConnected = useRef(null); // null = baseline not yet established

  useEffect(() => {
    if (!CarAudio) return;
    let sub = null;
    let interval = null;
    let cancelled = false;

    // Notify only on an actual change. First reading just sets the baseline (no notification).
    const report = async (source, ev) => {
      const connected = !!ev?.connected;
      const name = ev?.deviceName || 'audio device';
      if (prevConnected.current === null) {
        prevConnected.current = connected;
        console.log(`[CarProbe] baseline (${source}): ${connected ? 'connected ' + name : 'disconnected'}`);
        return;
      }
      if (connected === prevConnected.current) return;
      prevConnected.current = connected;
      const ts = new Date().toLocaleTimeString();
      console.log(`[CarProbe] ${ts} (${source}) → ${connected ? 'CONNECTED ' + name : 'DISCONNECTED'}`);
      if (connected) await notifyUser('🔵 BT connected', `${name} @ ${ts}`);
      else await notifyUser('🔴 BT disconnected', `parked? @ ${ts}`);
    };

    (async () => {
      await initNotifications();
      // Listener first, so OnStartObserving latches sticky state before the initial poll.
      try {
        sub = CarAudio.addCarConnectionListener((e) => { if (!cancelled) report('event', e); });
      } catch (e) {
        console.warn('[CarProbe] addListener failed:', e.message);
      }
      const poll = async () => {
        try {
          const r = await CarAudio.isCarConnected();
          if (!cancelled) report('poll', r);
        } catch (e) {
          console.warn('[CarProbe] poll failed:', e.message);
        }
      };
      await poll(); // initial read
      interval = setInterval(poll, 10000); // safety-net poll for idle-HFP cars
    })();

    return () => {
      cancelled = true;
      try { sub?.remove(); } catch {}
      if (interval) clearInterval(interval);
    };
  }, []);
}
