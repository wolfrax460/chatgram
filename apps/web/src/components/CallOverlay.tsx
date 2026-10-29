import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Camera, CameraOff, ChevronDown, Grid2x2, Maximize2, MessageSquare, Mic, MicOff, Minimize2,
  MoreHorizontal, PhoneOff, PictureInPicture2, Pin, PinOff, ScreenShare, Settings2, Signal, SignalLow,
  SignalMedium, SwitchCamera, UserPlus, Users, Video, VideoOff, Volume2, VolumeX, X,
} from 'lucide-react';
import {
  MAX_AUDIO_PARTICIPANTS,
  MAX_VIDEO_PARTICIPANTS,
  acceptCall,
  dismissCall,
  flipCamera,
  getLocalStream,
  getPeerStream,
  hangUp,
  inviteParticipant,
  isAndroidNative,
  isScreenSharingSupported,
  outcomeLabel,
  outcomeText,
  releaseRemoteControl,
  requestRemoteControl,
  retryCall,
  retryCallMedia,
  rejectCall,
  requestVideoUpgrade,
  respondRemoteControlRequest,
  respondVideoUpgrade,
  revokeRemoteControl,
  sendRemoteControlInput,
  setMinimised,
  setRemoteControlAllowed,
  setSpeaker,
  supportsSpeakerSelection,
  switchDevice,
  switchToAudioOnly,
  toggleCamera,
  toggleIncomingVideo,
  toggleMute,
  toggleScreenShare,
  type CallDiagnostics,
  type CallParticipant,
  type CallState,
  type ControlInputMessage,
} from '../lib/calls';
import { isDesktopShell } from '../lib/nativeNotifications';
import { api } from '../lib/api';

