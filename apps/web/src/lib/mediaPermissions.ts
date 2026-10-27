/**
 * Microphone / camera access, in one place.
 *
 * Three jobs:
 *  1. preflight — is this a secure context, what does the Permissions API say
 *     before we ask (so a hard "denied" is explained instead of just retried);
 *  2. classification — turn the DOMException from getUserMedia into a message a
 *     normal person can act on, with the exact taps for their platform;
 *  3. hand-off — publish the explanation to the `MediaPermissionDialog` and keep
 *     the retry callback alive so "Try again" re-runs the real action (start the
 *     call, answer the call, start the voice note).
 *
 * Nothing here throws: callers get a `MediaErrorInfo` they can render.
 */

export type MediaKind = 'microphone' | 'camera' | 'camera+microphone';
export type PermissionName = 'microphone' | 'camera';
export type PermissionQueryState = 'granted' | 'denied' | 'prompt' | 'unsupported';
export type MediaPlatform = 'android-app' | 'android-chrome' | 'ios-safari' | 'ios-browser' | 'desktop' | 'unknown';

export interface MediaErrorInfo {
  /** The DOMException name we actually caught, for the debug line. */
  errorName: string;
  kind: MediaKind;
  platform: MediaPlatform;
  /** Short headline, e.g. "Microphone access is blocked". */
  title: string;
  /** One sentence with what to do next. */
  message: string;
  /** Step-by-step instructions for this exact platform. */
  steps: string[];
  /** False when retrying cannot help (no device at all, insecure origin). */
  canRetry: boolean;
  /** True when the page is not a secure context (getUserMedia is impossible). */
  insecureContext: boolean;
}

const KIND_LABEL: Record<MediaKind, string> = {
  microphone: 'Microphone',
  camera: 'Camera',
  'camera+microphone': 'Microphone and camera',
};

const CAPACITOR = (): { getPlatform?: () => string; isNativePlatform?: () => boolean } | null => {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } })
    .Capacitor;
  return cap ?? null;
};

/** Where is this code running? Drives which instructions we show. */
export function detectMediaPlatform(): MediaPlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const cap = CAPACITOR();
  if (cap?.isNativePlatform?.() === true) {
    const platform = cap.getPlatform?.();
    if (platform === 'android') return 'android-app';
    if (platform === 'ios') return 'ios-safari';
  }
  const ua = navigator.userAgent || '';
  const android = /Android/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) {
    const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
    return safari ? 'ios-safari' : 'ios-browser';
  }
  if (android) return 'android-chrome';
  if (/Windows|Macintosh|X11|Linux/i.test(ua)) return 'desktop';
  return 'unknown';
}

/** getUserMedia only exists in a secure context (https or localhost). */
export function isSecureMediaContext(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext === true) return true;
  // A localhost preview is still secure even when isSecureContext is missing.
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/** True when this device/browser can capture audio at all. */
export function hasMediaCapture(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
}

/**
 * Ask the Permissions API without prompting. Chrome supports "camera" and
 * "microphone"; Safari and some WebViews reject the descriptor, which is why
 * "unsupported" is a normal answer and never treated as "denied".
 */
export async function queryMediaPermission(name: PermissionName): Promise<PermissionQueryState> {
  if (typeof navigator === 'undefined') return 'unsupported';
  const permissions = navigator.permissions;
  if (!permissions || typeof permissions.query !== 'function') return 'unsupported';
  try {
    const descriptor = { name } as PermissionDescriptor;
    const status = await permissions.query(descriptor);
    if (status.state === 'granted' || status.state === 'denied') return status.state;
    return 'prompt';
  } catch {
    return 'unsupported';
  }
}

/** "microphone" | "camera" | both, from the constraints we are about to request. */
export function mediaKindOf(constraints: MediaStreamConstraints | { audio?: boolean; video?: boolean }): MediaKind {
  const wantsAudio = Boolean(constraints.audio);
  const wantsVideo = Boolean(constraints.video);
  if (wantsVideo && wantsAudio) return 'camera+microphone';
  if (wantsVideo) return 'camera';
  return 'microphone';
}

function instructions(kind: MediaKind, platform: MediaPlatform): string[] {
  const label = KIND_LABEL[kind];
  switch (platform) {
    case 'android-app':
      return [
        'Open your phone Settings (not the browser menu).',
        `Apps → Chatgram → Permissions → ${label}.`,
        'Choose “Allow” (or “Allow only while using the app”).',
        'Come back to Chatgram and tap Try again.',
      ];
    case 'android-chrome':
      return [
        'Tap the lock / settings icon on the left of the address bar.',
        'Tap Permissions → Microphone (and Camera).',
        'Choose Allow, then reload the page.',
        'If the icon is not there: Chrome ⋮ → Settings → Site settings → Microphone → find this site → Allow.',
      ];
    case 'ios-safari':
      return [
        'Tap the “Aa” button in the address bar.',
        'Tap Website Settings.',
        `Set ${label} to Allow.`,
        'Reload the page, then tap Try again.',
        'Still blocked? iOS Settings app → Safari → Microphone → Allow.',
      ];
    case 'ios-browser':
      return [
        'Open the iOS Settings app.',
        `Find your browser → ${label} → Allow.`,
        'Also allow the microphone for Safari if you switched browsers.',
        'Come back and tap Try again.',
      ];
    case 'desktop':
      return [
        'Click the lock / tune icon at the left of the address bar.',
        `Set ${label} to Allow.`,
        'Reload the page, then tap Try again.',
        'macOS: System Settings → Privacy & Security → Microphone → enable your browser.',
      ];
    default:
      return [
        `Allow ${label.toLowerCase()} access for this site in your browser settings.`,
        'Reload the page, then tap Try again.',
      ];
  }
}

