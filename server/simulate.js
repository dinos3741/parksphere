#!/usr/bin/env node
// Marketplace load-simulation: spins up N synthetic users who declare/request/accept/complete
// parking-spot transactions through the REAL REST + Socket.IO API (not raw SQL), so it exercises
// the same server code real traffic does, including the socket-only accept/decline/arrival/
// confirm-transaction handshake in index.js. Stoppable anytime (Ctrl+C) — leaves whatever state
// it's in on the map/DB untouched; run with --reset separately when you want a clean slate.
//
// Usage:
//   node simulate.js --users 10 --speed 2
//   node simulate.js --reset
require('dotenv').config();
const { io: ioClient } = require('socket.io-client');
const { pool } = require('./db');
const { getRandomPointInCircle } = require('./utils/geoutils');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const NUM_USERS = parseInt(args.users, 10) || 10;
const SPEED = parseFloat(args.speed) || 1;
const CENTER_LAT = parseFloat(args.lat) || 40.6401; // Panorama, Thessaloniki — same default as Map.js
const CENTER_LON = parseFloat(args.lon) || 22.9444;
const SPAWN_RADIUS_M = parseFloat(args.radius) || 1200;
const PORT = process.env.PORT || 3001;
const SERVER_URL = `http://localhost:${PORT}`;
const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL || 'http://localhost:8080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'Parksphere';

const SIM_PREFIX = 'simuser_';
const SIM_PASSWORD = 'Sim-Passw0rd!'; // fixed — these are throwaway synthetic accounts
// No real onboarding path grants starting credits today (users start at 0, and there's no
// purchase/top-up endpoint) — this is a simulation-only bootstrap, not something the real app
// does, so it's one direct SQL UPDATE right after account creation rather than routed through a
// legitimate endpoint that doesn't exist.
const STARTING_CREDITS = 200;

const CAR_TYPES = ['motorcycle', 'city car', 'hatchback', 'sedan', 'family car', 'SUV', 'van', 'truck'];
const CAR_COLORS = ['Red', 'Blue', 'Black', 'White', 'Silver', 'Green', 'Grey'];
const TIME_TO_LEAVE_OPTIONS = [1, 2, 5, 10]; // same choices as TimeOptionsModal.js — real minutes,
  // not scaled by SPEED (only how fast the script itself acts is scaled, not stored domain values)

// Base real-seconds [min, max] for each pacing delay — divided by SPEED below.
const BASE = {
  ownerCooldown: [5, 20],
  beforeGoingPublic: [3, 10],
  waitForRequest: [30, 90],
  requesterCooldown: [5, 20],
  driveOverAfterAccept: [10, 40],
  ownerConfirmDelay: [2, 8],
  waitForArrival: [120, 240],
  waitForResponse: [60, 120],
  waitForCompletion: [60, 120],
};
function pace(range) {
  const [lo, hi] = range;
  const s = lo + Math.random() * (hi - lo);
  return Math.round((s / SPEED) * 1000);
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(1); // second Ctrl+C forces immediate exit
  stopping = true;
  console.log('\n[simulate] stopping — current state stays exactly as it is on the map/DB...');
});

// Interruptible sleep — polls `stopping` every 500ms so Ctrl+C is responsive even mid-wait,
// instead of blocking for the full remaining duration (which could be minutes).
async function sleep(ms) {
  const step = 500;
  let remaining = ms;
  while (remaining > 0 && !stopping) {
    await new Promise((r) => setTimeout(r, Math.min(step, remaining)));
    remaining -= step;
  }
}

// Waits for a socket event matching `predicate`, up to timeoutMs, also polling `stopping` every
// 500ms so a Ctrl+C during a long wait (e.g. waiting for a return trip) doesn't stall shutdown.
function waitForEvent(socket, eventName, timeoutMs, predicate) {
  return new Promise((resolve) => {
    let done = false;
    let elapsed = 0;
    const step = 500;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      socket.off(eventName, handler);
      resolve(result);
    };
    const handler = (data) => {
      if (predicate && !predicate(data)) return;
      finish(data);
    };
    socket.on(eventName, handler);
    const poll = setInterval(() => {
      elapsed += step;
      if (stopping || elapsed >= timeoutMs) finish(null);
    }, step);
  });
}

