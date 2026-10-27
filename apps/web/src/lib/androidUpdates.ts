import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Bridge to the Android shell's in-app updater (chunk 7C).
 *
 * The native side (`AppUpdaterPlugin`) checks `/api/app/version`, downloads the
 * APK with DownloadManager, verifies the SHA-256 and then hands it to Android's
 * installer. This module is the typed web surface; in a browser everything is
 * inert.
 *
 * Network behaviour (owner requirement): the update may download over **Wi-Fi or
 * mobile data — whichever is available**. `wifiOnly` is an opt-in data-saving
 * switch and is off by default.
 */

export type AndroidUpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'required';

export interface AndroidUpdateState {
  status: AndroidUpdateStatus;
  required: boolean;
  forceUpdate: boolean;
  version: string;
  versionCode: number;
  notes: string;
  size: number;
  downloaded: number;
  total: number;
  error: string;
  lastCheckedAt: number | null;
  wifiOnly: boolean;
  file?: string;
}

export interface AndroidUpdateBridge {
  getState: () => Promise<AndroidUpdateState>;
  getInstalledVersion: () => Promise<{ version: string; versionCode: number }>;
  check: () => Promise<AndroidUpdateState & { upToDate?: boolean }>;
  download: () => Promise<AndroidUpdateState & { requestId?: number }>;
  install: () => Promise<{ started?: boolean; needsPermission?: boolean }>;
  setWifiOnly: (options: { wifiOnly: boolean }) => Promise<{ wifiOnly: boolean }>;
  openInstallSettings: () => Promise<{ opened: boolean }>;
  dismiss: () => Promise<AndroidUpdateState>;
  addListener: (
    event: 'updateState',
    callback: (state: AndroidUpdateState) => void,
  ) => Promise<{ remove: () => void }> | { remove: () => void };
}

type CapacitorGlobal = {
  Plugins?: Record<string, unknown>;
  isNativePlatform?: () => boolean;
};

function capacitor(): CapacitorGlobal | null {
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap && cap.Plugins ? cap : null;
}

/** The native updater, or null in a browser / old install. */
export function androidUpdates(): AndroidUpdateBridge | null {
  const plugin = capacitor()?.Plugins?.AppUpdater as AndroidUpdateBridge | undefined;
  return plugin && typeof plugin.getState === 'function' ? plugin : null;
}

export function isAndroidApp(): boolean {
  const cap = capacitor();
  if (!cap) return false;
  try {
    return cap.isNativePlatform ? cap.isNativePlatform() : Boolean(cap.Plugins?.AppUpdater);
  } catch {
    return Boolean(cap.Plugins?.AppUpdater);
  }
}

export function formatUpdateBytes(bytes: number): string {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

const EMPTY: AndroidUpdateState = {
  status: 'idle',
  required: false,
  forceUpdate: false,
  version: '',
  versionCode: 0,
  notes: '',
  size: 0,
  downloaded: 0,
  total: 0,
  error: '',
  lastCheckedAt: null,
  wifiOnly: false,
};

/**
 * Launch/resume checks (spec: check at launch, on resume, and periodically).
 * Throttled across components: the banner, the gate and the About card all use
 * the same hook, and none of them should each fire a request.
 */
let lastAutoCheck = 0;
const AUTO_CHECK_INTERVAL_MS = 10 * 60 * 1000;

function maybeAutoCheck(api: AndroidUpdateBridge | null) {
  if (!api) return;
  const now = Date.now();
  if (now - lastAutoCheck < AUTO_CHECK_INTERVAL_MS) return;
  lastAutoCheck = now;
  void api.check().catch(() => undefined);
}


/** Live update state + actions for the Android shell. */
export function useAndroidUpdate() {
  const api = androidUpdates();
  const [state, setState] = useState<AndroidUpdateState>(EMPTY);
  const [installed, setInstalled] = useState<{ version: string; versionCode: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const poll = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const next = await api.getState();
      if (next) setState({ ...EMPTY, ...next });
    } catch {
      /* the shell is unavailable; keep the last state */
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void refresh();
    void api
      .getInstalledVersion()
      .then((value) => {
        if (active && value) setInstalled(value);
      })
      .catch(() => undefined);

    // Check at launch, then again whenever the app comes back to the foreground.
    maybeAutoCheck(api);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        maybeAutoCheck(api);
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    let listener: { remove: () => void } | null = null;
    try {
      const maybe = api.addListener('updateState', (next) => {
        if (active && next) setState({ ...EMPTY, ...next });
      });
      if (maybe && typeof (maybe as Promise<{ remove: () => void }>).then === 'function') {
        void (maybe as Promise<{ remove: () => void }>).then((handle) => {
          if (active) listener = handle;
          else handle.remove();
        });
      } else {
        listener = maybe as { remove: () => void };
      }
    } catch {
      /* older bridge without events — polling below covers it */
    }

    // Fallback polling: while a download runs, refresh often; otherwise rarely.
    poll.current = window.setInterval(() => {
      void refresh();
    }, state.status === 'downloading' ? 2_000 : 20_000);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (listener) listener.remove();
      if (poll.current) window.clearInterval(poll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, refresh, state.status === 'downloading']);

  const check = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const next = await api.check();
      await refresh();
      if (next && next.status === 'idle') {
        setState((current) => ({ ...current, status: 'idle', version: '', error: '' }));
      }
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const download = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      await api.download();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const install = useCallback(async () => {
    if (!api) return { started: false, needsPermission: false };
    return api.install();
  }, [api]);

  const setWifiOnly = useCallback(
    async (wifiOnly: boolean) => {
      if (!api) return;
      const result = await api.setWifiOnly({ wifiOnly });
      setState((current) => ({ ...current, wifiOnly: result.wifiOnly }));
    },
    [api],
  );

  const dismiss = useCallback(async () => {
    if (!api) return;
    await api.dismiss();
    await refresh();
  }, [api, refresh]);

  const openInstallSettings = useCallback(async () => {
    if (!api) return { opened: false };
    return api.openInstallSettings();
  }, [api]);

  return {
    api,
    isAndroid: Boolean(api),
    state,
    installed,
    busy,
    check,
    download,
    install,
    setWifiOnly,
    dismiss,
    openInstallSettings,
  };
}
