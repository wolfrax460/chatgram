/**
 * Native notification bridges.
 *
 * The same web build runs in three shells:
 *  - a plain browser  → Web Notification API (`lib/notify.ts`);
 *  - the Capacitor Android app → our `Notifier` plugin (local notifications);
 *  - the Electron Windows app → `window.chatgramDesktop` (native toast + tray).
 *
 * This module is the only place that knows which shell it is in, so `notify.ts`
 * stays a thin decision layer. Why the shells do the work themselves:
 *  - the Android WebView has no notification permission to grant to the page, so
 *    the Web Notification API silently does nothing there;
 *  - a toast raised by the page in Electron cannot carry the app id, the icon or
 *    a click target, and Windows attributes it to "electron.exe".
 */
import { api } from './api';

export interface NotificationPayload {
  title: string;
  body: string;
  /** Chat to open when the notification is tapped. */
  chatId?: string | null;
}

export type NativePermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

interface DesktopBridge {
  notify?: (payload: NotificationPayload) => Promise<boolean>;
  onOpenChat?: (callback: (chatId: string) => void) => () => void;
  notifications?: {
    getState?: () => Promise<{ supported?: boolean; platform?: string }>;
    openSettings?: () => Promise<boolean>;
  };
}

interface AndroidNotifierPlugin {
  getPermission?: () => Promise<{ granted?: boolean; status?: string }>;
  requestPermission?: () => Promise<{ granted?: boolean; status?: string }>;
  notify?: (options: {
    title: string;
    body: string;
    chatId?: string;
    tag?: string;
    channel?: 'messages' | 'calls' | 'general';
    ongoing?: boolean;
  }) => Promise<void>;
  consumePending?: () => Promise<{ chatId?: string | null }>;
  /** FCM token (Android 1.1.7+); the server sends pushes to it. */
  getFcmToken?: () => Promise<{ token?: string | null }>;
  deleteFcmToken?: () => Promise<{ deleted?: boolean }>;
  /** Chat id from a tapped push (message tap or call accept). */
  consumePushOpened?: () => Promise<{ chatId?: string | null }>;
  openSettings?: () => Promise<{ opened?: boolean }>;
  batteryOptimization?: () => Promise<{ ignoring?: boolean }>;
  requestBatteryExemption?: () => Promise<{ opened?: boolean }>;
}

interface CapacitorLike {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

function capacitor(): CapacitorLike | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { Capacitor?: CapacitorLike }).Capacitor ?? null;
}

function desktop(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { chatgramDesktop?: DesktopBridge }).chatgramDesktop;
  return bridge && typeof bridge === 'object' ? bridge : null;
}

/** The `Notifier` Capacitor plugin, when the Android shell has it. */
export function androidNotifier(): AndroidNotifierPlugin | null {
  const cap = capacitor();
  if (!cap) return null;
  const plugin = cap.Plugins?.Notifier as AndroidNotifierPlugin | undefined;
  if (!plugin || typeof plugin.notify !== 'function') return null;
  // The presence of the native plugin is the strongest signal, but a browser
  // page could publish a same-named object, so prefer the platform checks when
  // the bridge exposes them (older bridges vary in what they report).
  const native = cap.isNativePlatform ? cap.isNativePlatform() === true : true;
  const platform = cap.getPlatform?.();
  return native && (platform === undefined || platform === 'android') ? plugin : null;
}

export function isDesktopShell(): boolean {
  return Boolean(desktop()?.notify);
}

export function isAndroidShell(): boolean {
  return Boolean(androidNotifier());
}

/** True when a native shell will handle notifications (so the page must not). */
export function nativeNotificationsAvailable(): boolean {
  return isDesktopShell() || isAndroidShell();
}

/** Which shell hosts this page. */
export type AppShell = 'android' | 'windows' | 'browser';

