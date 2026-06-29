// MILESTONE 1b — CLVisit background-wake validation probe.
//
// Tests iOS's native arrival/departure detection: does startMonitoringVisits wake a suspended app
// and tell us "you parked here" / "you left"? Fires a notification on each visit and logs it to the
// heartbeat. A light 2-min liveness ping shows when the app is awake vs suspended, so a visit
// landing inside a suspension gap = proof iOS woke the suspended app for it.
//
// EXPECTATIONS: CLVisit is DELAYED — arrival may fire several minutes AFTER you park; departure
// after you've driven off. It also won't fire for very short stops. So this test needs patience.
import { useEffect, useRef } from 'react';
import { initNotifications, notifyUser } from '../utils/notificationService';
import { logHeartbeat, flushTelemetry } from '../utils/telemetryService';

let VisitMonitor = null;
try {
  VisitMonitor = require('../modules/visit-monitor');
} catch (e) {
  console.warn('[VisitProbe] VisitMonitor native module unavailable (needs a rebuild):', e.message);
}

export function useVisitProbe() {
  const started = useRef(false);

  useEffect(() => {
    if (!VisitMonitor) return;
    let sub = null;
    let alive = null;
    let cancelled = false;

    (async () => {
      await initNotifications();
      try {
        sub = VisitMonitor.addVisitListener(async (v) => {
          if (cancelled) return;
          const ts = new Date().toLocaleTimeString();
          logHeartbeat({ src: 'visit', type: v?.type, lat: v?.latitude, lon: v?.longitude });
          await flushTelemetry();
          console.log('[VisitProbe] visit:', JSON.stringify(v));
          if (v?.type === 'arrival') {
            await notifyUser('🅿️ Arrived (CLVisit)', `parked here? @ ${ts}`);
          } else {
            await notifyUser('🚗 Departed (CLVisit)', `left @ ${ts}`);
          }
        });
        await VisitMonitor.startVisitMonitoring();
        started.current = true;
        console.log('[VisitProbe] CLVisit monitoring started');
      } catch (e) {
        console.warn('[VisitProbe] start failed:', e.message);
      }
      // Light liveness ping: cadence while awake, GAP while suspended — so a 'visit' entry inside a
      // gap proves iOS woke the suspended app.
      const ping = async () => {
        if (cancelled) return;
        logHeartbeat({ src: 'visit.alive' });
        await flushTelemetry();
      };
      await ping();
      alive = setInterval(ping, 120000);
    })();

    return () => {
      cancelled = true;
      try { sub?.remove(); } catch {}
      if (alive) clearInterval(alive);
      // Intentionally NOT stopping monitoring — we want iOS to keep delivering visits in the
      // background across unmounts/relaunches.
    };
  }, []);
}
