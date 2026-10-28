import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import {
  claimVoicePlayback,
  nextVoiceSpeed,
  persistVoiceSpeed,
  readVoiceSpeed,
  type VoiceSpeed,
} from '../lib/voicePlayback';
import { loadVoiceWaveform, VOICE_PEAK_BARS } from '../lib/voiceWaveform';

/** Flat placeholder while peaks load, while decoding fails, or in silence. */
const FLAT_PEAKS: number[] = Array.from({ length: VOICE_PEAK_BARS }, () => 0.1);

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** One amplitude layer; the coloured copy is clipped to the played fraction. */
function WaveBars({ peaks, color }: { peaks: number[]; color: string }) {
  return (
    <div className="flex h-full w-full items-center gap-[1.5px]" aria-hidden="true">
      {peaks.map((peak, index) => (
        <span
          key={index}
          className={`min-w-0 flex-1 rounded-full ${color}`}
          style={{ height: `${Math.max(3, Math.round(peak * 28))}px` }}
        />
      ))}
    </div>
  );
}

/**
 * WhatsApp-style voice-note player.
 *
 * - waveform peaks are decoded from the clip (URL) and cached, so a bubble never
 *   decodes twice; when decoding fails it shows a flat bar but still plays
 * - the waveform is a real slider: click/tap/drag to seek, arrow keys/Home/End
 * - 1× → 1.5× → 2× playback speed, remembered in localStorage
 * - starting a note pauses whichever note was already playing
 * - the played part of the waveform is revealed with a moving clipped fill
 */
export function VoiceNotePlayer({ src, mine }: { src: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const speedRef = useRef<VoiceSpeed>(readVoiceSpeed());

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<VoiceSpeed>(() => speedRef.current);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Decode the waveform once per clip; the helper caches by URL.
  useEffect(() => {
    let alive = true;
    setPeaks(null);
    setFailed(false);
    void loadVoiceWaveform(src).then((waveform) => {
      if (!alive) return;
      if (waveform.peaks.length > 0) setPeaks(waveform.peaks);
      if (waveform.duration > 0) setDuration((previous) => (previous > 0 ? previous : waveform.duration));
    });
    return () => {
      alive = false;
    };
  }, [src]);

  // Keep the element in sync with the remembered speed.
  useEffect(() => {
    speedRef.current = speed;
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed]);

  // Stop playing (and free the single-playback slot) when the bubble unmounts.
  useEffect(
    () => () => {
      releaseRef.current?.();
      releaseRef.current = null;
      audioRef.current?.pause();
    },
    [],
  );

  const release = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = null;
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (audio.ended || (duration > 0 && audio.currentTime >= duration)) audio.currentTime = 0;
    releaseRef.current = claimVoicePlayback(() => audio.pause());
    audio.playbackRate = speedRef.current;
    void audio.play().catch(() => {
      release();
      setFailed(true);
    });
  }, [duration, release]);

  const seekTo = useCallback(
    (fraction: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
      if (!total) return;
      const next = Math.min(total, Math.max(0, fraction * total));
      audio.currentTime = next;
      setCurrent(next);
    },
    [duration],
  );

  function fractionOf(event: React.PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    return (event.clientX - rect.left) / Math.max(1, rect.width);
  }

  function seekBy(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    if (!total) return;
    seekTo(audio.currentTime / total + delta);
  }

  function cycleSpeed() {
    const next = nextVoiceSpeed(speed);
    setSpeed(next);
    persistVoiceSpeed(next);
    const audio = audioRef.current;
    if (audio) audio.playbackRate = next;
  }

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const bars = peaks && peaks.length > 0 ? peaks : FLAT_PEAKS;

  return (
    <div
      className={`mb-1 flex w-[246px] max-w-full flex-col gap-1 rounded-xl px-2 py-1.5 ${
        mine ? 'bg-white/15' : 'bg-black/[.045] dark:bg-white/10'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          data-testid="voice-play"
          aria-label={playing ? 'Pause playback' : 'Play voice message'}
          title={playing ? 'Pause playback' : 'Play voice message'}
          onClick={toggle}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition active:scale-95 ${
            mine ? 'bg-white text-brand-700 hover:bg-white/90' : 'bg-brand-600 text-white hover:bg-brand-700'
          }`}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </button>

        <div
          data-testid="voice-waveform"
          role="slider"
          tabIndex={0}
          aria-label="Seek voice message"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuetext={`${formatClock(current)} of ${formatClock(duration)}`}
          className={`relative h-9 min-w-0 flex-1 cursor-pointer touch-none select-none rounded-md focus:outline-none focus-visible:ring-2 ${
            mine ? 'focus-visible:ring-white/70' : 'focus-visible:ring-brand-500/70'
          }`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekTo(fractionOf(event));
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            seekTo(fractionOf(event));
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              seekBy(event.shiftKey ? -0.2 : -0.05);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              seekBy(event.shiftKey ? 0.2 : 0.05);
            } else if (event.key === 'Home') {
              event.preventDefault();
              seekTo(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              seekTo(1);
            }
          }}
        >
          <WaveBars peaks={bars} color={mine ? 'bg-white/40' : 'bg-ink-300 dark:bg-white/25'} />
          <div
            data-testid="voice-progress"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ clipPath: `inset(0 ${Math.round((1 - progress) * 100)}% 0 0)` }}
          >
            <WaveBars peaks={bars} color={mine ? 'bg-white' : 'bg-brand-600 dark:bg-brand-300'} />
          </div>
        </div>
      </div>

      <div
        className={`flex items-center justify-between gap-2 text-[10.5px] tabular-nums ${
          mine ? 'text-white/75' : 'text-ink-500 dark:text-ink-400'
        }`}
      >
        <span>
          {formatClock(current)} / {formatClock(duration)}
        </span>
        <button
          type="button"
          data-testid="voice-speed"
          aria-label={`Playback speed ${speed}×`}
          title="Playback speed"
          onClick={cycleSpeed}
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold transition ${
            mine ? 'hover:bg-white/15' : 'hover:bg-ink-100 dark:hover:bg-white/10'
          }`}
        >
          {speed}×
        </button>
      </div>

      {failed ? (
        <p role="alert" className={`text-[10.5px] ${mine ? 'text-white/90' : 'text-rose-600 dark:text-rose-400'}`}>
          This voice message could not be played.
        </p>
      ) : null}

      {/* Playback always uses a plain <audio> element, so an undecodable clip
          still plays even though it has no waveform. */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const total = event.currentTarget.duration;
          if (Number.isFinite(total) && total > 0) setDuration(total);
          event.currentTarget.playbackRate = speedRef.current;
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          release();
        }}
        onEnded={() => {
          setPlaying(false);
          release();
        }}
        onError={() => {
          setPlaying(false);
          setFailed(true);
        }}
      />
    </div>
  );
}
