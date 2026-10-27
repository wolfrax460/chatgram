/**
 * Notifications and the message chime.
 *
 * Works on desktop browsers and on Android Chrome/Edge (including an installed
 * PWA). iOS Safari only permits notifications for home-screen apps, so on
 * iPhone the toggle reports unsupported — that is an Apple rule, not a bug.
 *
 * Inside the native shells the page has no notification permission to use:
 * the Android WebView cannot show Web Notifications at all and an Electron toast
 * raised by the page carries no app identity or click target. Both shells
 * therefore own the notification (see lib/nativeNotifications.ts) and this file
 * only decides *whether* one should be raised.
 */
import {
  inAppShell,
  nativeNotificationsAvailable,
  nativeNotify,
  nativePermissionState,
  requestNativePermission,
  syncNativePermission,
} from './nativeNotifications';

export function notificationsSupported(): boolean {
  // Inside the app shells the OS owns notifications, so the page always reports
  // support — an older APK without the plugin must never look "unsupported".
  if (inAppShell()) return true;
  return typeof window !== 'undefined' && 'Notification' in window;
}

export type PermissionState = NotificationPermission | 'unsupported';

/** Native permission state mapped onto the Web Notification vocabulary. */
function mapNativePermission(): PermissionState {
  const state = nativePermissionState();
  if (state === 'granted') return 'granted';
  if (state === 'denied') return 'denied';
  if (state === 'prompt') return 'default';
  return 'unsupported';
}

export function notificationPermission(): PermissionState {
  if (inAppShell()) {
    if (nativeNotificationsAvailable()) return mapNativePermission();
    // The Android/Windows app without the notification bridge (an old build):
    // still "not granted yet", never "unsupported".
    return 'default';
  }
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (inAppShell()) {
    // Windows needs no page permission; Android 13+ shows the system prompt here.
    if (!nativeNotificationsAvailable()) return 'default';
    await requestNativePermission();
    return mapNativePermission();
  }
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * Re-read the native permission (the OS can change it while the app is in the
 * background, e.g. the user allowed notifications from Android settings).
 */
export async function refreshNotificationPermission(): Promise<PermissionState> {
  if (inAppShell()) await syncNativePermission();
  return notificationPermission();
}

/**
 * Raise one notification immediately, so the user can prove the whole chain
 * (permission → channel → banner) without waiting for a real message. The Do
 * not disturb schedule is deliberately ignored for this one.
 */
export type TestNotificationResult = 'native' | 'web' | 'blocked';

export function sendTestNotification(): TestNotificationResult {
  const title = 'Chatgram';
  const body = 'Notifications are working on this device.';
  if (nativeNotify({ title, body })) return 'native';
  if (notificationPermission() !== 'granted') return 'blocked';
  try {
    new Notification(title, { body, icon: '/web/assets/favicon.png', tag: 'chatgram-test' });
    return 'web';
  } catch {
    return 'blocked';
  }
}


/** Do-not-disturb schedule, loaded from the user's server-side preferences. */
export type DoNotDisturb = { dndEnabled: boolean; dndStart: string; dndEnd: string };

let doNotDisturb: DoNotDisturb = { dndEnabled: false, dndStart: '22:00', dndEnd: '07:00' };

export function setDoNotDisturb(next: Partial<DoNotDisturb>): void {
  doNotDisturb = { ...doNotDisturb, ...next };
}

function minutesOf(time: string): number {
  const parts = String(time || '00:00').split(':');
  const hours = Number(parts[0] ?? 0);
  const minutes = Number(parts[1] ?? 0);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

/** True while notifications and the message chime should stay silent. */
export function isDoNotDisturbActive(now: Date = new Date()): boolean {
  if (!doNotDisturb.dndEnabled) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutesOf(doNotDisturb.dndStart);
  const end = minutesOf(doNotDisturb.dndEnd);
  if (start === end) return false;
  // The window may wrap over midnight (22:00 → 07:00).
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/**
 * Raise one notification.
 *
 * `chatId` lets the native shells open the right conversation when the user taps
 * the notification; the browser path keeps using the `onClick` callback.
 */
export function showNotification(
  title: string,
  body: string,
  onClick?: () => void,
  chatId?: string | null,
): void {
  if (isDoNotDisturbActive()) return;
  // Android app / Windows app: the shell owns the notification, its permission
  // and its click target, so hand it over before touching the Web API.
  if (nativeNotify({ title, body, chatId })) return;
  if (notificationPermission() !== 'granted') return;
  try {
    const notification = new Notification(title, {
      body,
      icon: '/web/assets/favicon.png',
      tag: `chatgram-${chatId ?? title}-${Date.now()}`,
    });
    if (onClick) {
      notification.onclick = () => {
        window.focus();
        onClick();
        notification.close();
      };
    }
  } catch {
    /* some browsers reject without a service worker — ignore */
  }
}

let audioContext: AudioContext | null = null;

/** Short two-tone chime, synthesised so no audio asset is needed. */
export function playMessageSound(): void {
  if (isDoNotDisturbActive()) return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!audioContext) audioContext = new Ctor();
    const ctx = audioContext;
    if (ctx.state === 'suspended') void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1240, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    /* autoplay blocked until first interaction — harmless */
  }
}