/**
 * Detect the shell WITHOUT requiring the notification plugin, because an older
 * APK still is the Android app: telling its user "this browser does not support
 * notifications" (the old Settings banner) is wrong and unfixable-looking. The
 * Capacitor bridge is injected only by the native shell, so it is the honest
 * signal; the `chatgramDesktop` bridge is the Electron one.
 */
export function appShell(): AppShell {
  const cap = capacitor();
  if (cap && cap.isNativePlatform?.() === true) return 'android';
  if (isDesktopShell()) return 'windows';
  return 'browser';
}

/** True inside the Android or Windows app (so no browser-only copy anywhere). */
export function inAppShell(): boolean {
  return appShell() !== 'browser';
}

/**
 * Open the operating system's notification settings for Chatgram.
 * Android: the app's own notification page. Windows: the Windows notification
 * settings page. Browsers: not possible from the page, returns false.
 */
export async function openNotificationSettings(): Promise<boolean> {
  if (appShell() === 'android') {
    const notifier = androidNotifier();
    if (!notifier?.openSettings) return false;
    try {
      const result = await notifier.openSettings();
      return result?.opened !== false;
    } catch {
      return false;
    }
  }
  const bridge = desktop();
  if (!bridge?.notifications?.openSettings) return false;
  try {
    return (await bridge.notifications.openSettings()) === true;
  } catch {
    return false;
  }
}

export interface BatteryOptimizationState {
  /** True when Android is already allowed to keep Chatgram in the background. */
  ignoring: boolean;
  /** True when the app can show the system exemption dialog itself. */
  canAsk: boolean;
}

/** Battery-optimisation state (Android only; null elsewhere / older builds). */
export async function batteryOptimization(): Promise<BatteryOptimizationState | null> {
  if (appShell() !== 'android') return null;
  const notifier = androidNotifier();
  if (!notifier?.batteryOptimization) return null;
  try {
    const result = await notifier.batteryOptimization();
    return {
      ignoring: result?.ignoring === true,
      canAsk: typeof notifier.requestBatteryExemption === 'function',
    };
  } catch {
    return null;
  }
}

/** Ask Android to exempt the app from battery optimisation. */
export async function requestBatteryExemption(): Promise<boolean> {
  const notifier = androidNotifier();
  if (!notifier?.requestBatteryExemption) return false;
  try {
    const result = await notifier.requestBatteryExemption();
    return result?.opened !== false;
  } catch {
    return false;
  }
}

/** Cached answer so `notificationPermission()` can stay synchronous. */
let nativePermission: NativePermission = 'prompt';

/**
 * Hand one notification to the shell. Returns false when there is no shell, in
 * which case the caller falls back to the Web Notification API.
 */
export function nativeNotify(payload: NotificationPayload): boolean {
  const bridge = desktop();
  if (bridge?.notify) {
    void bridge.notify(payload).catch(() => false);
    return true;
  }
  const notifier = androidNotifier();
  if (notifier?.notify) {
    void notifier
      .notify({
        title: payload.title,
        body: payload.body,
        chatId: payload.chatId ?? undefined,
        // One slot per chat: a new message replaces the previous notification of
        // the same conversation instead of stacking a wall of toasts.
        tag: payload.chatId ?? undefined,
      })
      .catch(() => undefined);
    return true;
  }
  return false;
}

function permissionFrom(result: { granted?: boolean; status?: string } | undefined): NativePermission {
  if (result?.granted === true || result?.status === 'granted') return 'granted';
  if (result?.status === 'denied') return 'denied';
  return result ? 'prompt' : 'unsupported';
}

/** Read (and cache) the shell's notification permission without prompting. */
export async function syncNativePermission(): Promise<NativePermission> {
  if (isDesktopShell()) {
    // Windows toasts need no page-level permission; the OS setting is the gate.
    nativePermission = 'granted';
    return nativePermission;
  }
  const notifier = androidNotifier();
  if (!notifier?.getPermission) {
    nativePermission = notifier ? 'prompt' : 'unsupported';
    return nativePermission;
  }
  try {
    nativePermission = permissionFrom(await notifier.getPermission());
  } catch {
    nativePermission = 'unsupported';
  }
  return nativePermission;
}

