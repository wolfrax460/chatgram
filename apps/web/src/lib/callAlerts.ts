/**
 * Incoming-call alerts: ringtone, browser notification and tab title.
 *
 * Kept separate from the call engine so the WebRTC state machine does not touch
 * the DOM, audio graph or Notification API directly.
 */

let audioContext: AudioContext | null = null;
let ringTimer: number | null = null;
let savedTitle: string | null = null;
let notification: Notification | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  return audioContext;
}

/** Two-tone ring pattern, repeated while the call is incoming. */
export function startRingtone(): void {
  const ctx = context();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  if (ringTimer) return;

  const beep = (at: number, frequency: number) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.16, at + 0.02);
    gain.gain.linearRampToValueAtTime(0, at + 0.32);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.34);
  };

  const pattern = () => {
    const now = ctx.currentTime + 0.05;
    beep(now, 880);
    beep(now + 0.45, 660);
    beep(now + 0.9, 880);
  };

  pattern();
  ringTimer = window.setInterval(pattern, 2_400);
}

export function stopRingtone(): void {
  if (ringTimer) window.clearInterval(ringTimer);
  ringTimer = null;
  if (audioContext && audioContext.state === 'running') {
    // Suspend rather than close so the next call can reuse the context after a
    // user gesture without hitting autoplay restrictions.
    void audioContext.suspend().catch(() => undefined);
  }
}

/** Ask once for notification permission (calls only; never on page load). */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

export function showIncomingNotification(input: {
  title: string;
  body: string;
  onOpen: () => void;
  onDecline: () => void;
}): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  clearNotification();
  try {
    notification = new Notification(input.title, {
      body: input.body,
      tag: 'chatgram-incoming-call',
      requireInteraction: true,
      silent: true, // the ringtone already plays
      // Action buttons are honoured on desktop Chromium; ignored elsewhere.
      actions: [
        { action: 'accept', title: 'Answer' },
        { action: 'decline', title: 'Decline' },
      ],
    } as NotificationOptions & { actions: { action: string; title: string }[]; requireInteraction: boolean });

    notification.onclick = () => {
      window.focus();
      input.onOpen();
      clearNotification();
    };
    notification.addEventListener('close', () => {
      notification = null;
    });
    // Some browsers fire the action through a non-standard event.
    notification.addEventListener('notificationclick' as never, (event: Event) => {
      const action = (event as Event & { action?: string }).action;
      if (action === 'decline') input.onDecline();
      else input.onOpen();
      clearNotification();
    });
  } catch {
    notification = null;
  }
}

export function clearNotification(): void {
  if (notification) {
    try {
      notification.close();
    } catch {
      /* already closed */
    }
    notification = null;
  }
}

/** Show the call in the tab title, remembering the previous title. */
export function setCallTitle(title: string | null): void {
  if (typeof document === 'undefined') return;
  if (title) {
    if (savedTitle === null) savedTitle = document.title;
    document.title = title;
  } else if (savedTitle !== null) {
    document.title = savedTitle;
    savedTitle = null;
  }
}
