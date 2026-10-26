import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Camera, CameraOff, ChevronDown, Grid2x2, Maximize2, MessageSquare, Mic, MicOff, Minimize2,
  PhoneOff, PictureInPicture2, Pin, PinOff, ScreenShare, Settings2, Signal, SignalLow,
  SignalMedium, SwitchCamera, UserPlus, Video, VideoOff, Volume2, VolumeX, X, Users,
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
  retryCall,
  rejectCall,
  requestVideoUpgrade,
  respondVideoUpgrade,
  screenShareUnavailableReason,
  setMinimised,
  setSpeaker,
  supportsSpeakerSelection,
  switchDevice,
  switchToAudioOnly,
  toggleCamera,
  toggleIncomingVideo,
  toggleMute,
  toggleScreenShare,
  type CallParticipant,
  type CallState,
} from '../lib/calls';
import { api } from '../lib/api';

function initials(name?: string): string {
  const clean = (name || '?').trim();
  const parts = clean.split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function clockFor(startedAt: number | null): string {
  const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function formatDurationSeconds(totalSeconds: number): string {
  const elapsed = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function statusText(call: CallState, active: boolean): string {
  if (call.status === 'incoming') return call.isGroup ? 'Incoming group call' : call.title ? `${call.title} is calling…` : 'Incoming call…';
  if (call.status === 'calling') return call.isGroup ? 'Calling the group…' : 'Calling…';
  if (call.status === 'connecting') return 'Connecting…';
  if (call.status === 'reconnecting') return 'Reconnecting…';
  if (call.status === 'active') return active ? `Connected · ${clockFor(call.startedAt)}` : 'Connecting…';
  if (call.status === 'ended' || call.status === 'error') return outcomeText(call);
  return '';
}

function qualityIcon(quality: CallState['quality']) {
  if (quality === 'good') return Signal;
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
  const stream = getPeerStream(participant.id);
  const showVideo =
    videoEnabled &&
    participant.cameraOn !== false &&
    !participant.audioOnly &&
    participant.videoOff !== true;
  const sharing = screenSharing || participant.screenSharing === true;

  useEffect(() => {
    const element = video.current;
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
        <video
          ref={(element) => {
            video.current = element;
            onRegisterVideo(element);
          }}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          aria-label={`${participant.displayName ?? 'Participant'} video`}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
          {participant.avatarUrl ? (
            <img src={participant.avatarUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
          ) : (
            <div className="grid h-20 w-20 place-items-center rounded-full bg-brand-600 text-2xl font-bold">
              {initials(participant.displayName)}
            </div>
          )}
          <span className="text-sm font-semibold">{participant.displayName ?? 'Chatgram user'}</span>
          {participant.incomingVideoOff ? (
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

function ControlButton({
  children,
  label,
  hint,
  active = false,
  disabled = false,
  title,
  onClick,
}: {
  children: ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={title ?? (hint ? `${label} (${hint})` : label)}
      className={`grid h-12 w-12 place-items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-white/10 text-white hover:bg-white/20'
      }`}
    >
      {children}
    </button>
  );
}

export function CallOverlay({ call }: { call: CallState }) {
  const localVideo = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, forceTick] = useState(0);
  const [menu, setMenu] = useState<null | 'devices' | 'connection'>(null);
  const [layout, setLayout] = useState<'speaker' | 'gallery'>('speaker');
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [messages, setMessages] = useState<{ id: string; senderId: string; content: string; sentAt: string }[]>([]);
  const [selfPos, setSelfPos] = useState<'br' | 'bl' | 'tr' | 'tl'>('br');
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');
  const [contacts, setContacts] = useState<{ id: string; displayName: string; avatarUrl: string | null }[]>([]);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const active = call.status === 'active' && Boolean(call.startedAt);
  const inCall = call.status === 'calling' || call.status === 'connecting' || call.status === 'reconnecting' || call.status === 'active';
  const showVideo = call.video && !call.audioOnly;
  const remoteCount = call.participants.length;
  const cap = call.video ? MAX_VIDEO_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS;
  const participantIds = useMemo(() => call.participants.map((participant) => participant.id), [call.participants]);
  const speaking = useSpeaking(participantIds);
  const android = isAndroidNative();
  const screenShareReason = screenShareUnavailableReason();
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

  useEffect(() => {
    const stream = getLocalStream();
    const element = localVideo.current;
    if (element && showVideo && call.cameraOn && stream && element.srcObject !== stream) element.srcObject = stream;
  });

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
      if (key === 'escape') { event.preventDefault(); setMinimised(true); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [call.status, call.video]);

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

  const prominent = useMemo<CallParticipant | null>(() => {
    if (pinnedId) return call.participants.find((participant) => participant.id === pinnedId) ?? null;
    // A shared screen is shown large by default: it is the main content.
    const sharer = call.participants.find((participant) => participant.screenSharing);
    if (sharer) return sharer;
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

  if (call.status === 'idle') return null;

  if (call.status === 'incoming') {
    const caller = call.participants[0];
    const others = call.participants.filter((participant) => participant.id !== caller?.id);
    return (
      <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-ink-900 to-black p-6 text-white" role="dialog" aria-label="Incoming call" data-testid="call-incoming">
        <div className="relative">
          <div className="absolute inset-0 scale-150 rounded-full bg-brand-500/20 blur-2xl" aria-hidden="true" />
          {caller?.avatarUrl ? (
            <img src={caller.avatarUrl} alt="" className="relative h-32 w-32 rounded-full object-cover" />
          ) : (
            <div className="relative grid h-32 w-32 place-items-center rounded-full bg-brand-600 text-4xl font-bold">{initials(call.title)}</div>
          )}
        </div>
        <div className="text-center">
          <p className="text-sm text-white/70" data-testid="incoming-call-kind">
            {call.isGroup
              ? `Incoming group ${call.video ? 'video' : 'voice'} call`
              : call.video
                ? 'Incoming video call'
                : 'Incoming audio call'}
          </p>
          <h2 className="mt-1 text-2xl font-bold">{call.title}</h2>
          <p className="mt-1 text-[13px] text-white/70">
            {call.isGroup
              ? `${call.participants.length} ${call.participants.length === 1 ? 'person' : 'people'} on the call${
                  call.ringCount > 1 ? ` · ${call.ringCount} invited` : ''
                }`
              : caller?.displayName || 'Chatgram user'}
          </p>
          {others.length > 0 ? (
            <div className="mt-3 flex items-center justify-center gap-1.5" aria-hidden="true">
              {others.slice(0, 4).map((participant) => (
                <span key={participant.id} className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-ink-700 text-[11px] font-bold">
                  {participant.avatarUrl ? <img src={participant.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(participant.displayName)}
                </span>
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
    const detail =
      call.outcome === 'ended' && call.durationSeconds > 0
        ? `Duration ${formatDurationSeconds(call.durationSeconds)}`
        : call.message || title;
    return (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-6 text-white" role="dialog" aria-label={title}>
        <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6 text-center shadow-2xl" data-testid="call-ended">
          <p className="text-lg font-bold" data-testid="call-ended-message">{title}</p>
          <p className="mt-1 text-[13px] text-white/70" data-testid="call-ended-detail">
            {detail}
          </p>
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
          <p className="text-[11px] text-white/70" data-testid="minimised-call-status">
            {call.status === 'active' ? clockFor(call.startedAt) : statusText(call, active)}
          </p>
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
  const mainParticipant = swapped ? null : prominent;
  const galleryCount = others.length + 1;
  const gridClass =
    galleryCount <= 1 ? 'grid-cols-1' : galleryCount <= 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3';
  const selfPosition = { br: 'bottom-3 right-3', bl: 'bottom-3 left-3', tr: 'top-3 right-3', tl: 'top-3 left-3' }[selfPos];

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[70] flex flex-col bg-gradient-to-b from-ink-900 via-ink-900 to-black text-white"
      role="dialog"
      aria-label={call.isGroup ? 'Group call' : 'Call'}
      data-testid="call-overlay"
    >
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-base font-bold" data-testid="call-status">
            <span>{statusText(call, active)}</span>
            {active ? <span className="text-sm font-semibold text-emerald-300" data-testid="call-timer">{clockFor(call.startedAt)}</span> : null}
          </h2>
          <p className="truncate text-[12px] text-white/70" data-testid="call-title">
            {call.title}
            {call.isGroup ? ` · ${remoteCount + 1} / ${cap}` : ''}
          </p>
        </div>
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
              <button
                type="button"
                className="mt-2 w-full rounded-lg bg-white/10 px-2 py-1.5 font-semibold hover:bg-white/20"
                onClick={toggleIncomingVideo}
                aria-pressed={call.incomingVideoOff}
                data-testid="incoming-video-toggle"
              >
                {call.incomingVideoOff ? 'Turn incoming video back on' : 'Turn off incoming video (saves data)'}
              </button>
              {call.incomingVideoOff ? (
                <p className="mt-1 text-[11px] text-white/60">Audio still plays. Others can still hear you.</p>
              ) : null}
              {android && screenShareReason ? (
                <p className="mt-2 rounded-lg bg-white/5 px-2 py-1.5 text-[11px] text-white/60">{screenShareReason}</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <button type="button" className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Minimise call" onClick={() => setMinimised(true)}>
          <Minimize2 className="h-4 w-4" />
        </button>
      </div>

      {/* stage */}
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

        {call.screenSharing ? (
          <div className="absolute inset-x-4 top-4 z-20 flex flex-wrap items-center gap-2 rounded-xl bg-emerald-600/90 px-3 py-2 text-[12.5px] font-semibold" data-testid="sharing-bar">
            <ScreenShare className="h-4 w-4" />
            <span>You are sharing your screen{call.screenAudio ? ' · with system audio' : ''}</span>
            <span className="flex-1" />
            <button type="button" className="rounded-full bg-black/20 px-3 py-1 text-[11.5px] hover:bg-black/30" onClick={() => void toggleScreenShare()}>Stop sharing</button>
          </div>
        ) : null}

        {sharers.length > 0 && !call.screenSharing ? (
          <div className="absolute inset-x-4 top-4 z-20 flex items-center gap-2 rounded-xl bg-emerald-600/85 px-3 py-2 text-[12.5px] font-semibold" data-testid="remote-sharing-bar">
            <ScreenShare className="h-4 w-4" />
            <span>
              {sharers.map((participant) => participant.displayName || 'Someone').join(', ')} is sharing their screen
              {sharers.some((participant) => participant.hasSystemAudio) ? ' with audio' : ''}
            </span>
          </div>
        ) : null}

        {call.incomingVideoOff ? (
          <div className="absolute inset-x-4 bottom-2 z-20 rounded-xl bg-amber-500/20 px-3 py-1.5 text-center text-[12px] font-semibold text-amber-100" data-testid="incoming-video-note">
            Incoming video is off — you can still hear everyone.
          </div>
        ) : null}

        {showVideo ? (
          <div className="flex h-full min-h-0 flex-col gap-2">
            {layout === 'speaker' && remoteCount > 0 ? (
              <div className="relative h-full min-h-0 flex-1">
                {swapped ? (
                  <div className="relative flex h-full items-center justify-center overflow-hidden rounded-2xl bg-ink-800">
                    {call.cameraOn || call.screenSharing ? (
                      <video ref={localVideo} autoPlay playsInline muted className={`h-full w-full object-cover ${call.screenSharing ? '' : 'scale-x-[-1]'}`} aria-label="Your video" />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-center">
                        <CameraOff className="h-10 w-10 text-white/60" />
                        <span className="text-[12px] text-white/70">Camera off · others can still hear you</span>
                      </div>
                    )}
                    <span className="absolute bottom-2 left-2 rounded-md bg-black/50 px-2 py-0.5 text-xs font-medium">You</span>
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
                {/* self view: draggable, snaps to a corner, tap to swap */}
                <div
                  className={`absolute ${selfPosition} z-20 h-[26%] max-h-40 w-[26%] max-w-[180px] cursor-grab touch-none overflow-hidden rounded-xl border border-white/25 bg-ink-800 shadow-xl`}
                  onPointerDown={(event) => {
                    drag.current = { x: event.clientX, y: event.clientY, moved: false };
                    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!drag.current) return;
                    if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 6) drag.current.moved = true;
                  }}
                  onPointerUp={(event) => {
                    const start = drag.current;
                    drag.current = null;
                    if (!start) return;
                    if (!start.moved) {
                      setSwapped((value) => !value);
                      return;
                    }
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (rect) {
                      const right = event.clientX > rect.left + rect.width / 2;
                      const bottom = event.clientY > rect.top + rect.height / 2;
                      setSelfPos(`${bottom ? 'b' : 't'}${right ? 'r' : 'l'}` as typeof selfPos);
                    }
                  }}
                  title="Drag to a corner, tap to swap with the main view"
                  data-testid="self-view"
                >
                  {call.cameraOn || call.screenSharing ? (
                    <video ref={localVideo} autoPlay playsInline muted className={`h-full w-full object-cover ${call.screenSharing ? '' : 'scale-x-[-1]'}`} aria-label="Your video" />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-ink-800" data-testid="self-camera-off">
                      <CameraOff className="h-6 w-6 text-white/60" aria-label="Your camera is off" />
                    </div>
                  )}
                  {call.muted ? <MicOff className="absolute right-1 top-1 h-3.5 w-3.5 text-rose-300" /> : null}
                </div>
              </div>
            ) : (
              <div className={`grid min-h-0 flex-1 auto-rows-fr gap-2 overflow-y-auto ${gridClass}`}>
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
                  {call.cameraOn === false ? <CameraOff className="absolute right-2 top-2 h-4 w-4" /> : null}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="relative flex h-full min-h-0 flex-col items-center justify-center overflow-hidden rounded-2xl bg-ink-800">
            {prominent?.avatarUrl ? (
              <img src={prominent.avatarUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" aria-hidden="true" />
            ) : null}
            <div className="relative flex flex-col items-center gap-3 px-6 text-center">
              {prominent?.avatarUrl ? (
                <img src={prominent.avatarUrl} alt="" className="h-36 w-36 rounded-full object-cover shadow-2xl" data-testid="callee-avatar" />
              ) : (
                <div className="grid h-36 w-36 place-items-center rounded-full bg-brand-600 text-4xl font-bold shadow-2xl" data-testid="callee-avatar">
                  {initials(call.title)}
                </div>
              )}
              <p className="text-xl font-bold">{call.title}</p>
              <p className="text-sm text-white/75">{statusText(call, active)}</p>
              {call.muted ? <p className="rounded-full bg-rose-600/20 px-3 py-1 text-[12px] font-semibold text-rose-200">You're muted</p> : null}
              {remoteCount > 1 ? <p className="text-[12px] text-white/60">{remoteCount + 1} people on the call</p> : null}
            </div>
          </div>
        )}
      </div>

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
                <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-ink-700 text-[11px] font-bold">
                  {participant.avatarUrl ? <img src={participant.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(participant.displayName)}
                </span>
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

      {call.notice ? (
        <div className="pointer-events-none absolute inset-x-4 bottom-24 z-40 flex justify-center">
          <p className="rounded-full bg-black/70 px-3 py-1.5 text-center text-[12px] text-white/90" role="status">{call.notice}</p>
        </div>
      ) : null}

      {showVideo && call.muted ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center">
          <p className="rounded-full bg-black/70 px-3 py-1 text-[12px] font-semibold text-rose-200" data-testid="youre-muted">You're muted</p>
        </div>
      ) : null}

      {call.status === 'reconnecting' ? (
        <div className="absolute inset-x-4 top-16 z-30 rounded-xl bg-amber-500/20 px-3 py-2 text-center text-[12.5px] font-semibold text-amber-200">
          Reconnecting… your connection dropped.
        </div>
      ) : null}

      {/* controls */}
      <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-center gap-2 px-3 py-3 sm:gap-3">
        <ControlButton label={call.muted ? 'Unmute' : 'Mute'} hint="M" active={call.muted} onClick={() => void toggleMute()}>
          {call.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </ControlButton>

        <div className="relative">
          <ControlButton label="Devices" onClick={() => setMenu(menu === 'devices' ? null : 'devices')}>
            <Settings2 className="h-5 w-5" />
          </ControlButton>
          {menu === 'devices' ? (
            <div className="absolute bottom-full left-1/2 z-30 mb-2 max-h-72 w-64 -translate-x-1/2 overflow-y-auto rounded-2xl border border-white/15 bg-ink-800 p-3 text-[12px] shadow-2xl" data-testid="device-menu">
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

        {call.video ? (
          <>
            <ControlButton label={call.cameraOn ? 'Camera off' : 'Camera on'} hint="V" active={call.cameraOn === false} onClick={() => void toggleCamera()}>
              {call.cameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </ControlButton>
            {!android ? (
              <ControlButton
                label={call.screenSharing ? 'Stop sharing' : 'Share screen'}
                hint="S"
                active={call.screenSharing}
                disabled={!isScreenSharingSupported()}
                title={screenShareReason ?? undefined}
                onClick={() => void toggleScreenShare()}
              >
                <ScreenShare className="h-5 w-5" />
              </ControlButton>
            ) : null}
            <ControlButton label={layout === 'speaker' ? 'Gallery view' : 'Speaker view'} onClick={() => setLayout(layout === 'speaker' ? 'gallery' : 'speaker')}>
              {layout === 'speaker' ? <Grid2x2 className="h-5 w-5" /> : <Users className="h-5 w-5" />}
            </ControlButton>
            <ControlButton label="Full screen" onClick={() => void requestFullscreen()}>
              <Maximize2 className="h-5 w-5" />
            </ControlButton>
            <ControlButton label="Picture in picture" disabled={!showVideo} onClick={() => void togglePip()}>
              <PictureInPicture2 className="h-5 w-5" />
            </ControlButton>
            <ControlButton label="Audio only" onClick={() => void switchToAudioOnly()}>
              <VolumeX className="h-5 w-5" />
            </ControlButton>
          </>
        ) : (
          <>
            <ControlButton label="Switch to video" onClick={requestVideoUpgrade}>
              <Video className="h-5 w-5" />
            </ControlButton>
            {supportsSpeakerSelection() ? (
              <ControlButton label="Speaker" onClick={() => setMenu(menu === 'devices' ? null : 'devices')}>
                <Volume2 className="h-5 w-5" />
              </ControlButton>
            ) : null}
          </>
        )}

        <ControlButton
          label={call.incomingVideoOff ? 'Turn incoming video on' : 'Turn off incoming video'}
          active={call.incomingVideoOff}
          onClick={toggleIncomingVideo}
        >
          {call.incomingVideoOff ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
        </ControlButton>

        <ControlButton
          label="Add participant"
          disabled={call.isGroup}
          title={
            call.isGroup
              ? 'Everyone in this group can join from the group chat'
              : 'Add someone to this call and turn it into a group call'
          }
          onClick={() => setAddParticipantOpen(true)}
        >
          <UserPlus className="h-5 w-5" />
        </ControlButton>
        <ControlButton label={participantsOpen ? 'Hide participants' : 'Participants'} active={participantsOpen} onClick={() => setParticipantsOpen((value) => !value)}>
          <Users className="h-5 w-5" />
        </ControlButton>
        <ControlButton label="Messages" active={messagesOpen} onClick={() => setMessagesOpen((value) => !value)}>
          <MessageSquare className="h-5 w-5" />
        </ControlButton>

        <button type="button" className="grid h-14 w-14 place-items-center rounded-full bg-rose-600 hover:bg-rose-700" aria-label="Hang up" title="End call" onClick={hangUp}>
          <PhoneOff className="h-6 w-6" />
        </button>
      </div>

      {call.cameraOn === false && call.video && !call.screenSharing ? (
        <p className="relative z-10 -mt-1 pb-2 text-center text-[11.5px] text-white/65" data-testid="camera-off-note">
          Camera off — others can still hear your audio.
        </p>
      ) : null}
      {android && screenShareReason ? (
        <p className="relative z-10 -mt-1 pb-2 text-center text-[11.5px] text-white/60" data-testid="screen-share-unsupported-note">
          {screenShareReason}
        </p>
      ) : null}

      {addParticipantOpen ? (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={() => setAddParticipantOpen(false)}>
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
                      <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-ink-700 text-[11px] font-bold">
                        {contact.avatarUrl ? <img src={contact.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(contact.displayName)}
                      </span>
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