/** Ask the shell for permission (Android 13+ system prompt). */
export async function requestNativePermission(): Promise<NativePermission> {
  if (isDesktopShell()) {
    nativePermission = 'granted';
    return nativePermission;
  }
  const notifier = androidNotifier();
  if (!notifier?.requestPermission) return syncNativePermission();
  try {
    nativePermission = permissionFrom(await notifier.requestPermission());
  } catch {
    nativePermission = 'denied';
  }
  return nativePermission;
}

/** Cached native permission: 'unsupported' outside the native shells. */
export function nativePermissionState(): NativePermission {
  if (isDesktopShell()) return 'granted';
  if (isAndroidShell()) return nativePermission === 'unsupported' ? 'prompt' : nativePermission;
  return 'unsupported';
}

const PUSH_TOKEN_KEY = 'chatgram.push.token';

/**
 * Register this device's FCM token with the server (Android only).
 *
 * The native shell owns the token, the server owns delivery, so the token has to
 * travel once per app session (and again whenever it rotates). Registration is
 * best effort: a failure must never block sign-in or the UI.
 */
export async function syncPushToken(): Promise<void> {
  const notifier = androidNotifier();
  if (!notifier?.getFcmToken) return;
  try {
    const result = await notifier.getFcmToken();
    const token = typeof result?.token === 'string' ? result.token : '';
    if (!token) return;
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(PUSH_TOKEN_KEY);
    } catch {
      remembered = null;
    }
    if (remembered === token) return;
    await api.registerDevice(token, 'android');
    try {
      window.localStorage.setItem(PUSH_TOKEN_KEY, token);
    } catch {
      /* private mode: the token is simply registered again next launch */
    }
  } catch {
    /* push registration is best effort */
  }
}

/** Forget this device's push token (sign-out): no pushes for the old account. */
export async function unregisterPushToken(): Promise<void> {
  const notifier = androidNotifier();
  let token: string | null = null;
  try {
    token = window.localStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    token = null;
  }
  try {
    if (token) await api.unregisterDevice(token);
    await notifier?.deleteFcmToken?.();
  } catch {
    /* signing out must always work */
  }
  try {
    window.localStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Wire the shell's "the user tapped a notification" path to the app router.
 *
 * Android: a tap launches/foregrounds the app and writes the chat id into
 * SharedPreferences; we drain it when the WebView becomes visible again.
 * Windows: the main process sends `chatgram:open-chat` over the preload bridge.
 *
 * Returns a cleanup function.
 */
export function initNativeNotifications(openChat: (chatId: string) => void): () => void {
  void syncNativePermission();
  void syncPushToken();
  const disposers: Array<() => void> = [];

  const bridge = desktop();
  if (bridge?.onOpenChat) {
    disposers.push(
      bridge.onOpenChat((chatId) => {
        if (chatId) openChat(chatId);
      }),
    );
  }

  const notifier = androidNotifier();
  if (notifier?.consumePending) {
    const drain = () => {
      void notifier
        .consumePending?.()
        .then((pending) => {
          const chatId = pending?.chatId;
          if (chatId) openChat(chatId);
        })
        .catch(() => undefined);
      // A push tap (message notification or accepted call) stores the chat too.
      void notifier
        .consumePushOpened?.()
        .then((pending) => {
          const chatId = pending?.chatId;
          if (chatId) openChat(chatId);
        })
        .catch(() => undefined);
    };
    // Launch-from-notification and back-from-background both end here.
    drain();
    const onVisible = () => {
      if (document.visibilityState === 'visible') drain();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    disposers.push(() => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    });
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* a listener must never break sign-out */
      }
    }
  };
}
