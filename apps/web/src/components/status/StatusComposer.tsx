import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Crop, FileVideo, Image as ImageIcon, Mic, Music, Send, Upload, X,
} from 'lucide-react';
import { api } from '../../lib/api';
import {
  STATUS_ACCEPT, STATUS_LIMITS, formatBytes, formatDuration, kindFromFile,
  probeAudio, probeVideo, validateStatusFile, type AudioProbe, type StatusMediaKind, type VideoProbe,
} from '../../lib/statusMedia';
import { AudioPlayer } from './AudioPlayer';

type Phase = 'idle' | 'uploading' | 'posting';

export function StatusComposer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<StatusMediaKind | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoProbe | null>(null);
  const [audio, setAudio] = useState<AudioProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const acceptRef = useRef<string>(STATUS_ACCEPT);
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const busy = phase !== 'idle';

  const setPreview = useCallback((url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }, []);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const reset = useCallback(() => {
    setFile(null);
    setKind(null);
    setVideo(null);
    setAudio(null);
    setPreview(null);
    setError('');
    setProgress(0);
    setProbing(false);
  }, [setPreview]);

  async function handleFile(picked: File) {
    if (busy) return;
    setError('');
    const detected = kindFromFile(picked);
    if (!detected) {
      setError(
        validateStatusFile(picked, null) ||
          'That file type cannot be used in a status. Use an image, a video or audio.',
      );
      return;
    }
    const limit = STATUS_LIMITS[detected];
    if (picked.size > limit.maxBytes) {
      setError(
        `That ${detected} is ${formatBytes(picked.size)}, which is larger than the ${formatBytes(limit.maxBytes)} limit.`,
      );
      return;
    }

    setFile(picked);
    setKind(detected);
    setVideo(null);
    setAudio(null);
    setPreview(URL.createObjectURL(picked));
    setProbing(true);
    try {
      if (detected === 'video') {
        const probe = await probeVideo(picked);
        const problem = validateStatusFile(picked, detected, probe.duration);
        if (problem) {
          setError(problem);
          setVideo(null);
        } else {
          setVideo(probe);
        }
      } else if (detected === 'audio') {
        const probe = await probeAudio(picked);
        const problem = validateStatusFile(picked, detected, probe.duration);
        if (problem) {
          setError(problem);
          setAudio(null);
        } else {
          setAudio(probe);
        }
      }
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : 'That file could not be read.');
    } finally {
      setProbing(false);
    }
  }

  function pick(kindToPick: StatusMediaKind | 'any') {
    acceptRef.current =
      kindToPick === 'any'
        ? STATUS_ACCEPT
        : kindToPick === 'image'
          ? 'image/jpeg,image/png,image/webp,image/gif'
          : kindToPick === 'video'
            ? 'video/mp4,video/webm,video/quicktime'
            : 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm';
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.click();
    }
  }

  async function post() {
    if (busy) return;
    if (!file && !caption.trim()) {
      setError('Add a caption, a photo, a video or a voice note before posting.');
      return;
    }
    if (file && !kind) {
      setError('That file type cannot be used in a status.');
      return;
    }
    if (file && kind) {
      const problem =
        kind === 'video'
          ? validateStatusFile(file, kind, video?.duration)
          : kind === 'audio'
            ? validateStatusFile(file, kind, audio?.duration)
            : validateStatusFile(file, kind);
      if (problem) {
        setError(problem);
        return;
      }
    }

    setError('');
    setPhase(file ? 'uploading' : 'posting');
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let media: Parameters<typeof api.createStatus>[0] = {};

      if (file && kind) {
        const uploaded = await api.uploadStatusMedia(file, {
          durationSeconds: kind === 'video' ? video?.duration : kind === 'audio' ? audio?.duration : undefined,
          onProgress: (percent) => setProgress(percent),
          signal: controller.signal,
        });

        // Video poster frame — separate image upload. Optional: posting must not
        // fail because the poster could not be stored.
        let thumbnailUrl: string | undefined;
        if (kind === 'video' && video?.thumbnailBlob) {
          try {
            const poster = new File([video.thumbnailBlob], 'status-poster.jpg', { type: 'image/jpeg' });
            const uploadedPoster = await api.uploadStatusMedia(poster, {
              signal: controller.signal,
              onProgress: (percent) => setProgress(90 + Math.round(percent * 0.09)),
            });
            thumbnailUrl = uploadedPoster.file.url;
          } catch (posterError) {
            if ((posterError as { code?: string }).code === 'UPLOAD_ABORTED') throw posterError;
            thumbnailUrl = undefined;
          }
        }

        media = {
          mediaUrl: uploaded.file.url,
          mediaType: uploaded.file.mediaType || kind,
          mimetype: uploaded.file.mimetype || file.type,
          mediaSize: uploaded.file.size,
          mediaPublicId: uploaded.file.publicId ?? undefined,
          mediaProvider: uploaded.file.provider,
          thumbnailUrl,
          durationSeconds:
            kind === 'video' ? video?.duration : kind === 'audio' ? audio?.duration : undefined,
        };
      }

      setPhase('posting');
      await api.createStatus({ text: caption.trim() || undefined, ...media });

      void queryClient.invalidateQueries({ queryKey: ['statuses'] });
      onClose();
    } catch (uploadError) {
      const code = (uploadError as { code?: string }).code;
      if (code === 'UPLOAD_ABORTED') {
        setPhase('idle');
        setProgress(0);
        return;
      }
      setPhase('idle');
      setError(uploadError instanceof Error ? uploadError.message : 'Could not post your status.');
    } finally {
      abortRef.current = null;
    }
  }

  const canPost = Boolean((file && kind) || caption.trim()) && !busy && !probing;
  const typeLabel = kind === 'video' ? 'Video' : kind === 'audio' ? 'Voice note' : kind === 'image' ? 'Photo' : '';

  const dropHandlers = useMemo(
    () => ({
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault();
        if (!busy) setDragging(true);
      },
      onDragLeave: (event: React.DragEvent) => {
        event.preventDefault();
        setDragging(false);
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        setDragging(false);
        const dropped = event.dataTransfer.files?.[0];
        if (dropped) void handleFile(dropped);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy],
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 animate-fade-up" onClick={busy ? undefined : onClose}>
      <div
        className={`w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800 ${
          dragging ? 'ring-2 ring-brand-500' : ''
        }`}
        data-testid="status-composer"
        onClick={(event) => event.stopPropagation()}
        {...dropHandlers}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold">New status</h3>
          <button
            type="button"
            className="btn-ghost !px-2"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <p
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
          </p>
        ) : null}

        {!file ? (
          <button
            type="button"
            onClick={() => pick('any')}
            disabled={busy}
            className={`grid w-full place-items-center gap-1 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
              dragging
                ? 'border-brand-500 bg-brand-600/10'
                : 'border-ink-300 hover:border-brand-500 hover:bg-brand-600/5 dark:border-white/15'
            }`}
          >
            <Upload className="h-7 w-7 text-brand-600 dark:text-brand-300" />
            <span className="font-semibold">Drop a photo, video or voice note</span>
            <span className="text-[12px] text-ink-500 dark:text-ink-400">
              or tap to browse · image 10 MB · video 50 MB / 60 s · audio 20 MB
            </span>
          </button>
        ) : (
          <div className="rounded-2xl border border-ink-200 p-2 dark:border-white/10">
            <div className="grid max-h-[240px] place-items-center overflow-hidden rounded-xl bg-black">
              {kind === 'image' && previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Status preview"
                  className="max-h-[240px] w-auto max-w-full object-contain"
                />
              ) : null}
              {kind === 'video' && previewUrl ? (
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  className="max-h-[240px] w-auto max-w-full object-contain"
                />
              ) : null}
              {kind === 'audio' && previewUrl ? (
                <div className="w-full p-2">
                  <AudioPlayer
                    src={previewUrl}
                    peaks={audio?.peaks}
                    durationSeconds={audio?.duration}
                    dark
                  />
                </div>
              ) : null}
            </div>

            <div className="mt-2 flex items-center gap-2 px-1 text-[12px] text-ink-500 dark:text-ink-400">
              <span className="rounded bg-ink-100 px-1.5 py-0.5 font-semibold text-ink-700 dark:bg-white/10 dark:text-ink-200">
                {typeLabel}
              </span>
              <span className="truncate">{file.name}</span>
              <span>· {formatBytes(file.size)}</span>
              {kind === 'video' && video ? <span>· {formatDuration(video.duration)}</span> : null}
              {kind === 'audio' && audio ? <span>· {formatDuration(audio.duration)}</span> : null}
              {probing ? <span>· reading…</span> : null}
              <span className="flex-1" />
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="text-ink-500 hover:text-rose-500 dark:text-ink-400"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {busy ? (
              <div className="mt-3 px-1">
                <div className="mb-1 flex justify-between text-[11px] font-semibold text-ink-600 dark:text-ink-300">
                  <span>{phase === 'posting' ? 'Posting…' : progress > 90 ? 'Processing…' : `Uploading ${progress}%`}</span>
                  <span>{phase === 'uploading' ? `${progress}%` : ''}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink-200 dark:bg-white/15">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-[width] duration-200"
                    style={{ width: `${phase === 'posting' ? 100 : Math.max(2, progress)}%` }}
                    data-testid="status-upload-progress"
                  />
                </div>
                {phase === 'uploading' ? (
                  <button
                    type="button"
                    className="mt-2 text-[12px] font-semibold text-rose-600 hover:underline dark:text-rose-400"
                    onClick={() => abortRef.current?.abort()}
                  >
                    Cancel upload
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5 px-1">
                <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => pick('image')}>
                  <ImageIcon className="h-3.5 w-3.5" /> Photo
                </button>
                <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => pick('video')}>
                  <FileVideo className="h-3.5 w-3.5" /> Video
                </button>
                <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => pick('audio')}>
                  <Mic className="h-3.5 w-3.5" /> Voice
                </button>
              </div>
            )}
          </div>
        )}

        <label className="label mt-3" htmlFor="status-caption">
          {file ? 'Caption (optional)' : 'Text status'}
        </label>
        <textarea
          id="status-caption"
          rows={file ? 2 : 3}
          className="field resize-none"
          maxLength={700}
          placeholder={
            file ? 'Add a caption for any photo, video or voice note…' : "What's on your mind? Disappears after 24 hours."
          }
          value={caption}
          disabled={busy}
          onChange={(event) => setCaption(event.target.value)}
        />

        <input
          ref={inputRef}
          type="file"
          accept={acceptRef.current}
          className="hidden"
          data-testid="status-file-input"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = '';
            if (picked) void handleFile(picked);
          }}
        />

        <div className="mt-4 flex items-center gap-2">
          {!file ? (
            <>
              <button type="button" className="btn-ghost text-sm" onClick={() => pick('image')} disabled={busy}>
                <ImageIcon className="h-4 w-4" /> Photo
              </button>
              <button type="button" className="btn-ghost text-sm" onClick={() => pick('video')} disabled={busy}>
                <FileVideo className="h-4 w-4" /> Video
              </button>
              <button type="button" className="btn-ghost text-sm" onClick={() => pick('audio')} disabled={busy}>
                <Music className="h-4 w-4" /> Voice
              </button>
            </>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-ink-500 dark:text-ink-400">
              <Crop className="h-3.5 w-3.5" /> Shown uncropped, full size
            </span>
          )}
          <span className="flex-1" />
          {phase === 'idle' && error && file ? (
            <button type="button" className="btn-ghost" onClick={() => void post()}>
              Retry
            </button>
          ) : null}
          <button type="button" className="btn-primary" disabled={!canPost} onClick={() => void post()}>
            <Send className="h-4 w-4" />
            {phase === 'idle' ? 'Post status' : phase === 'uploading' ? 'Uploading…' : 'Posting…'}
          </button>
        </div>
      </div>
    </div>
  );
}