// ---------------------------------------------------------------------------------------------
// Reset mode — deletes only the tagged synthetic accounts (and, via each table's own ON DELETE
// CASCADE foreign key, everything they own: parking_spots, requests, user_ratings, messages) plus
// their Keycloak accounts, so repeated simulation runs don't pile up orphaned Keycloak users.
// ---------------------------------------------------------------------------------------------
async function getKeycloakAdminToken() {
  const res = await fetch(`${KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: process.env.KEYCLOAK_ADMIN_USERNAME,
      password: process.env.KEYCLOAK_ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error('Failed to get Keycloak admin token');
  const { access_token } = await res.json();
  return access_token;
}

async function resetSimData() {
  const { rows } = await pool.query('SELECT id, username, keycloak_id FROM users WHERE username LIKE $1', [`${SIM_PREFIX}%`]);
  if (rows.length === 0) {
    console.log('[simulate] nothing to reset.');
    await pool.end();
    return;
  }

  console.log(`[simulate] deleting ${rows.length} synthetic user(s)...`);
  let adminToken = null;
  try {
    adminToken = await getKeycloakAdminToken();
  } catch (e) {
    console.warn('[simulate] could not get a Keycloak admin token — will only clean the local DB:', e.message);
  }

  if (adminToken) {
    for (const u of rows) {
      if (!u.keycloak_id) continue;
      try {
        await fetch(`${KEYCLOAK_BASE_URL}/admin/realms/${KEYCLOAK_REALM}/users/${u.keycloak_id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${adminToken}` },
        });
      } catch (e) {
        console.warn(`[simulate] failed to delete Keycloak user for ${u.username}:`, e.message);
      }
    }
  }

  await pool.query('DELETE FROM users WHERE username LIKE $1', [`${SIM_PREFIX}%`]);
  console.log(`[simulate] reset complete — ${rows.length} synthetic user(s) and everything they owned removed.`);
  await pool.end();
}

// ---------------------------------------------------------------------------------------------
// Account bootstrap — login if the synthetic user already exists, else register then login.
// Idempotent across runs: repeated `node simulate.js` invocations reuse the same N accounts
// instead of piling up new Keycloak users every time.
// ---------------------------------------------------------------------------------------------
function randomPlate() {
  const letters = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${letters}-${digits}`;
}

async function loginOrRegister(username) {
  const email = `${username}@simulation.parksphere.local`;
  let res = await fetch(`${SERVER_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: SIM_PASSWORD }),
  });
  if (res.ok) return res.json();

  const registerRes = await fetch(`${SERVER_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username, email, password: SIM_PASSWORD,
      plateNumber: randomPlate(), carColor: pick(CAR_COLORS), carType: pick(CAR_TYPES),
    }),
  });
  if (!registerRes.ok) {
    throw new Error(`register failed: ${registerRes.status} ${await registerRes.text()}`);
  }
  const { userId } = await registerRes.json();
  await pool.query('UPDATE users SET credits = $1 WHERE id = $2', [STARTING_CREDITS, userId]);

  res = await fetch(`${SERVER_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: SIM_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed after registering: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------------------------
// One simulated user: runs the "declare a spot" (owner) and "look for a spot" (requester) loops
// concurrently, same as a real user can play either role at different times.
// ---------------------------------------------------------------------------------------------
function makeUser({ userId, username, token, carType }) {
  const socket = ioClient(SERVER_URL, { transports: ['websocket'] });
  socket.on('connect', () => socket.emit('register', { userId, username }));

  const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  const api = (path, opts = {}) =>
    fetch(`${SERVER_URL}${path}`, { ...opts, headers: { ...authHeaders, ...(opts.headers || {}) } });

  const ownerLoop = async () => {
    while (!stopping) {
      await sleep(pace(BASE.ownerCooldown));
      if (stopping) return;

      const [lat, lon] = getRandomPointInCircle(CENTER_LAT, CENTER_LON, SPAWN_RADIUS_M);
      const isFree = Math.random() < 0.3;
      const declareRes = await api('/api/declare-spot', {
        method: 'POST',
        body: JSON.stringify({
          latitude: lat,
          longitude: lon,
          timeToLeave: pick(TIME_TO_LEAVE_OPTIONS),
          costType: isFree ? 'free' : 'paid',
          price: isFree ? 0 : Math.ceil(Math.random() * 5) * 5,
          declaredCarType: carType,
          comments: '',
          isAutoDetected: false,
        }),
      }).catch(() => null);
      if (!declareRes || !declareRes.ok) continue; // e.g. a 409 already-has-a-spot race — retry next cycle
      const { spotId } = await declareRes.json();

      await sleep(pace(BASE.beforeGoingPublic));
      if (stopping) return; // leave the (still private/occupied) spot exactly as declared
      await api(`/api/parkingspots/${spotId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'soon_free' }),
      }).catch(() => {});

      const gotRequest = await waitForEvent(socket, 'spotRequest', pace(BASE.waitForRequest), (d) => d.spotId === spotId);
      if (stopping) return; // leave the spot public as-is, don't delete it on our way out

      if (gotRequest) {
        const accept = Math.random() < 0.85;
        socket.emit(accept ? 'acceptRequest' : 'declineRequest', {
          requestId: gotRequest.requestId,
          requesterId: gotRequest.requesterId,
          spotId,
          ownerUsername: username,
          ownerId: userId,
        });

        if (accept) {
          const arrived = await waitForEvent(socket, 'requesterArrived', pace(BASE.waitForArrival), (d) => d.spotId === spotId);
          if (arrived && !stopping) {
            await sleep(pace(BASE.ownerConfirmDelay));
            if (!stopping) socket.emit('confirm-transaction', { spotId, requesterId: arrived.requesterId });
          }
        }
      } else {
        // Genuine timeout (not a stop) — nobody requested it; simulate giving up and driving off.
        await api(`/api/parkingspots/${spotId}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  };

  const requesterLoop = async () => {
    while (!stopping) {
      await sleep(pace(BASE.requesterCooldown));
      if (stopping) return;

      const spotsRes = await api(`/api/parkingspots?filter=available&userCarType=${encodeURIComponent(carType)}`).catch(() => null);
      if (!spotsRes || !spotsRes.ok) continue;
      const spots = (await spotsRes.json()).filter((s) => s.user_id !== userId);
      if (spots.length === 0) continue;
      const target = pick(spots);

      const [reqLat, reqLon] = getRandomPointInCircle(CENTER_LAT, CENTER_LON, SPAWN_RADIUS_M);
      const reqRes = await api('/api/request-spot', {
        method: 'POST',
        body: JSON.stringify({ spotId: target.id, requesterLat: reqLat, requesterLon: reqLon }),
      }).catch(() => null);
      if (!reqRes || !reqRes.ok) continue;

      // Only the accept path's 'requestResponse' payload includes the full `spot` object — decline
      // and auto-reject (owner accepted someone else) payloads carry `spotId` instead. See index.js's
      // acceptRequest/declineRequest socket handlers.
      const response = await waitForEvent(
        socket, 'requestResponse', pace(BASE.waitForResponse),
        (d) => (d.spot ? d.spot.id === target.id : d.spotId === target.id)
      );
      if (stopping || !response || !response.spot) continue; // declined, timed out, or we're stopping

      await sleep(pace(BASE.driveOverAfterAccept));
      if (stopping) continue;
      socket.emit('requester-arrived', { spotId: target.id });

      await waitForEvent(socket, 'transactionComplete', pace(BASE.waitForCompletion));
    }
  };

  return { socket, ownerLoop, requesterLoop };
}

// ---------------------------------------------------------------------------------------------
async function main() {
  if (args.reset) {
    await resetSimData();
    return;
  }

  console.log(`[simulate] starting ${NUM_USERS} synthetic user(s) at ${SPEED}x speed, centered on (${CENTER_LAT}, ${CENTER_LON})...`);
  const users = [];
  for (let i = 1; i <= NUM_USERS; i++) {
    const username = `${SIM_PREFIX}${i}`;
    try {
      const account = await loginOrRegister(username);
      users.push(makeUser({
        userId: account.userId,
        username: account.username,
        token: account.token,
        carType: account.carType || pick(CAR_TYPES),
      }));
    } catch (e) {
      console.warn(`[simulate] skipping ${username}: ${e.message}`);
    }
  }
  console.log(`[simulate] ${users.length} user(s) online. Watch the app — Ctrl+C to stop.`);

  await Promise.all(users.flatMap((u) => [u.ownerLoop(), u.requesterLoop()]));

  for (const u of users) {
    try { u.socket.disconnect(); } catch (_) {}
  }
  await pool.end();
  console.log('[simulate] stopped.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[simulate] fatal:', e);
  process.exit(1);
});
