// Single source of truth for "which build is this?". Reads the semver from app.json's `version`
// and the git stamp injected at build time by app.config.js (extra.build). Used by the About
// screen footer and logged into the RNBG log at startup so emailed logs self-identify the commit.
// Guarded require: expo-constants drags in native modules that don't load under jest (and would
// be absent in any non-Expo context). Fall back to empty config so this util never breaks an
// import chain — the real app always has expo-constants, so the stamp is populated there.
function loadExpoConfig() {
  try {
    const mod = require('expo-constants');
    const Constants = mod.default || mod;
    return Constants.expoConfig || {};
  } catch {
    return {};
  }
}

const cfg = loadExpoConfig();
const build = cfg.extra?.build || {};

export const APP_VERSION = cfg.version || '0.0.0';        // manual semver (app.json) — bump for milestones
export const BUILD_SHA = build.sha || 'unknown';          // auto git short sha (+ "-dirty" if uncommitted)
export const BUILD_TIME = build.time || null;             // local "YYYY-MM-DD HH:mm" from app.config.js

// Human-readable build label, e.g. "v1.0.0 · b9935ce · 2026-06-28 18:30" (build-machine local time).
export const BUILD_LABEL =
  `v${APP_VERSION} · ${BUILD_SHA}` + (BUILD_TIME ? ` · ${BUILD_TIME}` : '');
