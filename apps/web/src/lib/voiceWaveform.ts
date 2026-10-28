/**
 * Waveform peaks for voice notes.
 *
 * The clip is fetched once, decoded with `AudioContext.decodeAudioData`, reduced
 * to a fixed number of amplitude bars and cached by media URL. Re-rendering a
 * bubble or reopening a chat therefore never decodes the same clip twice.
 *
 * Decoding is best-effort: a container the browser cannot decode, an offline
 * network or a CDN that blocks the CORS read all yield `peaks: []`. The player
 * then draws a flat bar, while playback (a plain `<audio>` element) still works.
 */

export const VOICE_PEAK_BARS = 44;

export interface VoiceWaveform {
  /** 0..1 amplitudes, length VOICE_PEAK_BARS (empty when undecodable). */
  peaks: number[];
  /** Duration in seconds reported by the decoder, 0 when unknown. */
  duration: number;
}

const EMPTY: VoiceWaveform = { peaks: [], duration: 0 };
const cache = new Map<string, VoiceWaveform>();
const inflight = new Map<string, Promise<VoiceWaveform>>();
const MAX_CACHE_ENTRIES = 100;

let waveformContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!waveformContext || waveformContext.state === 'closed') waveformContext = new Ctor();
    return waveformContext;
  } catch {
    // Some WebViews refuse to create a context without a user gesture; the
    // caller falls back to a flat waveform.
    return null;
  }
}

function reduceToPeaks(channel: Float32Array, bars: number): number[] {
  if (channel.length === 0) return [];
  const block = Math.max(1, Math.floor(channel.length / bars));
  const peaks: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    let peak = 0;
    const start = bar * block;
    const end = Math.min(start + block, channel.length);
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(channel[index] ?? 0);
      if (value > peak) peak = value;
    }
    peaks.push(peak);
  }
  const max = Math.max(0.0001, ...peaks);
  // Keep even silence visible as a thin bar instead of a gap.
  return peaks.map((value) => Math.max(0.08, value / max));
}

async function decode(buffer: ArrayBuffer): Promise<VoiceWaveform> {
  const context = getAudioContext();
  if (!context) return EMPTY;
  try {
    // decodeAudioData detaches the buffer it receives, so pass a copy.
    const decoded = await context.decodeAudioData(buffer.slice(0));
    return {
      peaks: reduceToPeaks(decoded.getChannelData(0), VOICE_PEAK_BARS),
      duration: Number.isFinite(decoded.duration) ? decoded.duration : 0,
    };
  } catch {
    return EMPTY;
  }
}

function remember(src: string, waveform: VoiceWaveform): VoiceWaveform {
  cache.set(src, waveform);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return waveform;
}

/** Peaks for one voice-note URL, decoded at most once (in-flight calls share). */
export function loadVoiceWaveform(src: string): Promise<VoiceWaveform> {
  if (!src) return Promise.resolve(EMPTY);
  const cached = cache.get(src);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(src);
  if (pending) return pending;

  const promise = (async (): Promise<VoiceWaveform> => {
    try {
      const response = await fetch(src, { credentials: 'same-origin' });
      if (!response.ok) return remember(src, EMPTY);
      const buffer = await response.arrayBuffer();
      return remember(src, await decode(buffer));
    } catch {
      // Network / CORS / undecodable: cache the failure so a broken clip is not
      // retried on every render, and let the player draw its flat fallback.
      return remember(src, EMPTY);
    } finally {
      inflight.delete(src);
    }
  })();

  inflight.set(src, promise);
  return promise;
}

/** Forget every cached waveform (used by tests/manual debugging). */
export function clearVoiceWaveformCache(): void {
  cache.clear();
  inflight.clear();
}
