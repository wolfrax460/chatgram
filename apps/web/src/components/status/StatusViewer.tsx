import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Pause, Play, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import type { StatusItem } from '@chatgram/core';
import { api } from '../../lib/api';
import { AudioPlayer } from './AudioPlayer';
import { Avatar, timeAgo } from './Parts';

export interface StatusGroup {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  items: StatusItem[];
  latest: string;
}

const IMAGE_DURATION_MS = 5000;
const HOLD_SUPPRESS_MS = 260;

/**
 * Full-screen status viewer.
 *
 * - images auto-advance after 5 s with a progress bar
 * - videos and voice notes play to the end, then advance
 * - press and hold pauses; tap left/right or swipe goes back/forward
 * - arrow keys / space work too, Esc closes
 * - media is always `object-contain` in a black letterbox (never cropped)
 */
export function StatusViewer({
  group,
  meId,
  onClose,
}: {
  group: StatusGroup;
  meId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');

  const item = group.items[index];
  const mine = group.userId === meId;
  const kind = item?.mediaType ?? (item?.mediaUrl ? 'image' : null);
  // A text-only status advances on the same 5 s clock as a photo.
  const autoTimed = kind === 'image' || kind === null;

  const pointerStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const suppressClick = useRef(false);

  const finish = useCallback(() => onClose(), [onClose]);

  const next = useCallback(() => {
    setProgress(0);
    setPaused(false);
    setIndex((current) => {
      if (current + 1 < group.items.length) return current + 1;
      onClose();
      return current;
    });
  }, [group.items.length, onClose]);

  const prev = useCallback(() => {
    setProgress(0);
    setPaused(false);
    setIndex((current) => (current > 0 ? current - 1 : 0));
  }, []);

  const current = group.items[index];

  // Reset per item + mark it viewed.
  useEffect(() => {
    setProgress(0);
    setPaused(false);
    setError('');
    if (!current) return;
    if (!mine) api.viewStatus(current.id).catch(() => {});
  }, [current, mine]);

  // Image / text auto-advance: a rAF clock so pause/resume is exact.
  useEffect(() => {
    if (!current || !autoTimed || paused) return undefined;
    const already = progress * IMAGE_DURATION_MS;
    const startedAt = performance.now() - already;
    let frame = 0;
    const tick = () => {
      const value = Math.min(1, (performance.now() - startedAt) / IMAGE_DURATION_MS);
      setProgress(value);
      if (value >= 1) {
        next();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `progress` is intentionally not a dependency: it changes every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, autoTimed, paused, next]);

  // Keyboard controls.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') finish();
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'ArrowLeft') prev();
      else if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        setPaused((value) => !value);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, next, prev]);

  if (!current) return null;

  async function remove() {
    if (!current) return;
    try {
      await api.deleteStatus(current.id);
      void queryClient.invalidateQueries({ queryKey: ['statuses'] });
      next();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this status.');
    }
  }

  function onPointerDown(event: React.PointerEvent) {
    pointerStart.current = { x: event.clientX, y: event.clientY, at: Date.now() };
    suppressClick.current = false;
    setPaused(true);
  }

  function onPointerUp(event: React.PointerEvent) {
    const start = pointerStart.current;
    pointerStart.current = null;
    setPaused(false);
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const held = Date.now() - start.at;

    // A hold (>= 260 ms) is a pause gesture, not a tap.
    if (held >= HOLD_SUPPRESS_MS && Math.abs(dx) < 40 && Math.abs(dy) < 40) {
      suppressClick.current = true;
      return;
    }
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      suppressClick.current = true;
      if (dx < 0) next();
      else prev();
    }
  }

  function zoneAction(action: () => void) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    action();
  }

  return (
    <div className="fixed inset-0 z-50 flex select-none flex-col bg-black/95 animate-fade-up" data-testid="status-viewer">
      {/* progress bars */}
      <div className="flex gap-1 px-3 pt-3">
        {group.items.map((status, barIndex) => {
          const value = barIndex < index ? 1 : barIndex > index ? 0 : progress;
          return (
            <div
              key={status.id}
              className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25"
              data-testid="status-progress"
              role="progressbar"
              aria-label={`Status ${barIndex + 1} of ${group.items.length}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(value * 100)}
            >
              {/*
                No CSS width transition here: progress is updated every frame
                (image timer) or a few times a second (video/audio). A transition
                would restart on every update and the bar would stay empty.
              */}
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${value * 100}%` }}
                data-testid="status-progress-fill"
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 px-3 py-3">
        <Avatar name={group.displayName} src={group.avatarUrl} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{group.displayName}</p>
          <p className="text-[11px] text-white/60">{timeAgo(current.createdAt)}</p>
        </div>
        {kind === 'video' ? (
          <button
            type="button"
            className="text-white/80 hover:text-white"
            onClick={() => setMuted((value) => !value)}
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute video' : 'Mute video'}
          >
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        ) : null}
        {paused ? (
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15 text-white" aria-label="Paused">
            <Pause className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {mine ? (
          <button type="button" className="text-white/80 hover:text-white" onClick={() => void remove()} title="Delete" aria-label="Delete status">
            <Trash2 className="h-5 w-5" />
          </button>
        ) : null}
        <button type="button" className="text-white/80 hover:text-white" onClick={finish} title="Close" aria-label="Close status viewer">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center px-4 pb-6"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pointerStart.current = null;
          setPaused(false);
        }}
      >
        <button
          type="button"
          className="absolute left-0 top-0 z-10 h-full w-1/4 opacity-0"
          onClick={() => zoneAction(prev)}
          aria-label="Previous status"
        >
          <ChevronLeft className="mx-auto h-6 w-6 text-white/40" />
        </button>
        <button
          type="button"
          className="absolute right-0 top-0 z-10 h-full w-1/4 opacity-0"
          onClick={() => zoneAction(next)}
          aria-label="Next status"
        >
          <ChevronRight className="mx-auto h-6 w-6 text-white/40" />
        </button>

        <div className="max-h-full w-full max-w-lg text-center">
          {error ? (
            <p role="alert" className="mb-2 text-sm text-rose-400">
              {error}
            </p>
          ) : null}

          {current.mediaUrl && kind === 'image' ? (
            <img
              src={current.mediaUrl}
              alt={current.text || 'Status photo'}
              className="mx-auto max-h-[68vh] w-auto max-w-full rounded-xl bg-black object-contain"
              data-testid="status-media-image"
            />
          ) : null}

          {current.mediaUrl && kind === 'video' ? (
            <VideoStatus
              key={current.id}
              src={current.mediaUrl}
              poster={current.thumbnailUrl}
              paused={paused}
              muted={muted}
              onProgress={setProgress}
              onEnded={next}
              onError={() => setError('This video could not be played.')}
            />
          ) : null}

          {current.mediaUrl && kind === 'audio' ? (
            <div data-testid="status-audio-player">
              <AudioPlayer
                key={current.id}
                src={current.mediaUrl}
                peaks={undefined}
                durationSeconds={current.durationSeconds}
                paused={paused}
                autoPlay
                dark
                onEnded={next}
              />
            </div>
          ) : null}

          {current.text ? (
            <p className="mx-auto mt-4 max-w-md whitespace-pre-wrap break-words text-lg font-medium text-white">
              {current.text}
            </p>
          ) : null}

          <p className="mt-4 text-[11px] text-white/40">
            {paused ? 'Paused — release to continue' : 'Hold to pause · tap sides or swipe to move'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Video surface that reports progress and pauses with the viewer. */
function VideoStatus({
  src,
  poster,
  paused,
  muted,
  onProgress,
  onEnded,
  onError,
}: {
  src: string;
  poster?: string;
  paused: boolean;
  muted: boolean;
  onProgress: (fraction: number) => void;
  onEnded: () => void;
  onError: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (paused) {
      video.pause();
      return;
    }
    void video.play().catch(() => {
      // Autoplay with sound may be blocked; try muted, otherwise ask for a tap.
      video.muted = true;
      void video.play().catch(() => setNeedsTap(true));
    });
  }, [paused]);

  return (
    <div className="relative mx-auto max-h-[68vh] w-full">
      <video
        ref={ref}
        src={src}
        poster={poster}
        playsInline
        muted={muted}
        autoPlay
        data-testid="status-media-video"
        className="mx-auto max-h-[68vh] w-auto max-w-full rounded-xl bg-black object-contain"
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          if (video.duration > 0) onProgress(Math.min(1, video.currentTime / video.duration));
        }}
        onEnded={onEnded}
        onError={onError}
      />
      {needsTap ? (
        <button
          type="button"
          className="absolute inset-0 grid place-items-center rounded-xl bg-black/40 text-white"
          onClick={() => {
            setNeedsTap(false);
            void ref.current?.play().catch(() => setNeedsTap(true));
          }}
        >
          <span className="flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-sm font-semibold">
            <Play className="h-4 w-4" /> Tap to play
          </span>
        </button>
      ) : null}
    </div>
  );
}
