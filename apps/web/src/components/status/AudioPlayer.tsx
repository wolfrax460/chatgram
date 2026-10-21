import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Music, Pause, Play } from 'lucide-react';

/**
 * Audio player for status voice notes: waveform, cover placeholder, seek by
 * clicking the waveform, and optional external pause control (the status viewer
 * pauses it while the user holds the screen).
 */
export function AudioPlayer({
  src,
  peaks,
  durationSeconds,
  onEnded,
  paused = false,
  autoPlay = false,
  dark = false,
  compact = false,
}: {
  src: string;
  peaks?: number[];
  durationSeconds?: number;
  onEnded?: () => void;
  /** When true the player is paused from outside (hold-to-pause in the viewer). */
  paused?: boolean;
  autoPlay?: boolean;
  dark?: boolean;
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationSeconds || 0);
  const [error, setError] = useState('');

  // A stable placeholder waveform when the browser could not decode the file.
  const bars = useMemo(() => {
    if (peaks && peaks.length > 4) return peaks;
    const seed = src.length + 17;
    return Array.from({ length: 64 }, (_, index) => {
      const value = Math.abs(Math.sin((index + 1) * seed * 0.017)) * 0.7 + 0.15;
      return Number(value.toFixed(2));
    });
  }, [peaks, src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTime = () => setCurrent(audio.currentTime);
    const onLoaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onFinish = () => {
      setPlaying(false);
      onEnded?.();
    };
    const onError = () => setError('This audio could not be played.');
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onFinish);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onFinish);
      audio.removeEventListener('error', onError);
    };
  }, [onEnded, src]);

  // External pause (hold-to-pause).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (paused) {
      audio.pause();
    } else if (playing) {
      void audio.play().catch(() => setPlaying(false));
    }
  }, [paused, playing]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setError('Your browser blocked playback. Tap play again.'));
    } else {
      audio.pause();
    }
  }, []);

  function seek(fraction: number) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.min(duration, Math.max(0, fraction * duration));
    setCurrent(audio.currentTime);
  }

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const playedBars = Math.round(progress * bars.length);

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl p-3 ${
        dark ? 'bg-white/10 text-white' : 'border border-ink-200 bg-white dark:border-white/10 dark:bg-ink-800'
      } ${compact ? '' : 'w-full'}`}
    >
      {/* cover placeholder */}
      <div
        className={`grid shrink-0 place-items-center rounded-xl bg-gradient-to-br ${
          dark ? 'from-brand-500/80 to-brand-800/90' : 'from-brand-500 to-brand-700'
        } text-white ${compact ? 'h-12 w-12' : 'h-16 w-16'}`}
        aria-hidden="true"
      >
        <Music className={compact ? 'h-5 w-5' : 'h-7 w-7'} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause voice note' : 'Play voice note'}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
              dark ? 'bg-white text-ink-900' : 'bg-brand-600 text-white'
            }`}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>

          <button
            type="button"
            className="flex h-10 flex-1 items-center gap-[2px] overflow-hidden focus:outline-none"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              seek((event.clientX - rect.left) / Math.max(1, rect.width));
            }}
            aria-label="Seek in voice note"
          >
            {bars.map((peak, index) => (
              <span
                key={index}
                className={`w-[3px] shrink-0 rounded-full ${
                  index < playedBars
                    ? dark
                      ? 'bg-white'
                      : 'bg-brand-600 dark:bg-brand-300'
                    : dark
                      ? 'bg-white/35'
                      : 'bg-ink-300 dark:bg-white/25'
                }`}
                style={{ height: `${Math.max(4, Math.round(peak * 30))}px` }}
              />
            ))}
          </button>
        </div>
        <div className={`mt-1 flex justify-between text-[11px] ${dark ? 'text-white/70' : 'text-ink-500 dark:text-ink-400'}`}>
          <span>{formatTime(current)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        {error ? <p className="mt-1 text-[11px] text-rose-400">{error}</p> : null}
      </div>

      <audio ref={audioRef} src={src} preload="metadata" autoPlay={autoPlay} className="hidden" />
    </div>
  );
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
