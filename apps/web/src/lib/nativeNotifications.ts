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
}

interface AndroidNotifierPlugin {
  getPermission?: () => Promise<{ granted?: boolean; status?: string }>;
  requestPermission?: () => Promise<{ granted?: boolean; status?: string }>;
  notify?: (options: { title: string; body: string; chatId?: string; tag?: string }) => Promise<void>;
  consumePending?: () => Promise<{ chatId?: string | null }>;
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
  if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'android') return null;
  const plugin = cap.Plugins?.Notifier as AndroidNotifierPlugin | undefined;
  return plugin && typeof plugin.notify === 'function' ? plugin : null;
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
