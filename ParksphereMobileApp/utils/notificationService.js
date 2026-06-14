import * as Notifications from 'expo-notifications';

// LOCAL notifications only — generated on-device by the app (no APNs / push entitlement / paid
// account). They appear on the lock screen even when the app is in the background, which is how
// we observe the parking lifecycle with the screen off (geofence wakes the app → it fires one).

let permissionGranted = false;

// Show the banner + play a sound even when the app is foregrounded (SDK 54 / expo-notifications
// 0.32 field names — shouldShowAlert is deprecated).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Request notification permission once (idempotent). Call at startup. Safe to call again from a
 * background task — getPermissionsAsync just reads the existing grant without re-prompting.
 */
export async function initNotifications() {
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    permissionGranted = status === 'granted';
  } catch (e) {
    console.warn('[Notifications] init failed:', e.message);
    permissionGranted = false;
  }
  return permissionGranted;
}

/**
 * Fire an immediate local notification (lock-screen banner). No-ops if permission isn't granted.
 * Re-checks permission lazily so it still works after a cold background relaunch (fresh module
 * state) where initNotifications() hasn't run in this process yet.
 */
export async function notifyUser(title, body) {
  try {
    if (!permissionGranted) {
      await initNotifications();
      if (!permissionGranted) return;
    }
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null, // deliver immediately
    });
  } catch (e) {
    console.warn('[Notifications] notifyUser failed:', e.message);
  }
}
