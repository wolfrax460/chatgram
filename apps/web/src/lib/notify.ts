/**
 * Web notifications and the message chime.
 *
 * Works on desktop browsers and on Android Chrome/Edge (including an installed
 * PWA). iOS Safari only permits notifications for home-screen apps, so on
 * iPhone the toggle reports unsupported — that is an Apple rule, not a bug.
 */

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export type PermissionState = NotificationPermission | 'unsupported';

export function notificationPermission(): PermissionState {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function showNotification(title: string, body: string, onClick?: () => void): void {
  if (notificationPermission() !== 'granted') return;
  try {
    const notification = new Notification(title, {
      body,
      icon: '/web/assets/favicon.png',
      tag: `chatgram-${title}-${Date.now()}`,
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
