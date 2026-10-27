/**
 * Pure update-decision logic for the Windows shell.
 *
 * Kept free of Electron imports so it can be unit tested with plain Node:
 *
 *   node apps/desktop/updater-logic.test.js
 *
 * main.js owns the runtime (electron-updater, timers, IPC); this module only
 * answers "what should happen" and "when should we check again", which is where
 * most of the risk lives (downgrades, force/minimum gating, retry storms).
 */

/** Compare dotted numeric versions. Returns -1, 0 or 1. */
function compareVersions(a, b) {
  const left = String(a ?? '0').split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b ?? '0').split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0) ? 1 : -1;
  }
  return 0;
}

/**
 * Decide what to do given the installed version and the server's answer.
 *
 * @param {object} input
 * @param {string} input.currentVersion        installed version, e.g. "1.1.0"
 * @param {string} [input.latestVersion]       newest published version
 * @param {string} [input.minSupportedVersion] oldest allowed version
 * @param {boolean} [input.forceUpdate]        server asks everyone below latest to update
 * @param {boolean} [input.withdrawn]          newest release was withdrawn
 * @returns {{action: 'none'|'optional'|'required', reason: string}}
 */
function decideUpdate({ currentVersion, latestVersion, minSupportedVersion, forceUpdate, withdrawn } = {}) {
  // A withdrawn build is never offered. It also must never force an upgrade.
  if (withdrawn === true) return { action: 'none', reason: 'withdrawn' };

  const current = String(currentVersion || '0');
  const latest = String(latestVersion || '').trim();

  // Never downgrade: equal or newer installed versions are left alone.
  if (!latest || compareVersions(current, latest) >= 0) {
    return { action: 'none', reason: latest ? 'up-to-date' : 'no-latest' };
  }

  if (forceUpdate === true) return { action: 'required', reason: 'force-update' };

  const minimum = String(minSupportedVersion || '').trim();
  if (minimum && compareVersions(current, minimum) < 0) {
    return { action: 'required', reason: 'below-minimum' };
  }

  return { action: 'optional', reason: 'newer-available' };
}

/**
 * Retry backoff after a failed check or download: 5 s, 15 s, 45 s, ~2 m, ~7 m,
 * ~20 m, then capped at 30 min. Never returns 0 so a broken feed cannot spin.
 */
function backoffDelay(attempt, { baseMs = 5_000, factor = 3, capMs = 30 * 60_000 } = {}) {
  const safeAttempt = Math.max(1, Math.min(12, Number(attempt) || 1));
  const delay = baseMs * factor ** (safeAttempt - 1);
  return Math.min(capMs, Math.max(1_000, delay));
}

/**
 * Delay until the next scheduled check: 6 h with up to ±15 min of jitter, so
 * thousands of clients do not hit the version endpoint in the same minute.
 */
function nextCheckDelay({ intervalMs = 6 * 60 * 60_000, jitterMs = 15 * 60_000, random = Math.random } = {}) {
  const spread = (Number(random()) * 2 - 1) * jitterMs;
  return Math.max(60_000, Math.round(intervalMs + spread));
}

/** Human-readable "3 of 6" style attempt label for logs/tests. */
function describeAttempt(attempt, maxAttempts = 6) {
  return `${Math.min(attempt, maxAttempts)}/${maxAttempts}`;
}

module.exports = { compareVersions, decideUpdate, backoffDelay, nextCheckDelay, describeAttempt };
