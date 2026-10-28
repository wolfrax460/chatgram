import { useCallback, useEffect, useRef, useState } from 'react';
import { hasMediaCapture, isSecureMediaContext, reportMediaFailure } from './mediaPermissions';

const MAX_BYTES = 10 * 1024 * 1024; // matches the server's multer limit
/** Clips shorter than this are discarded silently (WhatsApp behaviour). */
export const MIN_VOICE_NOTE_MS = 1000;
const TIMER_TICK_MS = 200;

/** Pick the first recorder MIME type the browser actually supports. */
function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

export interface VoiceRecorder {
  /** A clip is in progress (recording or paused). Drives the recording bar. */
  recording: boolean;
  paused: boolean;
  /** Locked = hands-free: releasing the mic button no longer stops it. */
  locked: boolean;
  /** Whole seconds of recording, excluding paused time. */
  seconds: number;
  error: string | null;
  supported: boolean;
  start: () => Promise<void>;
  /** Stop and emit the file unless `cancel` is true. */
  stop: (cancel?: boolean) => void;
  /** Discard the clip (slide-to-cancel / the X button). */
  cancel: () => void;
  togglePause: () => void;
  setLocked: (locked: boolean) => void;
  clearError: () => void;
}

/**
 * MediaRecorder wrapper for voice notes.
 *
 * Supports the full WhatsApp recorder lifecycle: hands-free start, pause/resume,
 * lock, cancel, a live timer and silent discard of too-short clips. The
 * microphone stream is always stopped (no lingering mic indicator), and a clip
 * that outgrows the upload limit is stopped early instead of being uploaded and
 * rejected.
 */
export function useVoiceRecorder(onRecorded: (file: File) => void): VoiceRecorder {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [locked, setLockedState] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelRef = useRef(false);
  const pausedRef = useRef(false);
  const startAtRef = useRef(0); // performance.now() when the current segment began
  const elapsedBeforePauseRef = useRef(0);
  const sessionRef = useRef(0); // invalidates an in-flight getUserMedia()
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const supported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const elapsedMs = useCallback(() => {
    const running = pausedRef.current ? 0 : performance.now() - startAtRef.current;
    return elapsedBeforePauseRef.current + running;
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopTimer();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    bytesRef.current = 0;
    cancelRef.current = false;
    pausedRef.current = false;
    elapsedBeforePauseRef.current = 0;
    startAtRef.current = 0;
    setRecording(false);
    setPaused(false);
    setLockedState(false);
    setSeconds(0);
  }, [stopTimer]);

  const start = useCallback(async () => {
    setError(null);
    if (recorderRef.current) return;
    if (!supported) {
      setError('Recording is not supported in this browser.');
      return;
    }
    // Same preflight as calls: a hard "denied" never opens a prompt again, so
    // explain it with the platform instructions instead of a generic message.
    if (!isSecureMediaContext() || !hasMediaCapture()) {
      reportMediaFailure(new DOMException('Capture is unavailable on this page.', 'SecurityError'), 'microphone');
      return;
    }

    const session = sessionRef.current + 1;
    sessionRef.current = session;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session !== sessionRef.current) {
        // The gesture was cancelled (or the component unmounted) while the
        // microphone was starting.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      bytesRef.current = 0;
      cancelRef.current = false;
      pausedRef.current = false;
      elapsedBeforePauseRef.current = 0;

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        chunksRef.current.push(event.data);
        bytesRef.current += event.data.size;
        // Never let a forgotten recording grow past the upload limit.
        if (bytesRef.current > MAX_BYTES && recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch {
            /* already stopping */
          }
        }
      };

      recorder.onstop = () => {
        const type = recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm';
        const cancelled = cancelRef.current;
        const recordedMs = elapsedMs();
        const chunks = chunksRef.current.slice();
        const totalBytes = bytesRef.current;
        cleanup();
        if (cancelled) return;
        // Accidental tap / cancelled gesture: discard silently, no error toast.
        if (recordedMs < MIN_VOICE_NOTE_MS) return;
        const blob = new Blob(chunks, { type });
        if (blob.size === 0) return;
        if (totalBytes > MAX_BYTES || blob.size > MAX_BYTES) {
          setError('Recording is larger than 10 MB.');
          return;
        }
        const ext = type.includes('mp4') ? 'm4a' : 'webm';
        onRecordedRef.current(new File([blob], `voice-note-${Date.now()}.${ext}`, { type }));
      };

      recorder.onerror = () => {
        cancelRef.current = true;
        setError('The recording stopped unexpectedly. Please try again.');
      };

      recorder.start(1000); // flush a chunk per second so the size guard works
      recorderRef.current = recorder;
      startAtRef.current = performance.now();
      setRecording(true);
      setPaused(false);
      setLockedState(false);
      setSeconds(0);
      stopTimer();
      timerRef.current = window.setInterval(() => {
        setSeconds(Math.floor(elapsedMs() / 1000));
      }, TIMER_TICK_MS);
    } catch (failure) {
      cleanup();
      reportMediaFailure(failure, 'microphone', () => void start());
    }
  }, [supported, cleanup, elapsedMs, stopTimer]);

  const stop = useCallback((cancel = false) => {
    cancelRef.current = cancel;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      // No recorder yet: invalidate a getUserMedia() that is still pending.
      sessionRef.current += 1;
      return;
    }
    try {
      recorder.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const cancel = useCallback(() => stop(true), [stop]);

  const togglePause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      // Freeze the clock only once the recorder really accepted the pause: some
      // older WebViews do not implement pause() and would otherwise show a
      // frozen timer while still recording.
      const before = elapsedMs();
      try {
        recorder.pause();
      } catch {
        return;
      }
      elapsedBeforePauseRef.current = before;
      pausedRef.current = true;
      setPaused(true);
    } else if (recorder.state === 'paused') {
      try {
        recorder.resume();
      } catch {
        return;
      }
      startAtRef.current = performance.now();
      pausedRef.current = false;
      setPaused(false);
    }
  }, [elapsedMs]);

  const setLocked = useCallback((value: boolean) => {
    setLockedState(value);
  }, []);

  // Never leave the mic open when the component unmounts.
  useEffect(
    () => () => {
      sessionRef.current += 1;
      cancelRef.current = true;
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      cleanup();
    },
    [cleanup],
  );

  return {
    recording,
    paused,
    locked,
    seconds,
    error,
    supported,
    start,
    stop,
    cancel,
    togglePause,
    setLocked,
    clearError: () => setError(null),
  };
}

export function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export const MAX_UPLOAD_BYTES = MAX_BYTES;
