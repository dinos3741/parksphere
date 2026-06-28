// Dynamic Expo config: stamps each build with its git identity so the running app can always
// report exactly which commit it was built from (see utils/buildInfo.js + AboutScreen footer).
// app.json remains the base config — this only augments `extra`. Evaluated at bundle/build time,
// so the stamp reflects the real build.
const { execSync } = require('child_process');

function git(args, fallback) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
}

const sha = git('rev-parse --short HEAD', 'nogit');
// -uno: ignore untracked files (e.g. the untracked ai/data logs) so "-dirty" only means
// uncommitted edits to TRACKED source — otherwise every build would look dirty.
const dirty = git('status --porcelain -uno', '') !== '';

// Build timestamp in the BUILD MACHINE's local time (not UTC) so it matches your wall clock.
// "YYYY-MM-DD HH:mm". getHours()/etc. are local-time getters.
function localStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra || {}),
    build: {
      sha: dirty ? `${sha}-dirty` : sha,
      time: localStamp(new Date()),
    },
  },
});
