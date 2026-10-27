import { useCallback, useEffect, useState } from 'react';

/**
 * Bridge to the Electron shell's Windows update runtime (chunk 7B).
 *
 * On the web this is a no-op: `desktopUpdates()` returns null and every hook
 * stays idle, so nothing renders outside the desktop app.
 */

export type DesktopUpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'required';

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  version: string | null;
  notes: string | null;
  releasedAt: string | null;
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
  lastCheckedAt: string | null;
  error: string | null;
  required: boolean;
  autoDownload: boolean;
  devMode: boolean;
}

export interface DesktopUpdateBridge {
  getState: () => Promise<DesktopUpdateState>;
  check: () => Promise<DesktopUpdateState>;
  download: () => Promise<DesktopUpdateState>;
  install: () => Promise<{ installed: boolean }>;
  setAutoDownload: (value: boolean) => Promise<{ autoDownload: boolean }>;
  openDownloads: () => Promise<boolean>;
  onState: (callback: (state: DesktopUpdateState) => void) => () => void;
}

type DesktopBridgeShape = {
  appVersion?: () => Promise<string>;
  updates?: DesktopUpdateBridge;
  isDesktop?: boolean;
};

const IDLE: DesktopUpdateState = {
  status: 'idle',
  version: null,
  notes: null,
  releasedAt: null,
  percent: 0,
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
  lastCheckedAt: null,
  error: null,
  required: false,
  autoDownload: true,
  devMode: false,
};

function bridge(): DesktopBridgeShape | null {
  const desktop = (window as unknown as { chatgramDesktop?: DesktopBridgeShape }).chatgramDesktop;
  return desktop && desktop.updates ? desktop : null;
}

/** The shell's update API, or null when this is not the desktop app. */
export function desktopUpdates(): DesktopUpdateBridge | null {
  return bridge()?.updates ?? null;
}

export function isDesktopApp(): boolean {
  return Boolean(bridge());
}

export function installedDesktopVersion(): Promise<string | null> {
  const desktop = bridge();
  if (!desktop?.appVersion) return Promise.resolve(null);
  return desktop.appVersion().catch(() => null);
}

export function formatBytes(bytes: number): string {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

/** Live update state + the actions Settings -> About exposes. */
export function useDesktopUpdate() {
  const api = desktopUpdates();
  const [state, setState] = useState<DesktopUpdateState>(IDLE);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.getState().then((next) => {
      if (active && next) setState(next);
    });
    const unsubscribe = api.onState((next) => {
      if (active && next) setState(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  const check = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const next = await api.check();
      if (next) setState(next);
    } finally {
      setBusy(false);
    }
  }, [api]);

  const download = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const next = await api.download();
      if (next) setState(next);
    } finally {
      setBusy(false);
    }
  }, [api]);

  const install = useCallback(async () => {
    if (!api) return;
    await api.install();
  }, [api]);

  const setAutoDownload = useCallback(
    async (value: boolean) => {
      if (!api) return;
      const next = await api.setAutoDownload(value);
      setState((current) => ({ ...current, autoDownload: next.autoDownload }));
    },
    [api],
  );

  return { api, state, busy, check, download, install, setAutoDownload };
}