const NAME_COPY: Record<string, { title: string; message: string; canRetry: boolean }> = {
  NotAllowedError: {
    title: 'Microphone access is blocked',
    message: 'The browser or system is blocking access, so the call cannot start.',
    canRetry: true,
  },
  PermissionDeniedError: {
    title: 'Microphone access is blocked',
    message: 'The browser or system is blocking access, so the call cannot start.',
    canRetry: true,
  },
  NotFoundError: {
    title: 'No microphone found',
    message: 'This device has no microphone the browser can use, or it is disconnected.',
    canRetry: true,
  },
  DevicesNotFoundError: {
    title: 'No microphone found',
    message: 'This device has no microphone the browser can use, or it is disconnected.',
    canRetry: true,
  },
  NotReadableError: {
    title: 'The microphone is busy',
    message: 'Another app is using the microphone (another call, a recorder or a voice assistant). Close it and try again.',
    canRetry: true,
  },
  TrackStartError: {
    title: 'The microphone could not start',
    message: 'Another app may be holding the microphone. Close it and try again.',
    canRetry: true,
  },
  OverconstrainedError: {
    title: 'The camera does not support these settings',
    message: 'We asked for a higher resolution than this device offers. Retrying drops the camera and starts with audio only.',
    canRetry: true,
  },
  ConstraintNotSatisfiedError: {
    title: 'The camera does not support these settings',
    message: 'We asked for a higher resolution than this device offers. Retrying drops the camera and starts with audio only.',
    canRetry: true,
  },
  SecurityError: {
    title: 'Camera and microphone need a secure page',
    message: 'This page is not served over HTTPS, so the browser refuses to record.',
    canRetry: false,
  },
  TypeError: {
    title: 'Camera and microphone are unavailable here',
    message: 'This browser (or this in-app browser) does not expose media capture.',
    canRetry: false,
  },
  AbortError: {
    title: 'The microphone stopped',
    message: 'The capture was interrupted by the system or by another app.',
    canRetry: true,
  },
};

/**
 * Turn a getUserMedia rejection into something the dialog can show.
 * `error` is `unknown` because DOMException is not always in the lib target.
 */
export function describeMediaError(error: unknown, kind: MediaKind = 'microphone'): MediaErrorInfo {
  const platform = detectMediaPlatform();
  const secure = isSecureMediaContext();
  const errorName = error instanceof Error ? error.name : typeof error === 'string' ? error : 'UnknownError';
  const base = NAME_COPY[errorName];

  if (!secure) {
    const label = KIND_LABEL[kind].toLowerCase();
    return {
      errorName,
      kind,
      platform,
      title: 'Open Chatgram over HTTPS',
      message: `Browsers only allow the ${label} on a secure (https) page.`,
      steps: ['Use https://chatgram-xi.vercel.app, or the Chatgram Android app.', 'Then try the call again.'],
      canRetry: false,
      insecureContext: true,
    };
  }

  if (!base) {
    return {
      errorName,
      kind,
      platform,
      title: `${KIND_LABEL[kind]} unavailable`,
      message: 'The capture device could not be opened.',
      steps: instructions(kind, platform),
      canRetry: true,
      insecureContext: false,
    };
  }

  return {
    errorName,
    kind,
    platform,
    title:
      kind === 'camera+microphone' && (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError')
        ? 'Microphone and camera access is blocked'
        : kind === 'camera' && (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError')
          ? 'Camera access is blocked'
          : base.title,
    message: base.message,
    steps: instructions(kind, platform),
    canRetry: base.canRetry,
    insecureContext: false,
  };
}

/* ------------------------------------------------------------------ store */

type Listener = (issue: MediaIssue | null) => void;

export interface MediaIssue extends MediaErrorInfo {
  /** Re-runs the action that needed the device (call, answer, voice note). */
  retry: (() => void) | null;
}

let issue: MediaIssue | null = null;
const listeners = new Set<Listener>();

function publish(next: MediaIssue | null): void {
  issue = next;
  for (const listener of listeners) listener(issue);
}

export function subscribeMediaIssue(listener: Listener): () => void {
  listeners.add(listener);
  listener(issue);
  return () => listeners.delete(listener);
}

export function getMediaIssue(): MediaIssue | null {
  return issue;
}

/** Report a failed capture and offer the retry that should run afterwards. */
export function reportMediaFailure(error: unknown, kind: MediaKind, retry?: () => void): MediaIssue {
  const next: MediaIssue = { ...describeMediaError(error, kind), retry: retry ?? null };
  publish(next);
  return next;
}

export function dismissMediaIssue(): void {
  publish(null);
}

/** Close the dialog and run the action again (from a real tap). */
export function retryMediaIssue(): void {
  const retry = issue?.retry ?? null;
  publish(null);
  if (retry) retry();
}

/**
 * One-line summary for logs / the debug panel: no secrets, just the facts that
 * make a permission bug reproducible.
 */
export function mediaDiagnostics(): string {
  const platform = detectMediaPlatform();
  const secure = isSecureMediaContext() ? 'secure' : 'INSECURE';
  const capture = hasMediaCapture() ? 'capture-api' : 'no-capture-api';
  return `${platform} · ${secure} · ${capture} · ${navigator?.userAgent?.slice(0, 80) ?? 'no-ua'}`;
}
