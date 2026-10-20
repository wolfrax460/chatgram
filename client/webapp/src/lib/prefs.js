/** Local user preferences (device-scoped). */
const KEY = 'chatgram.prefs';

const DEFAULTS = {
  notifications: false,
  sounds: true,
};

export function getPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setPref(key, value) {
  const next = { ...getPrefs(), [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}