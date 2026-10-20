import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_BYTES = 10 * 1024 * 1024; // matches the server's multer limit
const MIN_BYTES = 800; // ignore accidental taps

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
  recording: boolean;
  seconds: number;
  error: string | null;
  supported: boolean;
  start: () => Promise<void>;
  /** Stop and emit the file unless `cancel` is true. */
  stop: (cancel?: boolean) => void;
  clearError: () => void;
}

/**
 * MediaRecorder wrapper for voice notes.
 *
 * Ensures the microphone stream is always stopped (no lingering mic indicator)
 * and rejects recordings that are too short or too large before uploading.
 */
export function useVoiceRecorder(onRecorded: (file: File) => void): VoiceRecorder {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cancelRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  const supported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
    setSeconds(0);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError('Recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      cancelRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const cancelled = cancelRef.current;
        cleanup();
        if (cancelled) return;

        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < MIN_BYTES) {
          setError('That recording was too short.');
          return;
        }
        if (blob.size > MAX_BYTES) {
          setError('Recording is larger than 10 MB.');
          return;
        }
        const ext = type.includes('mp4') ? 'm4a' : 'webm';
        onRecorded(new File([blob], `voice-note-${Date.now()}.${ext}`, { type }));
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError('Microphone permission was denied.');
      cleanup();
    }
  }, [supported, onRecorded, cleanup]);

  const stop = useCallback((cancel = false) => {
    cancelRef.current = cancel;
    try {
      recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  // Never leave the mic open when the component unmounts.
  useEffect(
    () => () => {
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
    seconds,
    error,
    supported,
    start,
    stop,
    clearError: () => setError(null),
  };
}

export function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export const MAX_UPLOAD_BYTES = MAX_BYTES;
