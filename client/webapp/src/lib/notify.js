/**
 * Web notifications + message sound.
 *
 * Works on desktop browsers and on Android Chrome/Edge (including the
 * installed PWA). iOS Safari only allows notifications for home-screen apps,
 * so on iPhone the toggle will report unsupported — that is a platform rule,
 * not a bug here.
 */
const SOUND_SRC =
  'data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function showNotification(title, body, onClick) {
  if (notificationPermission() !== 'granted') return null;
  try {
    const n = new Notification(title, {
      body,
      icon: '/assets/favicon.png',
      badge: '/assets/favicon.png',
      tag: `chatgram-${title}-${Date.now()}`,
    });
    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    }
    return n;
  } catch {
    return null;
  }
}

let audioEl = null;

/** Short two-tone chime, generated so we do not need an asset. */
export function playMessageSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioEl) audioEl = new Ctx();
    const ctx = audioEl;
    if (ctx.state === 'suspended') ctx.resume();

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