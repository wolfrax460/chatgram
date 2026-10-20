import { useCallback, useEffect, useState } from 'react';

const KEY = 'chatgram-theme';

function systemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(mode) {
  const dark = mode === 'system' ? systemDark() : mode === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b141a' : '#ffffff');
}

/** Theme hook: 'light' | 'dark' | 'system' */
export function useTheme() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(KEY) || 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    apply(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => (m === 'dark' ? 'light' : m === 'light' ? 'system' : 'dark'));
  }, []);

  return { mode, setMode, toggle };
}
