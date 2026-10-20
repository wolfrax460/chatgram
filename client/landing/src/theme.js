import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'chatgram-theme';
const MODES = ['light', 'dark', 'system'];

function systemPrefersDark() {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(mode) {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b141a' : '#008069');
}

/**
 * Theme state shared by the whole page.
 *
 * Three modes: light, dark and "system" (follow the OS). The choice is saved to
 * localStorage and applied to <html data-theme>, which is what the CSS keys off.
 */
export function useTheme() {
  const [mode, setMode] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return MODES.includes(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    apply(resolve(mode));
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* storage blocked — theme still works for this visit */
    }
  }, [mode]);

  // Keep in sync when the OS preference changes while on "system".
  useEffect(() => {
    if (mode !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply(resolve('system'));
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [mode]);

  const cycle = useCallback(() => {
    setMode((current) => {
      const i = MODES.indexOf(current);
      return MODES[(i + 1) % MODES.length];
    });
  }, []);

  return { mode, setMode, resolved: resolve(mode), cycle };
}
