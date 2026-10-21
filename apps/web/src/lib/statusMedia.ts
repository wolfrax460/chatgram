/**
 * Client-side media helpers for statuses (photos, videos, voice notes).
 *
 * Mirrors the server rules in `server/src/utils/statusMedia.js` so the user gets
 * an instant, specific error before a 50 MB upload starts. The server enforces
 * the same rules again.
 */

export type StatusMediaKind = 'image' | 'video' | 'audio';

export const STATUS_LIMITS = {
  image: { maxBytes: 10 * 1024 * 1024, maxDurationSeconds: null as number | null },
  video: { maxBytes: 50 * 1024 * 1024, maxDurationSeconds: 60 },
  audio: { maxBytes: 20 * 1024 * 1024, maxDurationSeconds: 600 },
} as const;

const MIME_KIND: Record<string, StatusMediaKind> = {
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/x-m4a': 'audio',
  'audio/m4a': 'audio',
  'audio/ogg': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/webm': 'audio',
  'audio/aac': 'audio',
};

/** File input `accept` value — extension + MIME so every picker shows them. */
export const STATUS_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov,.mp3,.m4a,.ogg,.wav,' +
  'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,' +
  'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm';

export function kindFromMime(mimetype: string): StatusMediaKind | null {
  return MIME_KIND[String(mimetype || '').toLowerCase()] || null;
}

/** Fall back to the extension when the browser reports an empty MIME type. */
export function kindFromFile(file: File): StatusMediaKind | null {
  const fromMime = kindFromMime(file.type);
  if (fromMime) return fromMime;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'm4a', 'ogg', 'wav', 'aac'].includes(ext)) return 'audio';
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  const mb = bytes / (1024 * 1024);
  // 10 MB, not 10.0 MB — limits are what the error message quotes.
  return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(1)} MB`;
}

export function formatDuration(seconds: number | undefined | null): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Check a file against the status limits.
 * @returns null when fine, otherwise a message that states the limit.
 */
export function validateStatusFile(
  file: File,
  kind: StatusMediaKind | null,
  durationSeconds?: number | null,
): string | null {
  if (!kind) {
    return 'That file type cannot be used in a status. Use an image (jpg, png, webp, gif), a video (mp4, webm, mov) or audio (mp3, m4a, ogg, wav).';
  }
  const limit = STATUS_LIMITS[kind];
  if (file.size > limit.maxBytes) {
    return `That ${kind} is ${formatBytes(file.size)}, which is larger than the ${formatBytes(limit.maxBytes)} limit.`;
  }
  if (kind === 'video') {
    if (!Number.isFinite(Number(durationSeconds))) {
      return 'The video duration could not be read. Try a different file.';
    }
    if (Number(durationSeconds) > STATUS_LIMITS.video.maxDurationSeconds + 0.5) {
      return `Videos must be ${STATUS_LIMITS.video.maxDurationSeconds} seconds or shorter. Trim it and try again.`;
    }
  }
  if (kind === 'audio' && Number(durationSeconds) > STATUS_LIMITS.audio.maxDurationSeconds) {
    return `Audio must be ${Math.round(STATUS_LIMITS.audio.maxDurationSeconds / 60)} minutes or shorter.`;
  }
  return null;
}

/* ------------------------------------------------------------------ probes */

function waitForMediaEvent(
  element: HTMLMediaElement,
  event: string,
  timeoutMs = 8000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: number | null = null;
    const done = () => {
      element.removeEventListener(event, done);
      element.removeEventListener('error', onError);
      if (timer) window.clearTimeout(timer);
      resolve();
    };
    const onError = () => {
      element.removeEventListener(event, done);
      element.removeEventListener('error', onError);
      if (timer) window.clearTimeout(timer);
      reject(new Error('The browser could not read this file.'));
    };
    element.addEventListener(event, done, { once: true });
    element.addEventListener('error', onError, { once: true });
    timer = window.setTimeout(() => {
      element.removeEventListener(event, done);
      element.removeEventListener('error', onError);
      reject(new Error('Reading the file took too long. Try a different file.'));
    }, timeoutMs);
  });
}

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
  /** Poster frame as a JPEG blob, ready to upload. */
  thumbnailBlob: Blob | null;
}

/** Read duration/size and capture a poster frame from a local video file. */
export async function probeVideo(file: File): Promise<VideoProbe> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await waitForMediaEvent(video, 'loadedmetadata');
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;

    let thumbnailBlob: Blob | null = null;
    try {
      const sampleAt = Math.min(1, Math.max(0.1, duration / 3));
      video.currentTime = sampleAt;
      await waitForMediaEvent(video, 'seeked');
      const canvas = document.createElement('canvas');
      const scale = width > 0 ? Math.min(1, 1280 / width) : 1;
      canvas.width = Math.max(1, Math.round((width || 640) * scale));
      canvas.height = Math.max(1, Math.round((height || 360) * scale));
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbnailBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72),
        );
      }
    } catch {
      // A poster is nice-to-have; never block posting a video because of it.
      thumbnailBlob = null;
    }

    return { duration, width, height, thumbnailBlob };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export interface AudioProbe {
  duration: number;
  /** 0..1 amplitudes for a waveform, ~72 bars. */
  peaks: number[];
}

/** Decode a local audio file for duration + waveform peaks. */
export async function probeAudio(file: File): Promise<AudioProbe> {
  const fallback = await probeAudioDuration(file).catch(() => ({ duration: 0, peaks: [] as number[] }));
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return fallback;
    const context = new Ctor();
    try {
      const buffer = await file.arrayBuffer();
      const decoded = await context.decodeAudioData(buffer.slice(0));
      const channel = decoded.getChannelData(0);
      const bars = 72;
      const block = Math.max(1, Math.floor(channel.length / bars));
      const peaks: number[] = [];
      for (let bar = 0; bar < bars; bar += 1) {
        let peak = 0;
        const start = bar * block;
        for (let i = start; i < Math.min(start + block, channel.length); i += 1) {
          const value = Math.abs(channel[i] ?? 0);
          if (value > peak) peak = value;
        }
        peaks.push(peak);
      }
      const max = Math.max(0.0001, ...peaks);
      return {
        duration: decoded.duration || fallback.duration,
        peaks: peaks.map((value) => Math.max(0.08, value / max)),
      };
    } finally {
      void context.close();
    }
  } catch {
    return fallback;
  }
}

/** Duration-only fallback that works for every format the browser can play. */
async function probeAudioDuration(file: File): Promise<AudioProbe> {
  const url = URL.createObjectURL(file);
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.src = url;
  try {
    await waitForMediaEvent(audio, 'loadedmetadata');
    return {
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      peaks: [],
    };
  } finally {
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
}

/** Turn an image file into a small JPEG (used for video poster if needed). */
export async function imageFileDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not read the image.'));
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