/** Compact byte count for the in-call diagnostics line. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact bitrate for the screen-share quality row. */
function formatKbps(kbps: number | null): string {
  if (kbps === null) return 'measuring…';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

/**
 * One line of real WebRTC numbers, shown when media stops arriving. This is what
 * makes "no audio and no video" diagnosable: the ICE state and candidate-pair
 * types separate "never connected" from "connected but nothing was attached",
 * and the byte counters show whether anything was ever received.
 */
function diagnosticsLine(diagnostics: CallDiagnostics | null): string {
  if (!diagnostics) return 'Collecting connection diagnostics…';
  const pair = diagnostics.candidatePair ?? 'no candidate pair';
  const relay = diagnostics.relayConfigured ? 'relay configured' : 'no relay configured';
  return [
    `${diagnostics.iceConnectionState.toUpperCase()} · ${pair} · ${relay}`,
    `in ${formatBytes(diagnostics.audioIn)} audio / ${formatBytes(diagnostics.videoIn)} video`,
    `out ${formatBytes(diagnostics.audioOut)} audio / ${formatBytes(diagnostics.videoOut)} video`,
    `${diagnostics.remoteTracks} remote tracks (${diagnostics.remoteMuted} muted)`,
    `${diagnostics.receiverCount} receivers`,
    `remote ${diagnostics.remoteDirections ?? 'unknown'}`,
    diagnostics.missingMediaPeers > 0 ? `${diagnostics.missingMediaPeers} peer(s) not sending` : null,
    // The screen share has its own numbers: never mix them with the camera path.
    diagnostics.screenActive
      ? `screen: ${diagnostics.screenBitrateKbps ?? '?'} kbps · ${diagnostics.screenRttMs ?? '?'} ms · ${diagnostics.screenLossPct ?? '?'}%`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** Bottom-sheet / floating-tile geometry. */
const SELF_VIEW_STORAGE_KEY = 'chatgram.call.selfView';
const SELF_VIEW_MARGIN = 12;

/** Earpiece/loudspeaker routing exposed by the Android shell (APK 1.1.6+). */
type AudioRouteName = 'earpiece' | 'speaker' | 'bluetooth' | 'headset';

interface AudioRoutePlugin {
  getRoute: () => Promise<{ route: AudioRouteName; bluetoothAvailable?: boolean }>;
  setRoute: (options: { route: AudioRouteName }) => Promise<{ route: AudioRouteName }>;
}

/**
 * The native AudioRoute Capacitor plugin, or null in browsers and in older APKs
 * whose WebView has no setSinkId and therefore no speaker control of its own.
 */
function audioRoutePlugin(): AudioRoutePlugin | null {
  const bridge = (window as unknown as {
    Capacitor?: { Plugins?: { AudioRoute?: Partial<AudioRoutePlugin> } };
  }).Capacitor;
  const plugin = bridge?.Plugins?.AudioRoute;
  if (!plugin || typeof plugin.getRoute !== 'function' || typeof plugin.setRoute !== 'function') return null;
  return { getRoute: plugin.getRoute, setRoute: plugin.setRoute };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function initials(name?: string): string {
  const clean = (name || '?').trim();
  const parts = clean.split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/**
 * Avatar with initials always rendered underneath the image, so a messy/blocked
 * avatar URL (common in the Android WebView) can never hide who is on the call.
 */
function Avatar({
  name,
  url,
  className,
  textClassName,
  testId,
}: {
  name?: string;
  url?: string | null;
  className: string;
  textClassName?: string;
  testId?: string;
}) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-600 font-bold ${className}`}
      data-testid={testId}
    >
      <span className={textClassName}>{initials(name)}</span>
      {url ? (
        <img
          src={url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
    </span>
  );
}

function clockFor(startedAt: number | null): string {
  const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * The ONE mapping behind the single status line on the call screen. Every state
 * renders through this function, so there is never a second competing banner.
 */
function statusLine(call: CallState): string {
  switch (call.status) {
    case 'calling': return 'Calling…';
    case 'incoming': return 'Incoming call';
    case 'connecting': return 'Connecting…';
    case 'active': return clockFor(call.startedAt);
    case 'reconnecting': return 'Reconnecting…';
    case 'ended':
    case 'error': return outcomeText(call);
    case 'idle': return '';
  }
}

function qualityIcon(quality: CallState['quality']) {
  if (quality === 'fair') return SignalMedium;
  if (quality === 'poor') return SignalLow;
  return Signal;
}

function qualityLabel(quality: CallState['quality']): string {
  if (quality === 'good') return 'Good connection';
  if (quality === 'fair') return 'Fair connection';
  if (quality === 'poor') return 'Poor connection';
  return 'Connection';
}

/**
 * Adaptive gallery for group calls.
 * Mesh limit: one RTCPeerConnection per remote peer, so ~6 video (or 12 audio)
 * participants is the ceiling before an SFU would be needed — with 5+ remotes
 * the last row scrolls instead of shrinking into unreadable slivers.
 */
function galleryGridClass(remoteCount: number): string {
  if (remoteCount <= 1) return 'grid-cols-1';
  if (remoteCount <= 2) return 'grid-cols-2';
  if (remoteCount <= 4) return 'grid-cols-2 grid-rows-2';
  return 'grid-cols-2 auto-rows-[minmax(7.5rem,1fr)]';
}

/** Remembers where the floating self-view was dragged to (fractions of the overlay). */
interface SelfViewFraction {
  fx: number;
  fy: number;
}

interface SelfViewPoint {
  x: number;
  y: number;
}

interface SelfViewBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

interface SelfViewDragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

function readStoredSelfView(): SelfViewFraction | null {
  try {
    const raw = window.localStorage.getItem(SELF_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as { fx?: unknown; fy?: unknown };
    if (typeof record.fx !== 'number' || typeof record.fy !== 'number') return null;
    if (!Number.isFinite(record.fx) || !Number.isFinite(record.fy)) return null;
    return { fx: clampNumber(record.fx, 0, 1), fy: clampNumber(record.fy, 0, 1) };
  } catch {
    return null;
  }
}

function storeSelfView(fraction: SelfViewFraction): void {
  try {
    window.localStorage.setItem(SELF_VIEW_STORAGE_KEY, JSON.stringify(fraction));
  } catch {
    /* storage unavailable (private mode): the position just is not persisted */
  }
}

/** Ringback / incoming ring tone, generated locally (no audio asset needed). */
function useRingTone(kind: 'ringback' | 'incoming' | null) {
  useEffect(() => {
    if (!kind) return undefined;
    let stopped = false;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return undefined;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ctx.destination);
    const beep = () => {
      if (stopped) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = kind === 'ringback' ? 440 : 520;
      osc.connect(gain);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.6);
    };
    beep();
    const timer = window.setInterval(beep, 2400);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void ctx.close().catch(() => undefined);
    };
  }, [kind]);
}

/** Web Audio speaking detection for the remote tiles. */
function useSpeaking(peerIds: string[]): Record<string, boolean> {
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const idsKey = peerIds.join(',');
  useEffect(() => {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || peerIds.length === 0) return undefined;
    const ctx = new Ctx();
    const analysers = new Map<string, AnalyserNode>();
    const data = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const id of peerIds) {
      const stream = getPeerStream(id);
      const audioTracks = stream?.getAudioTracks() ?? [];
      if (!audioTracks.length) continue;
      const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analysers.set(id, analyser);
      data.set(id, new Uint8Array(new ArrayBuffer(analyser.fftSize)));
    }
    let raf = 0;
    const tick = () => {
      const next: Record<string, boolean> = {};
      for (const [id, analyser] of analysers) {
        const buffer = data.get(id);
        if (!buffer) continue;
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const value of buffer) {
          const v = (value - 128) / 128;
          sum += v * v;
        }
        next[id] = Math.sqrt(sum / buffer.length) > 0.045;
      }
      setSpeaking((previous) => {
        const changed = peerIds.some((id) => previous[id] !== next[id]);
        return changed ? next : previous;
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  return speaking;
}

/** One remote participant tile. */
/**
 * Remote audio for calls that mount no remote <video> at all (audio-only calls).
 * A tile renders its own audio sink while it has no video element, so this one is
 * used only by the audio-only stage — never both, or the remote voice plays twice.
 */
function RemoteAudioSink({ participantId }: { participantId: string }) {
  const element = useRef<HTMLAudioElement | null>(null);
  const stream = getPeerStream(participantId);

  useEffect(() => {
    const audio = element.current;
    if (!audio) return;
    if (stream && audio.srcObject !== stream) audio.srcObject = stream;
    // Android WebView allows this here (mediaPlaybackRequiresUserGesture is off);
    // a browser that blocks it until a gesture will retry on the next render.
    void audio.play().catch(() => undefined);
  });

  return <audio ref={element} autoPlay playsInline className="hidden" aria-hidden="true" />;
}

/**
 * Whether a remote tile should mount its `<video>`.
 *
 * A screen share is a real video track on the SAME video transceiver as the
 * camera. The sharer normally turns the camera off while sharing, so
 * `cameraOn === false` / `videoOff` / an `audioOnly` roster entry must NOT hide
 * it: the avatar is only correct when the peer genuinely has no video to show.
 * When sharing, mount the video as soon as the peer stream exists (the first
 * track can arrive a moment later; the waiting overlay covers that gap).
 *
 * Exported so the screen-share reproduction check exercises the real predicate.
 */
export function remoteVideoVisible(
  participant: Pick<CallParticipant, 'cameraOn' | 'videoOff' | 'audioOnly' | 'screenSharing'>,
  options: { videoEnabled: boolean; screenSharing: boolean; hasStream: boolean },
): boolean {
  const sharing = options.screenSharing || participant.screenSharing === true;
  if (sharing) return options.hasStream;
  return (
    options.videoEnabled &&
    participant.cameraOn !== false &&
    !participant.audioOnly &&
    participant.videoOff !== true
  );
}

function RemoteTile({
  participant,
  speaking,
  pinned,
  videoEnabled,
  screenSharing,
  onPin,
  onRegisterVideo,
}: {
  participant: CallParticipant;
  speaking: boolean;
  pinned: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  onPin: () => void;
  onRegisterVideo: (element: HTMLVideoElement | null) => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [videoWaiting, setVideoWaiting] = useState(true);
  const retryTimer = useRef<number | null>(null);
  const retryAttempts = useRef(0);
  const attemptPlayRef = useRef<() => void>(() => undefined);
  const stream = getPeerStream(participant.id);
  const sharing = screenSharing || participant.screenSharing === true;
  // Camera state is irrelevant while sharing: the screen is delivered on the
  // video transceiver and must be rendered even if cameraOn === false.
  const showVideo = remoteVideoVisible(participant, {
    videoEnabled,
    screenSharing,
    hasStream: stream !== null,
  });

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  // Short backoff for a still-paused video (at most 8 attempts, then wait for a
  // user gesture or the next stream update).
  const retrySoon = useCallback(() => {
    if (retryAttempts.current >= 8) return;
    retryAttempts.current += 1;
    clearRetry();
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      attemptPlayRef.current();
    }, 250);
  }, [clearRetry]);

  // A paused remote <video> shows Chrome/WebView's own big grey play triangle, so
  // autoplay failures have to be retried (AbortError when srcObject is reassigned
  // is common on Android). When sound is blocked we play muted and offer one tap
  // to unmute; `unmute` is used by that button.
  const attemptPlay = useCallback(async (unmute = false): Promise<void> => {
    const element = video.current;
    if (!element || !element.srcObject) return;
    if (unmute) element.muted = false;
    try {
      await element.play();
      retryAttempts.current = 0;
      clearRetry();
      setVideoWaiting(false);
      if (!element.muted) setNeedsAudioUnlock(false);
    } catch {
      element.muted = true;
      setNeedsAudioUnlock(true);
      try {
        await element.play();
        retryAttempts.current = 0;
        clearRetry();
        setVideoWaiting(false);
      } catch {
        retrySoon();
      }
    }
  }, [clearRetry, retrySoon]);

  useEffect(() => {
    attemptPlayRef.current = () => { void attemptPlay(); };
  }, [attemptPlay]);

  useEffect(() => () => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  // Re-attach on every render: streamTick/getPeerStream updates and camera
  // switches hand us a changed stream, and the same stream keeps being retried.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (stream && element.srcObject !== stream) {
      element.srcObject = stream;
      // A fresh stream gets a fresh chance at sound; the fallback re-mutes if the
      // browser still refuses.
      element.muted = false;
      setNeedsAudioUnlock(false);
      retryAttempts.current = 0;
    }
    void attemptPlay();
  });

  // An audio-only call (or a peer with the camera off) mounts no <video> at all,
  // so without this the remote microphone had no sink and the call was silent.
  // It is exactly one sink: the <video> carries the sound whenever it is mounted.
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    if (stream && element.srcObject !== stream) element.srcObject = stream;
    void element.play().catch(() => undefined);
  });

  return (
    <div
      className={`relative flex h-full min-h-0 w-full min-w-0 items-center justify-center overflow-hidden rounded-2xl bg-ink-800 ${
        speaking ? 'ring-2 ring-emerald-400' : ''
      } ${pinned ? 'ring-2 ring-brand-400' : ''}`}
      data-testid={`call-tile-${participant.id}`}
    >
      {showVideo ? (
        <>
          <video
            ref={(element) => {
              video.current = element;
              onRegisterVideo(element);
            }}
            autoPlay
            playsInline
            onLoadedMetadata={() => void attemptPlay()}
            onCanPlay={() => void attemptPlay()}
            onPlaying={() => { setVideoWaiting(false); retryAttempts.current = 0; clearRetry(); }}
            onPause={() => { setVideoWaiting(true); retrySoon(); }}
            onWaiting={() => setVideoWaiting(true)}
            onStalled={() => setVideoWaiting(true)}
            onEnded={() => setVideoWaiting(true)}
            className="absolute inset-0 h-full w-full object-cover"
            aria-label={`${participant.displayName ?? 'Participant'} video`}
          />
          {videoWaiting ? (
            // Never let a paused <video> show Chrome/WebView's grey play triangle:
            // cover it with the participant's avatar until frames are playing.
            <div
              data-testid="remote-video-waiting"
              className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 bg-ink-800 p-4 pb-16 text-center"
            >
              <Avatar name={participant.displayName} url={participant.avatarUrl} className="h-20 w-20 text-2xl shadow-lg" />
              <span className="text-[12px] font-medium text-white/80">{participant.displayName ?? 'Connecting video…'}</span>
            </div>
          ) : null}
          {needsAudioUnlock ? (
            <button
              type="button"
              onClick={() => void attemptPlay(true)}
              data-testid="remote-audio-unlock"
              className="absolute inset-x-0 top-1/2 z-10 mx-auto flex w-max -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/75 px-3 py-2 text-[11.5px] font-semibold text-white shadow-lg ring-1 ring-white/20"
            >
              <Volume2 className="h-4 w-4" aria-hidden="true" /> Tap to enable sound
            </button>
          ) : null}
        </>
      ) : (
        <div className="relative flex flex-col items-center justify-center gap-2 p-4 text-center">
          {/* The only remote audio sink while no video element is mounted. */}
          <audio ref={audio} autoPlay playsInline className="hidden" aria-hidden="true" />
          <Avatar name={participant.displayName} url={participant.avatarUrl} className="h-20 w-20 text-2xl" />
          <span className="text-sm font-semibold">{participant.displayName ?? 'Chatgram user'}</span>
          {sharing ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-200/90" data-testid="remote-screen-waiting">
              <ScreenShare className="h-3.5 w-3.5" /> Screen share connecting…
            </span>
          ) : participant.incomingVideoOff ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-white/70" data-testid="remote-video-off-for-you">
              <VolumeX className="h-3.5 w-3.5" /> Incoming video off for you
            </span>
          ) : participant.cameraOn === false || participant.videoOff ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-white/70" data-testid="remote-camera-off">
              <CameraOff className="h-3.5 w-3.5" /> Camera off
            </span>
          ) : null}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-2">
        <span className="truncate text-xs font-medium">{participant.displayName ?? 'Chatgram user'}</span>
        {participant.muted ? <MicOff className="h-3.5 w-3.5 shrink-0 text-rose-300" aria-label="Muted" /> : null}
        {sharing ? <ScreenShare className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-label="Sharing screen" /> : null}
        <span className="flex-1" />
        <button
          type="button"
          className="rounded-md p-1 text-white/80 hover:bg-white/15"
          aria-label={pinned ? 'Unpin participant' : 'Pin participant'}
          title={pinned ? 'Unpin' : 'Pin'}
          onClick={onPin}
        >
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
      </div>
      {sharing ? (
        <span className="absolute left-2 top-2 rounded-md bg-emerald-600/90 px-2 py-0.5 text-[10px] font-semibold">
          {participant.displayName ?? 'They'} is sharing their screen
          {participant.hasSystemAudio ? ' · with audio' : ''}
        </span>
      ) : null}
    </div>
  );
}

/** One labelled primary control in the bottom bar: icon on top, small label below. */
function CallControl({
  children,
  label,
  testId,
  onClick,
  active = false,
  disabled = false,
  danger = false,
  ghost = false,
  title,
}: {
  children: ReactNode;
  label: string;
  testId: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  ghost?: boolean;
  title?: string;
}) {
  const circle = danger
    ? 'h-12 w-12 bg-rose-600 text-white group-hover:bg-rose-700'
    : ghost
      ? 'h-11 w-11 bg-transparent text-white group-hover:bg-white/10'
      : active
        ? 'h-11 w-11 bg-brand-600 text-white group-hover:bg-brand-700'
        : 'h-11 w-11 bg-white/10 text-white group-hover:bg-white/20';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      data-testid={testId}
      className="group flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-[10.5px] font-medium leading-tight text-white/90 transition disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={`grid shrink-0 place-items-center rounded-full transition ${circle}`}>{children}</span>
      <span className="max-w-[64px] truncate">{label}</span>
    </button>
  );
}

/** One action inside the "More" bottom sheet. */
function MoreAction({
  children,
  label,
  testId,
  onClick,
  active = false,
  disabled = false,
  title,
}: {
  children: ReactNode;
  label: string;
  testId: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title ?? label}
      data-testid={testId}
      className={`flex min-h-[76px] min-w-[44px] flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-2 text-center text-[11px] font-medium leading-tight transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-brand-600/25 text-brand-100' : 'text-white/85 hover:bg-white/10'
      }`}
    >
      <span className={`grid h-11 w-11 place-items-center rounded-full ${active ? 'bg-brand-600 text-white' : 'bg-white/10'}`}>
        {children}
      </span>
      <span className="w-full truncate">{label}</span>
    </button>
  );
}

export function CallOverlay({ call }: { call: CallState }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const localSelfVideo = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfViewRef = useRef<HTMLDivElement>(null);
  const selfFractionRef = useRef<SelfViewFraction | null>(null);
  const selfFractionLoadedRef = useRef(false);
  const selfViewDragRef = useRef<SelfViewDragState | null>(null);
  const [, forceTick] = useState(0);
  const [menu, setMenu] = useState<null | 'connection' | 'devices'>(null);
  const [layout, setLayout] = useState<'speaker' | 'gallery'>('speaker');
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [messages, setMessages] = useState<{ id: string; senderId: string; content: string; sentAt: string }[]>([]);
  const [selfView, setSelfView] = useState<SelfViewPoint | null>(null);
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');
  const [contacts, setContacts] = useState<{ id: string; displayName: string; avatarUrl: string | null }[]>([]);
  const [nativeRoute, setNativeRoute] = useState<AudioRouteName | null>(null);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const routeAppliedRef = useRef(false);
  const routeTouchedRef = useRef(false);

  const inCall = call.status === 'calling' || call.status === 'connecting' || call.status === 'reconnecting' || call.status === 'active';
  const showVideo = call.video && !call.audioOnly;
  const remoteCount = call.participants.length;
  const cap = call.video ? MAX_VIDEO_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS;
  const showSelfView = showVideo && remoteCount > 0;
  const qualityVisible = call.status === 'active' && call.quality !== 'unknown';
  const screenShareSupported = isScreenSharingSupported();
  const participantIds = useMemo(() => call.participants.map((participant) => participant.id), [call.participants]);
  const speaking = useSpeaking(participantIds);
  const sharers = call.participants.filter((participant) => participant.screenSharing);
  useRingTone(call.status === 'calling' ? 'ringback' : call.status === 'incoming' ? 'incoming' : null);

  // Contact picker for "Add participant" (turns a 1:1 call into a group room).
  useEffect(() => {
    if (!addParticipantOpen) return undefined;
    let cancelled = false;
    api
      .callContacts()
      .then((result) => {
        if (!cancelled) setContacts(result.contacts ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [addParticipantOpen]);

  useEffect(() => {
    if (call.status !== 'active' && call.status !== 'reconnecting') return undefined;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [call.status]);

  // Local preview stays muted (it is your own microphone); remote video is not.
  useEffect(() => {
    const stream = getLocalStream();
    if (!stream) return;
    for (const element of [localVideo.current, localSelfVideo.current]) {
      if (!element) continue;
      if (element.srcObject !== stream) element.srcObject = stream;
      void element.play().catch(() => undefined);
    }
  });

  // Android shell: native audio routing through the AudioRoute plugin. The route
  // is read as soon as the call is live, and the default is applied once the call
  // becomes active (video → speaker, audio → earpiece) but never over a
  // wired/Bluetooth headset the user is already on.
  useEffect(() => {
    if (call.status !== 'active' && call.status !== 'connecting' && call.status !== 'reconnecting') return undefined;
    const plugin = audioRoutePlugin();
    if (!plugin) return undefined;
    let cancelled = false;
    const applyRoute = async (): Promise<void> => {
      try {
        const current = await plugin.getRoute();
        if (cancelled) return;
        setNativeRoute(current.route);
        if (call.status !== 'active') return;
        if (routeAppliedRef.current || routeTouchedRef.current) return;
        routeAppliedRef.current = true;
        if (current.route === 'bluetooth' || current.route === 'headset') return;
        const desired: AudioRouteName = call.video ? 'speaker' : 'earpiece';
        if (current.route === desired) return;
        const applied = await plugin.setRoute({ route: desired });
        if (!cancelled) setNativeRoute(applied.route);
      } catch {
        /* native bridge unavailable: the browser path (setSinkId) stays in use */
      }
    };
    void applyRoute();
    return () => {
      cancelled = true;
    };
  }, [call.status, call.video]);

  // A fresh call starts from the platform default route again.
  useEffect(() => {
    if (call.status !== 'idle' && call.status !== 'ended') return;
    routeAppliedRef.current = false;
    routeTouchedRef.current = false;
    setNativeRoute(null);
  }, [call.status]);

  useEffect(() => {
    if (!routeNotice) return undefined;
    const timer = window.setTimeout(() => setRouteNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [routeNotice]);

  // Keyboard shortcuts (ignored while typing in an input).
  useEffect(() => {
    if (call.status === 'idle' || call.status === 'ended') return undefined;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'm') { event.preventDefault(); void toggleMute(); }
      if (key === 'v' && call.video) { event.preventDefault(); void toggleCamera(); }
      if (key === 's' && isScreenSharingSupported()) { event.preventDefault(); void toggleScreenShare(); }
      if (key === 'escape') {
        // While controlling a remote screen, Escape releases control (handled by
        // the control key listener) instead of minimising the call.
        if (call.controlStatus === 'active') return;
        event.preventDefault();
        if (addParticipantOpen) { setAddParticipantOpen(false); return; }
        if (moreOpen) { setMoreOpen(false); return; }
        if (messagesOpen) { setMessagesOpen(false); return; }
        if (participantsOpen) { setParticipantsOpen(false); return; }
        if (menu) { setMenu(null); return; }
        setMinimised(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [call.status, call.video, moreOpen, messagesOpen, participantsOpen, addParticipantOpen, menu, call.controlStatus]);

  // Message side panel: load the chat's recent messages when opened.
  useEffect(() => {
    if (!messagesOpen || !call.chatId) return undefined;
    let cancelled = false;
    api.messages(call.chatId).then((rows) => {
      if (!cancelled) setMessages(rows.slice(-30).map((row) => ({ id: row.id, senderId: row.senderId, content: String(row.content ?? ''), sentAt: row.sentAt })));
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [messagesOpen, call.chatId]);

  // The floating self-view never leaves the overlay and never covers the top
  // name/status area or the bottom control bar (whose height includes the
  // safe-area inset). Bounds are re-derived on every relevant geometry change.
  const selfViewBounds = useCallback((): SelfViewBounds | null => {
    const container = containerRef.current;
    const tile = selfViewRef.current;
    if (!container || !tile) return null;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const tileWidth = tile.offsetWidth;
    const tileHeight = tile.offsetHeight;
    if (width <= 0 || height <= 0 || tileWidth <= 0 || tileHeight <= 0) return null;
    const headerHeight = headerRef.current?.offsetHeight ?? 0;
    const controlsHeight = controlsRef.current?.offsetHeight ?? 0;
    const minX = SELF_VIEW_MARGIN;
    const maxX = Math.max(minX, width - tileWidth - SELF_VIEW_MARGIN);
    const minY = headerHeight + SELF_VIEW_MARGIN;
    const maxY = Math.max(minY, height - controlsHeight - tileHeight - SELF_VIEW_MARGIN);
    return { minX, maxX, minY, maxY, width, height };
  }, []);

  const syncSelfView = useCallback((): void => {
    if (!selfFractionLoadedRef.current) {
      // Restore the remembered spot once, when the tile is first measurable.
      selfFractionRef.current = readStoredSelfView();
      selfFractionLoadedRef.current = true;
    }
    const bounds = selfViewBounds();
    if (!bounds) return;
    const fraction = selfFractionRef.current;
    // No stored spot yet: default bottom-right, above the controls.
    const rawX = fraction ? fraction.fx * bounds.width : bounds.maxX;
    const rawY = fraction ? fraction.fy * bounds.height : bounds.maxY;
    setSelfView({
      x: Math.round(clampNumber(rawX, bounds.minX, bounds.maxX)),
      y: Math.round(clampNumber(rawY, bounds.minY, bounds.maxY)),
    });
  }, [selfViewBounds]);

  useLayoutEffect(() => {
    if (!showSelfView) return;
    syncSelfView();
  }, [syncSelfView, showSelfView, layout, remoteCount, call.status]);

  useEffect(() => {
    if (!showSelfView) return undefined;
    const onResize = () => syncSelfView();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [syncSelfView, showSelfView]);

  const onSelfViewPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const element = selfViewRef.current;
    if (!element || !selfView) return;
    selfViewDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: selfView.x,
      originY: selfView.y,
      moved: false,
    };
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic pointer events (tests) have no capturable pointer */
    }
    event.preventDefault();
  }, [selfView]);

  const onSelfViewPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = selfViewDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < 6) return;
    dragState.moved = true;
    const bounds = selfViewBounds();
    if (!bounds) return;
    setSelfView({
      x: Math.round(clampNumber(dragState.originX + dx, bounds.minX, bounds.maxX)),
      y: Math.round(clampNumber(dragState.originY + dy, bounds.minY, bounds.maxY)),
    });
  }, [selfViewBounds]);

  const finishSelfViewDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = selfViewDragRef.current;
    selfViewDragRef.current = null;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const element = selfViewRef.current;
    if (element?.hasPointerCapture(event.pointerId)) {
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer already released */
      }
    }
    if (!dragState.moved) {
      // A tap (not a drag) keeps the old shortcut: swap self view and main tile.
      setSwapped((value) => !value);
      return;
    }
    const container = containerRef.current;
    if (!container || !element) return;
    const containerRect = container.getBoundingClientRect();
    const tileRect = element.getBoundingClientRect();
    if (containerRect.width <= 0 || containerRect.height <= 0) return;
    const fraction: SelfViewFraction = {
      fx: clampNumber((tileRect.left - containerRect.left) / containerRect.width, 0, 1),
      fy: clampNumber((tileRect.top - containerRect.top) / containerRect.height, 0, 1),
    };
    selfFractionRef.current = fraction;
    storeSelfView(fraction);
  }, []);

  const cancelSelfViewDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = selfViewDragRef.current;
    selfViewDragRef.current = null;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const element = selfViewRef.current;
    if (element?.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  }, []);

  const prominent = useMemo<CallParticipant | null>(() => {
    // A shared screen is the main content and wins over a pin: pinning someone
    // else must not hide the share the receiver was just told about.
    const sharer = call.participants.find((participant) => participant.screenSharing);
    if (sharer) return sharer;
    if (pinnedId) return call.participants.find((participant) => participant.id === pinnedId) ?? null;
    if (remoteCount === 1) return call.participants[0] ?? null;
    const loud = Object.entries(speaking).find(([, value]) => value);
    return call.participants.find((participant) => participant.id === loud?.[0]) ?? call.participants[0] ?? null;
  }, [pinnedId, call.participants, remoteCount, speaking]);

  const requestFullscreen = useCallback(async () => {
    const element = containerRef.current;
    if (!element) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    else await element.requestFullscreen().catch(() => undefined);
  }, []);

  const togglePip = useCallback(async () => {
    const element = remoteVideoRef.current;
    if (!element) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await element.requestPictureInPicture();
    } catch {
      /* browser refused (e.g. no video track yet) */
    }
  }, []);

  // "Speaker": native earpiece/loudspeaker routing on the Android shell (AudioRoute
  // plugin), output-device selection via setSinkId in real browsers.
  const nativeRoutePlugin = audioRoutePlugin();
  const androidNative = isAndroidNative();
  const speakerOutputs = call.devices.audioOutput.filter((device) => device.deviceId !== 'default');
  const speakerTarget = speakerOutputs.find((device) => /speaker|loud/i.test(device.label)) ?? speakerOutputs[0];
  const nativeSpeaker = nativeRoutePlugin !== null;
  const androidWithoutRoute = androidNative && !nativeSpeaker;
  const browserSpeaker = !nativeSpeaker && !androidWithoutRoute && supportsSpeakerSelection() && speakerOutputs.length > 0;
  const speakerActive = nativeSpeaker ? nativeRoute === 'speaker' : call.sinkId !== '' && call.sinkId !== 'default';
  const canUseSpeaker = nativeSpeaker || androidWithoutRoute || browserSpeaker;
  const toggleSpeaker = useCallback(() => {
    const plugin = audioRoutePlugin();
    if (plugin) {
      routeTouchedRef.current = true;
      const currentRoute: AudioRouteName = nativeRoute ?? (call.video ? 'speaker' : 'earpiece');
      const nextRoute: AudioRouteName = currentRoute === 'speaker' ? 'earpiece' : 'speaker';
      void plugin
        .setRoute({ route: nextRoute })
        .then((result) => setNativeRoute(result.route))
        .catch(() => setRouteNotice('Could not switch the speaker.'));
      return;
    }
    if (isAndroidNative()) {
      setRouteNotice('Speaker switching needs the latest app update');
      return;
    }
    if (!browserSpeaker) return;
    if (speakerActive) void setSpeaker('default');
    else if (speakerTarget) void setSpeaker(speakerTarget.deviceId);
  }, [browserSpeaker, call.video, nativeRoute, speakerActive, speakerTarget]);

  /* ------------------------------------------------ remote-control input */
  const lastControlMoveAt = useRef(0);
  const controlPoint = useCallback((element: HTMLElement, clientX: number, clientY: number): { x: number; y: number } => {
    const rect = element.getBoundingClientRect();
    const video = remoteVideoRef.current;
    // The shared video is rendered with object-cover, so map the pointer to the
    // actual video FRAME (0..1) rather than the letterboxed/cropped tile.
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
      const shownWidth = video.videoWidth * scale;
      const shownHeight = video.videoHeight * scale;
      const offsetX = (rect.width - shownWidth) / 2;
      const offsetY = (rect.height - shownHeight) / 2;
      return {
        x: clampNumber((clientX - rect.left - offsetX) / Math.max(1, shownWidth), 0, 1),
        y: clampNumber((clientY - rect.top - offsetY) / Math.max(1, shownHeight), 0, 1),
      };
    }
    return {
      x: clampNumber((clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clampNumber((clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    };
  }, []);
  const onControlPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const now = window.performance.now();
    if (now - lastControlMoveAt.current < 16) return; // throttled to ~60 events/s
    lastControlMoveAt.current = now;
    const point = controlPoint(event.currentTarget, event.clientX, event.clientY);
    const input: ControlInputMessage = { t: 'm', x: point.x, y: point.y };
    sendRemoteControlInput(input);
  }, [controlPoint]);
  const onControlPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic pointer */
    }
    const point = controlPoint(event.currentTarget, event.clientX, event.clientY);
    const button = event.button === 2 ? 2 : event.button === 1 ? 1 : 0;
    const input: ControlInputMessage = { t: 'c', x: point.x, y: point.y, button, down: true };
    sendRemoteControlInput(input);
  }, [controlPoint]);
  const onControlPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const point = controlPoint(event.currentTarget, event.clientX, event.clientY);
    const button = event.button === 2 ? 2 : event.button === 1 ? 1 : 0;
    const input: ControlInputMessage = { t: 'c', x: point.x, y: point.y, button, down: false };
    sendRemoteControlInput(input);
  }, [controlPoint]);
  const onControlWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const point = controlPoint(event.currentTarget, event.clientX, event.clientY);
    const input: ControlInputMessage = { t: 'w', x: point.x, y: point.y, dy: clampNumber(event.deltaY, -10, 10) };
    sendRemoteControlInput(input);
  }, [controlPoint]);
  // Keyboard control: strict allowlist, Escape always releases control.
  useEffect(() => {
    if (call.controlStatus !== 'active') return undefined;
    const special = new Set([
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Enter', 'Tab', 'Escape',
      'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Shift', 'Control', 'Alt', 'Meta',
    ]);
    const sendKey = (event: KeyboardEvent, down: boolean) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'Escape') {
        if (down) {
          event.preventDefault();
          releaseRemoteControl();
        }
        return;
      }
      const printable = event.key.length === 1;
      if (!printable && !special.has(event.key)) return;
      if (printable && (event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const input: ControlInputMessage = { t: 'k', key: event.key, down };
      sendRemoteControlInput(input);
    };
    const onDown = (event: KeyboardEvent) => sendKey(event, true);
    const onUp = (event: KeyboardEvent) => sendKey(event, false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [call.controlStatus]);

  if (call.status === 'idle') return null;

  if (call.status === 'incoming') {
    // participants[0] is the caller (calls.ts keeps `from` first). Both the name
    // and the avatar come straight from the call:incoming payload.
    const caller = call.participants[0];
    const others = call.participants.filter((participant) => participant.id !== caller?.id);
    const callerName = caller?.displayName?.trim() || call.title?.trim() || 'Chatgram user';
    const groupTitle = call.title?.trim() || 'Group call';
    return (
      <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 overflow-y-auto bg-gradient-to-b from-ink-900 to-black p-6 text-white" role="dialog" aria-label="Incoming call" data-testid="call-incoming">
        <div className="relative">
          <div className="absolute inset-0 scale-150 rounded-full bg-brand-500/20 blur-2xl" aria-hidden="true" />
          <Avatar name={callerName} url={caller?.avatarUrl ?? null} className="relative h-32 w-32 text-4xl shadow-2xl" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold" data-testid="call-status">{statusLine(call)}</h2>
          <p className="mt-1 text-sm text-white/70" data-testid="incoming-call-kind">
            {call.isGroup
              ? `Incoming group ${call.video ? 'video' : 'voice'} call`
              : call.video
                ? 'Incoming video call'
                : 'Incoming audio call'}
          </p>
          <p className="mx-auto mt-2 max-w-[85vw] truncate text-2xl font-bold" data-testid="incoming-caller-name">{callerName}</p>
          {call.isGroup ? (
            <p className="mt-1 text-[13px] text-white/70">
              {groupTitle} · {call.participants.length} {call.participants.length === 1 ? 'person' : 'people'} on the call
              {call.ringCount > 1 ? ` · ${call.ringCount} invited` : ''}
            </p>
          ) : null}
          {others.length > 0 ? (
            <div className="mt-3 flex items-center justify-center gap-1.5" aria-hidden="true">
              {others.slice(0, 4).map((participant) => (
                <Avatar key={participant.id} name={participant.displayName} url={participant.avatarUrl} className="h-9 w-9 text-[11px] ring-1 ring-white/20" />
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-10">
          <button type="button" className="flex flex-col items-center gap-2" aria-label="Decline call" onClick={rejectCall}>
            <span className="grid h-16 w-16 place-items-center rounded-full bg-rose-600 hover:bg-rose-700"><PhoneOff className="h-7 w-7" /></span>
            <span className="text-xs">Decline</span>
          </button>
          <button type="button" className="flex flex-col items-center gap-2" aria-label={call.isGroup ? 'Join call' : 'Accept call'} onClick={() => void acceptCall()}>
            <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-600 hover:bg-emerald-700"><Video className="h-7 w-7" /></span>
            <span className="text-xs">{call.isGroup ? 'Join' : 'Accept'}</span>
          </button>
        </div>
      </div>
    );
  }

  if (call.status === 'ended' || call.status === 'error') {
    const title = outcomeLabel(call.outcome);
    const status = statusLine(call);
    const detail = call.message && call.message !== status ? call.message : null;
    return (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-6 text-white" role="dialog" aria-label={title}>
        <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6 text-center shadow-2xl" data-testid="call-ended">
          <h2 className="text-lg font-bold" data-testid="call-status">
            <span data-testid="call-ended-message">{status}</span>
          </h2>
          {detail ? (
            <p className="mt-1 text-[13px] text-white/70" data-testid="call-ended-detail">
              {detail}
            </p>
          ) : null}
          <div className="mt-4 flex items-center justify-center gap-2">
            {call.canRetry && call.outcome !== 'ended' ? (
              <button type="button" className="btn-primary" onClick={retryCall} data-testid="call-retry">
                Retry
              </button>
            ) : null}
            <button type="button" className={call.canRetry && call.outcome !== 'ended' ? 'btn-ghost' : 'btn-primary'} onClick={dismissCall}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (call.minimised && inCall) {
    return (
      <div className="fixed bottom-4 left-1/2 z-[70] flex w-[min(92vw,440px)] -translate-x-1/2 items-center gap-2 rounded-2xl bg-ink-900 px-3 py-2.5 text-white shadow-2xl" role="status" aria-label="Call in progress">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold">{initials(call.title)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" data-testid="minimised-call-title">{call.title}</p>
          <p className="text-[11px] text-white/70" data-testid="minimised-call-status">{statusLine(call)}</p>
        </div>
        <button type="button" className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label={call.muted ? 'Unmute' : 'Mute'} onClick={() => void toggleMute()}>
          {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button type="button" className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Return to call" onClick={() => setMinimised(false)}>
          <Maximize2 className="h-4 w-4" />
        </button>
        <button type="button" className="rounded-full bg-rose-600 p-2 hover:bg-rose-700" aria-label="Hang up" onClick={hangUp}>
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const QualityIcon = qualityIcon(call.quality);
  const others = call.participants;
  // Stage precedence: a REMOTE share always owns the main stage (the receiver was
  // just told about it), then our own share, then the swap choice. `call.screenSharing`
  // is only MY share flag, so on its own it must never override a remote share —
  // doing that put my screen on the big stage while the remote share was demoted
  // to the floating thumbnail (the inverted layout bug).
  const remoteSharer = sharers[0] ?? null;
  const mainShowsLocal = remoteSharer === null && (swapped || call.screenSharing);
  const mainParticipant = mainShowsLocal ? null : prominent;
  // The floating tile always shows the side that is NOT on the main stage.
  const counterpart = mainShowsLocal ? prominent : null;
  const gridClass = galleryGridClass(remoteCount);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[70] flex flex-col bg-gradient-to-b from-ink-900 via-ink-900 to-black text-white"
      role="dialog"
      aria-label={call.isGroup ? 'Group call' : 'Call'}
      data-testid="call-overlay"
    >
      {/* header: ONE status line + ONE quality indicator (only when truly active) */}
      <div ref={headerRef} className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold tabular-nums" data-testid="call-status">
            {call.status === 'active' ? <span data-testid="call-timer">{statusLine(call)}</span> : statusLine(call)}
          </h2>
          <p className="truncate text-[12px] text-white/70" data-testid="call-title">
            {call.title}
            {call.isGroup ? ` · ${remoteCount + 1} / ${cap}` : ''}
          </p>
        </div>
        {qualityVisible ? (
          <div className="relative">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5 text-[11.5px] font-semibold hover:bg-white/20"
              aria-label="Connection details"
              data-testid="connection-indicator"
              onClick={() => setMenu(menu === 'connection' ? null : 'connection')}
            >
              <QualityIcon className="h-4 w-4" />
              {qualityLabel(call.quality)}
              <ChevronDown className="h-3 w-3" />
            </button>
            {menu === 'connection' ? (
              <div className="absolute right-0 top-full z-20 mt-2 w-60 rounded-xl border border-white/15 bg-ink-800 p-3 text-[12px] shadow-2xl">
                <p className="font-semibold">Connection</p>
                <p className="mt-1 text-white/70">Status: {qualityLabel(call.quality)}</p>
                <p className="text-white/70">Latency: {call.stats.latencyMs !== null ? `${call.stats.latencyMs} ms` : 'measuring…'}</p>
                <p className="text-white/70">Packet loss: {call.stats.packetLoss !== null ? `${call.stats.packetLoss}%` : 'measuring…'}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* stage */}
      {call.mediaStalled ? (
        <div
          className="mx-3 mb-1 rounded-xl border border-rose-400/40 bg-rose-600/20 px-3 py-2 text-[12.5px] text-rose-50"
          data-testid="call-media-warning"
          role="alert"
        >
          <p className="font-semibold">
            {(call.diagnostics?.missingMediaPeers ?? 0) > 0
              ? 'They are not sending audio or video to you'
              : 'No audio or video is arriving'}
          </p>
          {(call.diagnostics?.missingMediaPeers ?? 0) > 0 ? (
            <p className="mt-0.5 text-[11px] leading-snug text-rose-100/85">
              The connection is up and our own audio/video is being sent — the other side negotiated no send
              direction. Retrying re-negotiates the media path.
            </p>
          ) : null}
          <p className="mt-0.5 break-words text-[11px] leading-snug text-rose-100/85" data-testid="call-diagnostics">
            {diagnosticsLine(call.diagnostics)}
          </p>
          <button
            type="button"
            onClick={() => retryCallMedia()}
            data-testid="call-media-retry"
            className="mt-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-[11.5px] font-semibold hover:bg-white/25"
          >
            Retry connection
          </button>
        </div>
      ) : null}
      {!showVideo ? call.participants.map((participant) => (
        <RemoteAudioSink key={participant.id} participantId={participant.id} />
      )) : null}

      {/* Screen-share quality: its own numbers, shown only while sharing. */}
      {call.screenSharing || sharers.length > 0 ? (
        <div
          className={`mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-xl px-3 py-1.5 text-[11.5px] ${
            call.screenStats.low ? 'border border-amber-400/40 bg-amber-500/15 text-amber-100' : 'bg-black/30 text-white/85'
          }`}
          data-testid="screen-share-quality"
        >
          <ScreenShare className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
          <span className="font-semibold">Screen</span>
          <span>
            · {formatKbps(call.screenStats.bitrateKbps)} · {call.screenStats.rttMs !== null ? `${call.screenStats.rttMs} ms` : 'measuring…'} ·{' '}
            {call.screenStats.lossPct !== null ? `${call.screenStats.lossPct}%` : 'measuring…'}
          </span>
          {call.screenStats.low ? (
            <>
              <span className="text-amber-200">Low — text may look blurry</span>
              <button
                type="button"
                onClick={() => retryCallMedia()}
                data-testid="screen-share-quality-retry"
                className="ml-auto rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold hover:bg-white/25"
              >
                Retry
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Remote control: host sees consent + approval, viewer sees the request. */}
      {call.screenSharing ? (
        <div className="mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-xl bg-white/5 px-3 py-1.5 text-[11.5px] text-white/85" data-testid="remote-control-host">
          {call.controlSupported ? (
            <button
              type="button"
              data-testid="allow-remote-control"
              aria-pressed={call.controlAllowed}
              onClick={() => setRemoteControlAllowed(!call.controlAllowed)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                call.controlAllowed ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-white/15 hover:bg-white/25'
              }`}
            >
              {call.controlAllowed ? 'Remote control allowed' : 'Allow remote control'}
            </button>
          ) : (
            <span className="text-white/60" data-testid="remote-control-unsupported">
              {isDesktopShell() ? 'Remote control is not available in this build' : 'Remote control needs the Windows app'}
            </span>
          )}
          {call.controlPendingId ? (
            <>
              <span>
                {call.participants.find((participant) => participant.id === call.controlPendingId)?.displayName ?? 'The other person'} wants to
                control your screen
              </span>
              <button
                type="button"
                data-testid="accept-control"
                onClick={() => respondRemoteControlRequest(true)}
                className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => respondRemoteControlRequest(false)}
                className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/25"
              >
                Deny
              </button>
            </>
          ) : null}
          {call.controlViewerId ? (
            <>
              <span>
                {call.participants.find((participant) => participant.id === call.controlViewerId)?.displayName ?? 'The other person'} is
                controlling your screen
              </span>
              <button
                type="button"
                data-testid="stop-remote-control"
                onClick={() => revokeRemoteControl()}
                className="ml-auto rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700"
              >
                Stop control
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {!call.screenSharing && remoteSharer && (call.controlAvailable || call.controlStatus !== 'idle' || call.controlMessage) ? (
        <div className="mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-xl bg-white/5 px-3 py-1.5 text-[11.5px] text-white/85" data-testid="remote-control-viewer">
          {call.controlStatus === 'active' ? (
            <>
              <span className="font-semibold text-emerald-200">You are controlling {remoteSharer.displayName ?? 'their'} screen</span>
              <button
                type="button"
                data-testid="release-control"
                onClick={() => releaseRemoteControl()}
                className="ml-auto rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/25"
              >
                Release control
              </button>
            </>
          ) : call.controlStatus === 'requested' ? (
            <span>Waiting for approval to control {remoteSharer.displayName ?? 'their'} screen…</span>
          ) : call.controlAvailable ? (
            <button
              type="button"
              data-testid="request-control"
              onClick={() => requestRemoteControl()}
              className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
            >
              Control
            </button>
          ) : null}
          {call.controlMessage ? <span className="text-white/55">{call.controlMessage}</span> : null}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 px-3 pb-2">
        {call.videoRequest ? (
          <div className="absolute inset-x-4 top-4 z-30 rounded-2xl border border-brand-400/50 bg-ink-800/95 p-3 shadow-2xl" data-testid="video-request">
            <p className="text-sm font-semibold">{call.videoRequest.displayName || 'The other person'} wants to switch this call to video.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary !py-1.5 text-[12px]" onClick={() => void respondVideoUpgrade(true)}>Accept video</button>
              <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => void respondVideoUpgrade(false)}>Keep audio</button>
            </div>
          </div>
        ) : null}

        {call.screenSharing || sharers.length > 0 ? (
          <div className="absolute inset-x-4 top-4 z-20 flex flex-col gap-1">
            {sharers.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-600/85 px-3 py-2 text-[12.5px] font-semibold" data-testid="remote-sharing-bar">
                <ScreenShare className="h-4 w-4" />
                <span>
                  {sharers.map((participant) => participant.displayName || 'Someone').join(', ')} is sharing their screen
                  {sharers.some((participant) => participant.hasSystemAudio) ? ' with audio' : ''}
                </span>
              </div>
            ) : null}
            {call.screenSharing ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-600/90 px-3 py-2 text-[12.5px] font-semibold" data-testid="sharing-bar">
                <ScreenShare className="h-4 w-4" />
                <span>You are sharing your screen{call.screenAudio ? ' · with system audio' : ''}</span>
                <span className="flex-1" />
                <button type="button" className="rounded-full bg-black/20 px-3 py-1 text-[11.5px] hover:bg-black/30" onClick={() => void toggleScreenShare()}>Stop sharing</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {call.incomingVideoOff ? (
          <div className="absolute inset-x-4 bottom-2 z-20 rounded-xl bg-amber-500/20 px-3 py-1.5 text-center text-[12px] font-semibold text-amber-100" data-testid="incoming-video-note">
            Incoming video is off — you can still hear everyone.
          </div>
        ) : null}

        {showVideo ? (
          <div className="flex h-full min-h-0 flex-col gap-2">
            {(layout === 'speaker' && remoteCount > 0) || remoteSharer !== null || call.screenSharing ? (
              <div className="relative h-full min-h-0 flex-1">
                {mainShowsLocal ? (
                  <div className="relative flex h-full items-center justify-center overflow-hidden rounded-2xl bg-ink-800">
                    {call.cameraOn || call.screenSharing ? (
                      <video ref={localVideo} autoPlay playsInline muted className={`h-full w-full object-cover ${call.screenSharing ? '' : 'scale-x-[-1]'}`} aria-label="Your video" />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-center">
                        <CameraOff className="h-10 w-10 text-white/60" />
                        <span className="text-[12px] text-white/70">Camera off · others can still hear you</span>
                      </div>
                    )}
                    <span className="absolute bottom-2 left-2 rounded-md bg-black/50 px-2 py-0.5 text-xs font-medium">
                      {call.screenSharing ? 'Your screen · You' : 'You'}
                    </span>
                    {call.screenSharing ? (
                      <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-emerald-600/90 px-2 py-0.5 text-[10px] font-semibold" data-testid="local-screen-main">
                        <ScreenShare className="h-3 w-3" aria-hidden="true" /> Sharing
                      </span>
                    ) : null}
                  </div>
                ) : mainParticipant ? (
                  <RemoteTile
                    participant={mainParticipant}
                    speaking={Boolean(speaking[mainParticipant.id])}
                    pinned={pinnedId === mainParticipant.id}
                    videoEnabled={!call.incomingVideoOff}
                    screenSharing={Boolean(mainParticipant.screenSharing)}
                    onPin={() => setPinnedId(pinnedId === mainParticipant.id ? null : mainParticipant.id)}
                    onRegisterVideo={(element) => { remoteVideoRef.current = element; }}
                  />
                ) : null}
                {/* Viewer input surface: only while we actually control THIS share. */}
                {mainParticipant && call.controlStatus === 'active' && call.controlPeerId === mainParticipant.id ? (
                  <div
                    data-testid="screen-control-surface"
                    className="absolute inset-0 z-20 cursor-crosshair touch-none"
                    onPointerMove={onControlPointerMove}
                    onPointerDown={onControlPointerDown}
                    onPointerUp={onControlPointerUp}
                    onPointerCancel={onControlPointerUp}
                    onWheel={onControlWheel}
                    onContextMenu={(event) => event.preventDefault()}
                  />
                ) : null}
              </div>
            ) : (
              <div className={`grid min-h-0 flex-1 gap-2 ${remoteCount > 4 ? 'overflow-y-auto' : 'overflow-hidden'} ${gridClass}`}>
                {others.map((participant) => (
                  <RemoteTile
                    key={participant.id}
                    participant={participant}
                    speaking={Boolean(speaking[participant.id])}
                    pinned={pinnedId === participant.id}
                    videoEnabled={!call.incomingVideoOff}
                    screenSharing={Boolean(participant.screenSharing)}
                    onPin={() => setPinnedId(pinnedId === participant.id ? null : participant.id)}
                    onRegisterVideo={() => undefined}
                  />
                ))}
                {remoteCount === 0 ? (
                  // Nothing remote yet (still ringing / connecting): show the local preview.
                  <div className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-ink-800">
                    {call.cameraOn || call.screenSharing ? (
                      <video ref={localVideo} autoPlay playsInline muted className={`h-full w-full object-cover ${call.screenSharing ? '' : 'scale-x-[-1]'}`} aria-label="Your video" />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-center" data-testid="self-camera-off-tile">
                        <div className="grid h-16 w-16 place-items-center rounded-full bg-brand-600 text-xl font-bold">You</div>
                        <span className="text-[11px] text-white/70">Camera off · others can still hear you</span>
                      </div>
                    )}
                    <span className="absolute bottom-2 left-2 rounded-md bg-black/50 px-2 py-0.5 text-xs font-medium">You</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <div className="relative flex h-full min-h-0 flex-col items-center justify-center overflow-hidden rounded-2xl bg-ink-800">
            {prominent?.avatarUrl ? (
              <img src={prominent.avatarUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" aria-hidden="true" />
            ) : null}
            <div className="relative flex flex-col items-center gap-3 px-6 text-center">
              <Avatar
                testId="callee-avatar"
                name={prominent?.displayName ?? call.title}
                url={prominent?.avatarUrl ?? null}
                className="h-36 w-36 text-4xl shadow-2xl"
              />
              <p className="text-xl font-bold">{call.title}</p>
              {call.muted ? <p className="rounded-full bg-rose-600/20 px-3 py-1 text-[12px] font-semibold text-rose-200">You're muted</p> : null}
              {remoteCount > 1 ? <p className="text-[12px] text-white/60">{remoteCount + 1} people on the call</p> : null}
            </div>
          </div>
        )}
      </div>

      {/* floating, draggable self view — kept inside the overlay, clear of the
          header/status line and of the control bar (incl. safe-area inset) */}
      {showSelfView ? (
        <div
          ref={selfViewRef}
          data-testid="call-self-view"
          title="Drag to move · tap to swap with the main view"
          className="absolute z-20 aspect-[4/3] w-[clamp(96px,26%,180px)] touch-none select-none overflow-hidden rounded-xl border border-white/25 bg-ink-800 shadow-xl"
          style={{
            left: selfView ? `${selfView.x}px` : undefined,
            top: selfView ? `${selfView.y}px` : undefined,
            visibility: selfView ? 'visible' : 'hidden',
          }}
          onPointerDown={onSelfViewPointerDown}
          onPointerMove={onSelfViewPointerMove}
          onPointerUp={finishSelfViewDrag}
          onPointerCancel={cancelSelfViewDrag}
        >
          <div className="relative h-full w-full cursor-grab active:cursor-grabbing" data-testid="self-view">
            {counterpart ? (
              // Main stage shows our own video (swap or our screen share): the
              // floating tile is the remote person, so nothing ever disappears.
              <RemoteTile
                participant={counterpart}
                speaking={Boolean(speaking[counterpart.id])}
                pinned={pinnedId === counterpart.id}
                videoEnabled={!call.incomingVideoOff}
                screenSharing={Boolean(counterpart.screenSharing)}
                onPin={() => setPinnedId(pinnedId === counterpart.id ? null : counterpart.id)}
                onRegisterVideo={(element) => { remoteVideoRef.current = element; }}
              />
            ) : call.cameraOn || call.screenSharing ? (
              <video ref={localSelfVideo} autoPlay playsInline muted className={`h-full w-full object-cover ${call.screenSharing ? '' : 'scale-x-[-1]'}`} aria-label="Your video" />
            ) : (
              <div className="grid h-full w-full place-items-center bg-ink-800" data-testid="self-camera-off">
                <CameraOff className="h-6 w-6 text-white/60" aria-label="Your camera is off" />
              </div>
            )}
            {!counterpart && call.muted ? <MicOff className="absolute right-1 top-1 h-3.5 w-3.5 text-rose-300" aria-label="You are muted" /> : null}
            {!counterpart ? (
              <span className="pointer-events-none absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium" data-testid="self-view-label">
                {call.screenSharing ? 'Your screen' : 'You'}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {participantsOpen ? (
        <div className="absolute inset-x-3 bottom-24 z-30 max-h-[45%] overflow-y-auto rounded-2xl border border-white/15 bg-ink-800/95 p-3 shadow-2xl" data-testid="call-participants">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm font-semibold">On this call ({others.length + 1})</p>
            <button type="button" className="rounded p-1 hover:bg-white/10" aria-label="Close participants" onClick={() => setParticipantsOpen(false)}><X className="h-4 w-4" /></button>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            <li className="flex items-center gap-2 rounded-lg px-2 py-1.5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-[11px] font-bold">You</span>
              <span className="flex-1 truncate">You</span>
              {call.muted ? <MicOff className="h-4 w-4 text-rose-300" /> : <Mic className="h-4 w-4 text-emerald-300" />}
            </li>
            {others.map((participant) => (
              <li key={participant.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <Avatar name={participant.displayName} url={participant.avatarUrl} className="h-8 w-8 text-[11px]" />
                <span className="flex-1 truncate">{participant.displayName ?? 'Chatgram user'}</span>
                {participant.screenSharing ? <ScreenShare className="h-4 w-4 text-emerald-300" /> : null}
                {participant.muted ? <MicOff className="h-4 w-4 text-rose-300" /> : <Mic className="h-4 w-4 text-emerald-300" />}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {messagesOpen ? (
        <div className="absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-white/15 bg-ink-900/95 shadow-2xl" data-testid="call-messages">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
            <MessageSquare className="h-4 w-4" />
            <p className="flex-1 text-sm font-semibold">Messages</p>
            <button type="button" className="rounded p-1 hover:bg-white/10" aria-label="Close messages" onClick={() => setMessagesOpen(false)}><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-[12.5px]">
            {messages.length === 0 ? <p className="text-white/60">No messages yet.</p> : null}
            {messages.map((message) => (
              <div key={message.id} className="rounded-xl bg-white/5 px-2.5 py-1.5">
                <p className="text-[11px] text-white/50">{new Date(message.sentAt).toLocaleTimeString()}</p>
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {routeNotice ? (
        <div className="pointer-events-none absolute inset-x-4 bottom-24 z-40 flex justify-center">
          <p className="rounded-full bg-black/70 px-3 py-1.5 text-center text-[12px] text-white/90" role="status" data-testid="call-route-notice">{routeNotice}</p>
        </div>
      ) : call.notice ? (
        <div className="pointer-events-none absolute inset-x-4 bottom-24 z-40 flex justify-center">
          <p className="rounded-full bg-black/70 px-3 py-1.5 text-center text-[12px] text-white/90" role="status">{call.notice}</p>
        </div>
      ) : null}

      {showVideo && call.muted ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center">
          <p className="rounded-full bg-black/70 px-3 py-1 text-[12px] font-semibold text-rose-200" data-testid="youre-muted">You're muted</p>
        </div>
      ) : null}

      {/* controls: five labelled primaries + a ghost More that opens the sheet */}
      <div
        ref={controlsRef}
        className="relative z-10 shrink-0 px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-end justify-between gap-0.5 sm:justify-center sm:gap-3">
          <CallControl
            testId="call-control-mute"
            label={call.muted ? 'Unmute' : 'Mute'}
            active={call.muted}
            onClick={() => void toggleMute()}
            title={call.muted ? 'Unmute microphone (M)' : 'Mute microphone (M)'}
          >
            {call.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </CallControl>

          <CallControl
            testId="call-control-camera"
            label="Camera"
            active={call.video && !call.cameraOn}
            onClick={call.video ? () => void toggleCamera() : requestVideoUpgrade}
            title={call.video ? (call.cameraOn ? 'Turn camera off (V)' : 'Turn camera on (V)') : 'Switch this call to video'}
          >
            {call.video && call.cameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </CallControl>

          <CallControl
            testId="call-control-speaker"
            label="Speaker"
            active={speakerActive}
            disabled={!canUseSpeaker}
            onClick={toggleSpeaker}
            title={
              nativeSpeaker
                ? 'Switch between earpiece and speaker'
                : androidWithoutRoute
                  ? 'Speaker switching needs the latest app update'
                  : canUseSpeaker
                    ? (speakerActive ? 'Switch back to the default speaker' : 'Use the loudspeaker')
                    : 'Speaker switching is not available on this device'
            }
          >
            {speakerActive ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </CallControl>

          <CallControl
            testId="call-control-flip"
            label="Flip"
            disabled={!call.video || !call.cameraOn}
            onClick={() => void flipCamera()}
            title="Flip camera"
          >
            <SwitchCamera className="h-5 w-5" />
          </CallControl>

          <CallControl testId="call-control-more" label="More" ghost onClick={() => setMoreOpen(true)} title="More call actions">
            <MoreHorizontal className="h-5 w-5" />
          </CallControl>

          <CallControl testId="call-control-end" label="End call" danger onClick={hangUp} title="End call">
            <PhoneOff className="h-6 w-6" />
          </CallControl>
        </div>
      </div>

      {call.cameraOn === false && call.video && !call.screenSharing ? (
        <p className="relative z-10 -mt-1 pb-2 text-center text-[11.5px] text-white/65" data-testid="camera-off-note">
          Camera off — others can still hear your audio.
        </p>
      ) : null}

      {/* More sheet: everything that is not a primary control lives here. */}
      {moreOpen ? (
        <div
          className="fixed inset-0 z-[80] flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="More call actions"
          data-testid="call-more-sheet"
        >
          <button
            type="button"
            aria-label="Close more actions"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/60"
          />
          <div className="relative max-h-[80vh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-ink-800 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl">
            <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" aria-hidden="true" />
            <div className="mt-2 flex items-center px-4">
              <p className="flex-1 text-sm font-semibold">More</p>
              <button type="button" className="rounded-full p-1.5 hover:bg-white/10" aria-label="Close more actions" onClick={() => setMoreOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1 px-2 pt-1 sm:grid-cols-4">
              <MoreAction testId="call-more-participants" label="Participants" onClick={() => { setParticipantsOpen(true); setMoreOpen(false); }}>
                <Users className="h-5 w-5" />
              </MoreAction>

              <MoreAction
                testId="call-more-add"
                label="Add person"
                disabled={call.isGroup}
                title={call.isGroup ? 'Everyone in this group can join from the group chat' : 'Add someone to this call and turn it into a group call'}
                onClick={() => { setAddParticipantOpen(true); setMoreOpen(false); }}
              >
                <UserPlus className="h-5 w-5" />
              </MoreAction>

              <MoreAction testId="call-more-chat" label="Chat" onClick={() => { setMessagesOpen(true); setMoreOpen(false); }}>
                <MessageSquare className="h-5 w-5" />
              </MoreAction>

              <MoreAction
                testId="call-layout-toggle"
                label={layout === 'speaker' ? 'Gallery view' : 'Spotlight view'}
                onClick={() => setLayout(layout === 'speaker' ? 'gallery' : 'speaker')}
              >
                {layout === 'speaker' ? <Grid2x2 className="h-5 w-5" /> : <Users className="h-5 w-5" />}
              </MoreAction>

              <MoreAction testId="call-more-fullscreen" label="Full screen" onClick={() => void requestFullscreen()}>
                <Maximize2 className="h-5 w-5" />
              </MoreAction>

              <MoreAction testId="call-more-pip" label="Picture in picture" disabled={!showVideo} onClick={() => void togglePip()}>
                <PictureInPicture2 className="h-5 w-5" />
              </MoreAction>

              {/* Screen sharing only exists where getDisplayMedia does (Capacitor
                  Android WebView has none) — so the action is simply absent there. */}
              {screenShareSupported ? (
                <MoreAction
                  testId="call-more-screen-share"
                  label={call.screenSharing ? 'Stop sharing' : 'Share screen'}
                  active={call.screenSharing}
                  onClick={() => void toggleScreenShare()}
                >
                  <ScreenShare className="h-5 w-5" />
                </MoreAction>
              ) : null}

              <MoreAction
                testId="incoming-video-toggle"
                label={call.incomingVideoOff ? 'Incoming video on' : 'Incoming video off'}
                active={call.incomingVideoOff}
                title={call.incomingVideoOff ? 'Turn incoming video back on' : 'Turn off incoming video (saves data)'}
                onClick={toggleIncomingVideo}
              >
                {call.incomingVideoOff ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
              </MoreAction>

              <MoreAction
                testId="call-more-devices"
                label="Devices"
                active={menu === 'devices'}
                onClick={() => setMenu(menu === 'devices' ? null : 'devices')}
              >
                <Settings2 className="h-5 w-5" />
              </MoreAction>

              {call.video ? (
                <MoreAction testId="call-more-audio-only" label="Audio only" onClick={() => void switchToAudioOnly()}>
                  <VolumeX className="h-5 w-5" />
                </MoreAction>
              ) : null}

              <MoreAction testId="call-more-minimise" label="Minimise" onClick={() => { setMoreOpen(false); setMinimised(true); }}>
                <Minimize2 className="h-5 w-5" />
              </MoreAction>
            </div>

            {menu === 'devices' ? (
              <div className="mx-3 mt-2 max-h-72 overflow-y-auto rounded-2xl bg-black/30 p-3 text-[12px]" data-testid="device-menu">
                <p className="font-semibold">Microphone</p>
                {call.devices.audioInput.map((device) => (
                  <button key={device.deviceId} type="button" className="block w-full truncate rounded-lg px-2 py-1 text-left hover:bg-white/10" onClick={() => void switchDevice('audio', device.deviceId)}>
                    {device.label || 'Microphone'}
                  </button>
                ))}
                {call.video ? (
                  <>
                    <p className="mt-2 font-semibold">Camera</p>
                    {call.devices.videoInput.map((device) => (
                      <button key={device.deviceId} type="button" className="block w-full truncate rounded-lg px-2 py-1 text-left hover:bg-white/10" onClick={() => void switchDevice('video', device.deviceId)}>
                        {device.label || 'Camera'}
                      </button>
                    ))}
                    <button type="button" className="mt-1 w-full rounded-lg px-2 py-1 text-left font-semibold hover:bg-white/10" onClick={() => void flipCamera()}>
                      <SwitchCamera className="mr-1 inline h-3.5 w-3.5" /> Flip camera
                    </button>
                  </>
                ) : null}
                {supportsSpeakerSelection() ? (
                  <>
                    <p className="mt-2 font-semibold">Speaker</p>
                    {call.devices.audioOutput.map((device) => (
                      <button key={device.deviceId} type="button" className="block w-full truncate rounded-lg px-2 py-1 text-left hover:bg-white/10" onClick={() => void setSpeaker(device.deviceId)}>
                        {device.label || 'Speaker'}
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {addParticipantOpen ? (
        <div className="absolute inset-0 z-[75] grid place-items-center bg-black/60 p-4" onClick={() => setAddParticipantOpen(false)}>
          <div
            className="flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-ink-800 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Add a participant to this call"
            data-testid="add-participant"
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <UserPlus className="h-4 w-4" />
              <p className="flex-1 text-sm font-semibold">Add participant</p>
              <button type="button" className="rounded p-1 hover:bg-white/10" aria-label="Close add participant" onClick={() => setAddParticipantOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="px-4 pt-2 text-[11.5px] text-white/60">
              This 1:1 call becomes a group call and the person you pick is rung.
            </p>
            <div className="p-3">
              <input
                className="w-full rounded-lg bg-white/10 px-3 py-2 text-[13px] text-white placeholder:text-white/40 focus:outline-none"
                placeholder="Search contacts"
                value={participantSearch}
                onChange={(event) => setParticipantSearch(event.target.value)}
                aria-label="Search contacts to add"
              />
            </div>
            <div className="max-h-64 flex-1 overflow-y-auto pb-2">
              {contacts.filter((contact) => contact.id !== call.participants[0]?.id && contact.displayName.toLowerCase().includes(participantSearch.trim().toLowerCase())).length === 0 ? (
                <p className="px-4 py-3 text-[12.5px] text-white/60">No contacts found.</p>
              ) : (
                contacts
                  .filter((contact) => contact.id !== call.participants[0]?.id && contact.displayName.toLowerCase().includes(participantSearch.trim().toLowerCase()))
                  .map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-white/10"
                      onClick={() => {
                        inviteParticipant(contact.id);
                        setAddParticipantOpen(false);
                        setParticipantSearch('');
                      }}
                    >
                      <Avatar name={contact.displayName} url={contact.avatarUrl} className="h-8 w-8 text-[11px]" />
                      <span className="truncate text-[13px]">{contact.displayName}</span>
                    </button>
                  ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
