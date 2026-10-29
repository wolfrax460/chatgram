/**
 * WebRTC calling: 1:1 and group, voice and video.
 *
 * Design notes
 * - Mesh: one RTCPeerConnection per remote peer. Video is capped at 6 people and
 *   audio-only at 12; beyond that an SFU is needed (see docs/decisions.md).
 * - Perfect negotiation (W3C pattern): one side is "polite" per pair, derived
 *   from user ids. Colliding offers roll back instead of failing, so ICE
 *   restarts and simultaneous renegotiation never break the call.
 * - ICE: TURN credentials are fetched fresh for every call and refreshed when a
 *   connection needs an ICE restart. Credentials expire after an hour.
 * - Cleanup: tracks, senders, peer connections and timers are torn down on end,
 *   decline, error, page unload and missed ring, so the camera light goes out.
 */
import { api, realtime } from './api';
import {
  hasMediaCapture,
  isSecureMediaContext,
  mediaKindOf,
  queryMediaPermission,
  reportMediaFailure,
  type MediaKind,
} from './mediaPermissions';

export type CallStatus =
  | 'idle'
  | 'calling'
  | 'incoming'
  | 'connecting'
  | 'reconnecting'
  | 'active'
  | 'ended'
  | 'error';

/**
 * How a call finished. The UI must never say "Call ended" for a call that
 * failed — each value has its own wording (WhatsApp-like).
 */
export type CallOutcome =
  | 'declined'
  | 'missed'
  | 'busy'
  | 'failed'
  | 'ended'
  | 'cancelled'
  | 'answered-elsewhere'
  | 'unavailable';

export interface CallParticipant {
  id: string;
  displayName?: string;
  avatarUrl?: string | null;
  audioOnly?: boolean;
  /** Signalled in-call state (relayed by the server's call:signal event). */
  muted?: boolean;
  cameraOn?: boolean;
  screenSharing?: boolean;
  /** 'screen' | 'window' | 'browser' while sharing. */
  sharingKind?: 'screen' | 'window' | 'browser';
  /** The shared screen carries system audio. */
  hasSystemAudio?: boolean;
  /** This person stopped receiving my video (they turned incoming video off). */
  incomingVideoOff?: boolean;
  /** This participant's video tile should be treated as camera-off. */
  videoOff?: boolean;
  /** This person's client can host remote control of their shared screen. */
  controlCapable?: boolean;
}

/** In-call state signal, relayed by the server via call:signal / call:participant-state. */
export interface CallSignal {
  kind: 'muted' | 'camera' | 'screen' | 'video-request' | 'video-accepted' | 'video-declined' | 'incoming-video-off';
  muted?: boolean;
  cameraOn?: boolean;
  screenSharing?: boolean;
  sharingKind?: 'screen' | 'window' | 'browser';
  hasSystemAudio?: boolean;
  /**
   * Advertised by the sharer: whether their client can inject remote-control
   * input (Windows desktop app). Absent = older client that did not say.
   */
  controlCapable?: boolean;
  /** For 'incoming-video-off': true = that person stopped receiving video. */
  off?: boolean;
}

/** A live group call room snapshot (mirrors the server's call:room payload). */
export interface CallRoom {
  chatId: string;
  callId: string | null;
  state: 'ringing' | 'active' | 'ended';
  status: 'ringing' | 'completed' | 'missed' | 'declined' | 'busy' | 'failed' | 'cancelled';
  video: boolean;
  mode: 'voice' | 'video';
  isGroup: boolean;
  title: string;
  startedBy: { id: string; displayName: string; avatarUrl?: string | null } | null;
  startedAt: number | null;
  answeredAt: number | null;
  endedAt: number | null;
  durationSeconds: number;
  participants: CallParticipant[];
  participantCount: number;
  capacity: number;
  /** Camera slots (6 for a video room, 0 for a voice room). */
  videoCapacity?: number;
  cameraCount?: number;
  inviteeCount?: number;
  cardMessageId: string | null;
  endReason: string | null;
  joinable: boolean;
}

export type CallQuality = 'unknown' | 'good' | 'fair' | 'poor';

/**
 * Quality of the SCREEN-SHARE media path while a share is active.
 * Sampled from the screen's own RTP stream so the camera's numbers can never
 * mask (or fake) the share's quality.
 */
export interface ScreenShareStats {
  active: boolean;
  bitrateKbps: number | null;
  rttMs: number | null;
  lossPct: number | null;
  /** True while the bitrate has stayed below SCREEN_LOW_KBPS for SCREEN_LOW_MS. */
  low: boolean;
}

/** Remote-control state from the viewer's point of view. */
export type RemoteControlStatus = 'idle' | 'requested' | 'active' | 'denied';

/**
 * Live WebRTC numbers from `getStats()`, shown in the call UI when media stops.
 *
 * They exist because "no audio and no video" is undiagnosable from a screenshot:
 * the difference between "ICE never connected", "connected through a relay" and
 * "connected but the remote stream is not attached" is one candidate-pair type and
 * two byte counters. Nothing here is message content.
 */
export interface CallDiagnostics {
  iceConnectionState: string;
  connectionState: string;
  /** e.g. `host→srflx`, `srflx→relay`; null until a candidate pair is selected. */
  candidatePair: string | null;
  audioIn: number;
  videoIn: number;
  audioOut: number;
  videoOut: number;
  remoteTracks: number;
  remoteMuted: number;
  /** Remote receivers whose track is live (0 = `ontrack` never produced media). */
  receiverCount: number;
  /**
   * The other side's negotiated m-line directions, e.g. `audio:recvonly,video:recvonly`.
   * `recvonly`/`inactive` is the one-way-call signature: they do not send to us.
   */
  remoteDirections: string | null;
  /** Connected peers that keep sending while we receive zero bytes (after 5 s). */
  missingMediaPeers: number;
  /** True when the ICE server list contains a TURN url (a relay was available). */
  relayConfigured: boolean;
  /** Seconds since media was expected with zero bytes received. */
  stalledSeconds: number;
  /** True while a screen share (local or remote) is active. */
  screenActive: boolean;
  /** Screen-path bitrate (kbps) sampled from the share's own video stream. */
  screenBitrateKbps: number | null;
  /** Screen-path RTT (ms) from the candidate pair carrying the share. */
  screenRttMs: number | null;
  /** Screen-path video packet loss (%). */
  screenLossPct: number | null;
  /** True when the share bitrate has been under SCREEN_LOW_KBPS for SCREEN_LOW_MS. */
  screenLow: boolean;
  /** This client can host remote control (Windows desktop bridge available). */
  controlLocal: boolean;
  /** The remote sharer's client can host control (null = not advertised). */
  controlRemote: boolean | null;
  /** A control data channel is open. */
  controlChannel: boolean;
}


export interface CallDevice {
  deviceId: string;
  label: string;
}

export interface CallState {
  status: CallStatus;
  callId: string | null;
  chatId: string | null;
  title: string;
  video: boolean;
  isGroup: boolean;
  participants: CallParticipant[];
  /** Participant cap for this call (6 video / 12 audio). */
  capacity: number;
  muted: boolean;
  cameraOn: boolean;
  startedAt: number | null;
  message?: string;
  notice?: string;
  streamTick: number;
  quality: CallQuality;
  minimised: boolean;
  audioOnly: boolean;
  /** Input/output devices discovered after permission is granted. */
  devices: { audioInput: CallDevice[]; audioOutput: CallDevice[]; videoInput: CallDevice[] };
  /** Selected output device (speaker), where the browser supports setSinkId. */
  sinkId: string;
  /** The other person asked to switch this audio call to video. */
  videoRequest: CallParticipant | null;
  /** I asked the other person to switch to video and am waiting. */
  videoUpgradePending: boolean;
  /** My screen is being shared right now. */
  screenSharing: boolean;
  /** System audio is being shared along with the screen (where supported). */
  screenAudio: boolean;
  /** Low-bandwidth mode: incoming video is hidden until the user turns it back on. */
  lowBandwidth: boolean;
  /** Incoming video is switched off per person (audio-only reception, saves data). */
  incomingVideoOff: boolean;
  /** How the call finished; null while it is still running. */
  outcome: CallOutcome | null;
  /** Final call duration in seconds, for the ended screen. */
  durationSeconds: number;
  /** True when the last call target can be dialled again from the ended screen. */
  canRetry: boolean;
  /** How many people were rung (an incoming group call shows "N people"). */
  ringCount: number;
  /** Connection indicator detail (from getStats). */
  stats: { latencyMs: number | null; packetLoss: number | null };
  /** WebRTC numbers for the in-call warning (null before the first sample). */
  diagnostics: CallDiagnostics | null;
  /** True when nothing has arrived for the stall window while the call is up. */
  mediaStalled: boolean;
  /** Quality of the screen-share path while a share is active. */
  screenQuality: CallQuality;
  screenStats: ScreenShareStats;
  /** True when this shell can inject remote-control input (Windows desktop app). */
  controlSupported: boolean;
  /** Sharer: I explicitly allow remote control of my shared screen (default off). */
  controlAllowed: boolean;
  /** Sharer: the viewer whose control request waits for approval. */
  controlPendingId: string | null;
  /** Sharer: the single viewer currently controlling my screen. */
  controlViewerId: string | null;
  /** Viewer: the remote sharer's consent signal is on. */
  controlAvailable: boolean;
  /** Viewer: my request state with that sharer. */
  controlStatus: RemoteControlStatus;
  /** Viewer: the peer whose shared screen I am controlling. */
  controlPeerId: string | null;
  /** Honest reason when control is unavailable/refused (never keystrokes). */
  controlMessage: string | null;
  /** Viewer: can the remote sharer's client host control (null = not advertised)? */
  controlHostCapable: boolean | null;
  /** Viewer: a `control` data channel is open to at least one peer. */
  controlChannelReady: boolean;
}

/** Honest mesh caps, mirrored from the server. */
export const MAX_VIDEO_PARTICIPANTS = 6;
export const MAX_AUDIO_PARTICIPANTS = 12;
/** How long a call may ring before it is reported as missed. */
export const RING_TIMEOUT_MS = 45_000;
/** How long we try to recover a dropped peer connection before giving up. */
const RECONNECT_WINDOW_MS = 15_000;
const STATS_INTERVAL_MS = 3_000;

const IDLE: CallState = {
  status: 'idle',
  callId: null,
  chatId: null,
  title: '',
  video: false,
  isGroup: false,
  participants: [],
  capacity: MAX_VIDEO_PARTICIPANTS,
  muted: false,
  cameraOn: false,
  startedAt: null,
  streamTick: 0,
  quality: 'unknown',
  diagnostics: null,
  mediaStalled: false,
  screenQuality: 'unknown',
  screenStats: { active: false, bitrateKbps: null, rttMs: null, lossPct: null, low: false },
  controlSupported: false,
  controlAllowed: false,
  controlPendingId: null,
  controlViewerId: null,
  controlAvailable: false,
  controlStatus: 'idle',
  controlPeerId: null,
  controlMessage: null,
  controlHostCapable: null,
  controlChannelReady: false,
  minimised: false,
  videoRequest: null,
  videoUpgradePending: false,
  screenSharing: false,
  screenAudio: false,
  lowBandwidth: false,
  incomingVideoOff: false,
  outcome: null,
  durationSeconds: 0,
  canRetry: false,
  ringCount: 0,
  stats: { latencyMs: null, packetLoss: null },
  audioOnly: false,
  devices: { audioInput: [], audioOutput: [], videoInput: [] },
  sinkId: '',
};

let state: CallState = { ...IDLE };
const listeners = new Set<(state: CallState) => void>();

function setState(patch: Partial<CallState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function subscribeCalls(listener: (state: CallState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCallState(): CallState {
  return state;
}

interface ActiveCall {
  callId: string;
  chatId: string;
  video: boolean;
  isGroup: boolean;
  title: string;
  capacity: number;
}

interface PeerHandle {
  pc: RTCPeerConnection;
  stream: MediaStream;
  info: CallParticipant;
  /** Perfect negotiation role: the polite side yields on offer collisions. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  restartTimer: number | null;
  disconnectedAt: number | null;
  /** Stable sender references so tracks can be swapped/removed reliably. */
  videoSender: RTCRtpSender | null;
  audioSender: RTCRtpSender | null;
  /** When a connected peer was first seen sending media with zero bytes received. */
  noInboundSince: number | null;
  /** True once the "we receive 0 B" warning was logged for this peer. */
  missingMediaLogged: boolean;
  /** Remote-control data channel (label `control`, ordered+reliable). */
  controlChannel: RTCDataChannel | null;
  /** True when the remote side opened the control channel (we did not create it). */
  controlRemoteSeen: boolean;
}

let current: ActiveCall | null = null;

/** When media was first expected in this call (stall clock); 0 = not armed. */
let mediaWatchStartedAt = 0;
/** The stall was already reported to the admin Inbox for this call. */
let stallReported = false;
/** How long with zero received media before the in-call warning appears. */
const MEDIA_STALL_MS = 8_000;
/**
 * A connected peer that keeps SENDING while we receive nothing has no receive
 * direction in the negotiated SDP. ICE is fine, so an ICE restart cannot fix it;
 * detect it sooner than the generic stall so the UI can say who is not sending.
 */
const MISSING_MEDIA_MS = 5_000;

/** Screen-share quality thresholds (the share is judged on its own stream). */
const SCREEN_GOOD_KBPS = 800;
const SCREEN_LOW_KBPS = 250;
const SCREEN_LOW_MS = 5_000;

/** Remote-control data channel + protocol limits. */
const CONTROL_CHANNEL_LABEL = 'control';
/** Host-side hard cap, also enforced again in the Electron main process. */
const CONTROL_MAX_EVENTS_PER_SEC = 120;
/** Keys a viewer may send. Printable ASCII plus navigation/modifier keys. */
const CONTROL_KEY_NAMES = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Backspace', 'Enter', 'Tab', 'Escape', 'Delete',
  'Home', 'End', 'PageUp', 'PageDown',
  'Shift', 'Control', 'Alt', 'Meta',
]);

/** Compact control payloads sent over the data channel (never logged). */
export type ControlInputMessage =
  | { t: 'm'; x: number; y: number }
  | { t: 'w'; x: number; y: number; dy: number }
  | { t: 'c'; x: number; y: number; button: 0 | 1 | 2; down: boolean }
  | { t: 'k'; key: string; down: boolean };

type ControlMessage =
  | ControlInputMessage
  | { t: 'request' }
  | { t: 'release' }
  | { t: 'accept' }
  | { t: 'deny' }
  | { t: 'revoke' }
  | { t: 'allow'; on: boolean; capable?: boolean };

/** Peers we already warned about when they cannot host remote control. */
const controlCapabilityWarned = new Set<string>();
/** One local warning per call when this shell cannot inject input. */
let localControlWarned = false;

/** Sampler state for the screen-share path (separate from the camera stats). */
let screenSample: { at: number; bytes: number } | null = null;
let screenLowSince: number | null = null;
let screenLowNotified = false;
/** Host-side input rate limit (the Electron main process enforces the same cap). */
let controlRateWindow = { at: 0, count: 0 };

function allowHostControlEvent(): boolean {
  const now = Date.now();
  if (now - controlRateWindow.at > 1_000) controlRateWindow = { at: now, count: 0 };
  controlRateWindow.count += 1;
  return controlRateWindow.count <= CONTROL_MAX_EVENTS_PER_SEC;
}
let localStream: MediaStream | null = null;
/** The display-capture stream while screen sharing (separate from the camera). */
let screenStream: MediaStream | null = null;
let pendingInvite: (ActiveCall & { from: CallParticipant }) | null = null;
const peers = new Map<string, PeerHandle>();
let iceServersCache: { servers: RTCIceServer[]; fetchedAt: number; ttlMs: number } | null = null;

let ringTimer: number | null = null;
let reconnectTimer: number | null = null;
let statsTimer: number | null = null;
let endTimer: number | null = null;
let streamTick = 0;
let myUserId = '';
/** The target of the last call, so a failed/declined call can be retried. */
let lastTarget: { chatId: string; title: string; isGroup: boolean; participantCount?: number } | null = null;
let lastVideo = false;

/** Live group-call rooms by chat id (banner / call card "Join"). */
const rooms = new Map<string, CallRoom>();
const roomListeners = new Set<() => void>();

function notifyRooms(): void {
  for (const listener of roomListeners) listener();
}

export function subscribeCallRooms(listener: () => void): () => void {
  roomListeners.add(listener);
  return () => roomListeners.delete(listener);
}

export function getCallRoom(chatId: string | null | undefined): CallRoom | null {
  if (!chatId) return null;
  return rooms.get(chatId) ?? null;
}

/** Snapshot object that is safe for useSyncExternalStore (stable identity). */
export function getCallRoomSnapshot(chatId: string | null | undefined): CallRoom | null {
  return getCallRoom(chatId);
}

/** A live room is joinable when it is ringing/active and has free slots. */
export function canJoinRoom(room: CallRoom | null): boolean {
  if (!room || !room.callId) return false;
  return room.state !== 'ended' && room.joinable !== false && room.participantCount < room.capacity;
}

/** Server room snapshot → internal room (tolerates string/epoch timestamps). */
export function handleRoom(raw: unknown): void {
  const payload = (raw ?? {}) as Partial<CallRoom> & { chatId?: string; startedAt?: number | string | null; answeredAt?: number | string | null; endedAt?: number | string | null };
  const chatId = String(payload.chatId ?? '');
  if (!chatId) return;
  if (payload.state === 'ended' || !payload.callId) {
    if (rooms.delete(chatId)) notifyRooms();
    return;
  }
  const room: CallRoom = {
    chatId,
    callId: payload.callId ?? null,
    state: payload.state === 'ringing' ? 'ringing' : 'active',
    status: payload.status ?? 'ringing',
    video: payload.video === true,
    mode: payload.mode === 'video' || payload.video ? 'video' : 'voice',
    isGroup: payload.isGroup !== false,
    title: payload.title || 'Group call',
    startedBy: payload.startedBy ?? null,
    startedAt: toEpoch(payload.startedAt),
    answeredAt: toEpoch(payload.answeredAt),
    endedAt: toEpoch(payload.endedAt),
    durationSeconds: payload.durationSeconds ?? 0,
    participants: Array.isArray(payload.participants) ? payload.participants.map(normalizeParticipant) : [],
    participantCount: typeof payload.participantCount === 'number' ? payload.participantCount : (payload.participants?.length ?? 0),
    capacity: payload.capacity || MAX_AUDIO_PARTICIPANTS,
    videoCapacity: typeof payload.videoCapacity === 'number' ? payload.videoCapacity : undefined,
    cameraCount: typeof payload.cameraCount === 'number' ? payload.cameraCount : undefined,
    inviteeCount: typeof payload.inviteeCount === 'number' ? payload.inviteeCount : undefined,
    cardMessageId: payload.cardMessageId ?? null,
    endReason: payload.endReason ?? null,
    joinable: payload.joinable !== false,
  };
  rooms.set(chatId, room);
  notifyRooms();
}

/** REST seed: replaces every known room for those chats. */
export function seedCallRooms(snapshots: unknown): void {
  if (!Array.isArray(snapshots)) return;
  const keep = new Set<string>();
  for (const snapshot of snapshots as Array<Partial<CallRoom> & { chatId?: string }>) {
    if (snapshot && snapshot.chatId && snapshot.state !== 'ended' && snapshot.callId) {
      handleRoom(snapshot);
      keep.add(String(snapshot.chatId));
    }
  }
  let changed = false;
  for (const chatId of [...rooms.keys()]) {
    if (!keep.has(chatId)) {
      rooms.delete(chatId);
      changed = true;
    }
  }
  if (changed) notifyRooms();
}

function toEpoch(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeParticipant(raw: unknown): CallParticipant {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(value.id ?? value._id ?? ''),
    displayName: value.displayName ? String(value.displayName) : undefined,
    avatarUrl: value.avatarUrl ? String(value.avatarUrl) : null,
    audioOnly: value.audioOnly === true,
    muted: value.muted === true,
    cameraOn: value.cameraOn !== false,
    screenSharing: value.screenSharing === true,
    sharingKind: value.sharingKind === 'window' || value.sharingKind === 'browser' ? value.sharingKind : 'screen',
    hasSystemAudio: value.hasSystemAudio === true,
    incomingVideoOff: value.incomingVideoOff === true,
  };
}

export function setCallUserId(userId: string): void {
  myUserId = userId;
}

export function getLocalStream(): MediaStream | null {
  return localStream;
}

export function getPeerStream(peerId: string): MediaStream | null {
  return peers.get(peerId)?.stream ?? null;
}

export function getPeerIds(): string[] {
  return [...peers.keys()];
}

function newCallId(): string {
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------------ devices */

async function refreshDevices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const pick = (kind: MediaDeviceKind) =>
      list
        .filter((d) => d.kind === kind && d.deviceId)
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${kind} ${i + 1}` }));
    setState({
      devices: {
        audioInput: pick('audioinput'),
        audioOutput: pick('audiooutput'),
        videoInput: pick('videoinput'),
      },
    });
  } catch {
    /* enumeration is best-effort */
  }
}

function mediaConstraints(video: boolean): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: video
      ? {
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 30, max: 30 },
        }
      : false,
  };
}

/**
 * Preflight for capture.
 *
 * Browsers answer a hard "denied" with the same NotAllowedError as a transient
 * failure, and inside the Android WebView a denied permission is remembered per
 * origin — so asking getUserMedia again just fails again with no explanation.
 * When the Permissions API says "denied" (or the page is not a secure context)
 * we stop before the prompt and publish the fix-it dialog instead.
 *
 * Returns false when the caller must not continue.
 */
async function mediaPreflight(kind: MediaKind, retry?: () => void): Promise<boolean> {
  if (!isSecureMediaContext() || !hasMediaCapture()) {
    reportMediaFailure(new DOMException('Capture is unavailable on this page.', 'SecurityError'), kind, retry);
    return false;
  }
  const permission = await queryMediaPermission(kind === 'camera' ? 'camera' : 'microphone');
  if (permission === 'denied') {
    reportMediaFailure(new DOMException('Permission denied.', 'NotAllowedError'), kind, retry);
    return false;
  }
  return true;
}

/** Report a capture failure with the right platform instructions + retry. */
function reportCaptureFailure(error: unknown, constraints: MediaStreamConstraints, retry?: () => void): void {
  reportMediaFailure(error, mediaKindOf(constraints), retry);
}

/**
 * Acquire media with a clear failure mode: if the camera fails but the mic
 * works we continue audio-only instead of dropping the call.
 */
async function acquireMedia(wantVideo: boolean): Promise<{ stream: MediaStream; video: boolean; notice?: string }> {
  if (localStream) return { stream: localStream, video: state.video };
  try {
    const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints(wantVideo));
    localStream = stream;
    void refreshDevices();
    return { stream, video: wantVideo };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (wantVideo) {
      // Fall back to audio only if the camera is missing/busy, but not if the
      // user denied both permissions.
      try {
        const audio = await navigator.mediaDevices.getUserMedia(mediaConstraints(false));
        localStream = audio;
        void refreshDevices();
        return {
          stream: audio,
          video: false,
          notice:
            name === 'NotAllowedError'
              ? 'Camera permission was denied — you joined with audio only.'
              : 'No camera available — you joined with audio only.',
        };
      } catch {
        throw error;
      }
    }
    throw error;
  }
}

function stopTracks(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* already stopped */
    }
  });
}

/** Replace (or remove) a local track on every peer connection. */
async function replaceLocalTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null): Promise<void> {
  if (!localStream) return;
  const existing = kind === 'audio' ? localStream.getAudioTracks()[0] : localStream.getVideoTracks()[0];
  if (existing) {
    existing.stop();
    localStream.removeTrack(existing);
  }
  if (track) localStream.addTrack(track);
  for (const handle of peers.values()) {
    // Keep the sender reference: after replaceTrack(null) the sender no longer
    // has a track, so looking it up by track.kind would fail on the way back.
    const sender = kind === 'video' ? handle.videoSender : handle.audioSender;
    try {
      // No sender yet means this peer has not negotiated yet: adding a track
      // here would create an unassociated transceiver and reintroduce the
      // recvonly-answer bug. The next negotiation creates the sender instead.
      if (sender) await sender.replaceTrack(track);
    } catch {
      /* renegotiation will catch up */
    }
  }
  streamTick += 1;
  setState({ streamTick });
}

/* --------------------------------------------------------------- ICE config */

async function iceServers(forceRefresh = false): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (!forceRefresh && iceServersCache && now - iceServersCache.fetchedAt < iceServersCache.ttlMs) {
    return iceServersCache.servers;
  }
  try {
    const config = await api.iceServers();
    // Refresh a minute before the credentials actually expire.
    const ttlMs = Math.max(60_000, (config.ttlSeconds || 3600) * 1000 - 60_000);
    iceServersCache = { servers: config.iceServers, fetchedAt: now, ttlMs };
    return config.iceServers;
  } catch {
    // Public STUN fallback keeps 1:1 calls working if the API is briefly down.
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}

function serversForPeer(): RTCIceServer[] {
  return iceServersCache?.servers ?? [{ urls: 'stun:stun.l.google.com:19302' }];
}

/* ------------------------------------------------------------------ quality */

/**
 * The other side's negotiated direction per m-line, read from the transceivers.
 * `currentDirection` is OUR direction, so it is inverted to describe the peer:
 * our `sendonly` means the peer answered `recvonly` and never sends to us — the
 * exact one-way-call signature this diagnostics line exists to expose.
 */
function transceiverDirections(pc: RTCPeerConnection): string | null {
  const entries: string[] = [];
  for (const transceiver of pc.getTransceivers()) {
    const kind = transceiver.receiver.track?.kind;
    if (kind !== 'audio' && kind !== 'video') continue;
    const current = transceiver.currentDirection;
    const remote =
      current === 'sendrecv'
        ? 'sendrecv'
        : current === 'sendonly'
          ? 'recvonly'
          : current === 'recvonly'
            ? 'sendonly'
            : current === 'inactive'
              ? 'inactive'
              : 'pending';
    entries.push(`${kind}:${remote}`);
  }
  return entries.length ? entries.join(',') : null;
}

function targetBitrate(peerCount: number): number {
  if (peerCount <= 1) return 1_500_000;
  if (peerCount <= 3) return 700_000;
  if (peerCount <= 5) return 400_000;
  return 250_000;
}

/** Reduce video bitrate/resolution as more people join the mesh. */
async function applyVideoQuality(): Promise<void> {
  if (!state.video) return;
  // A screen share is read from the same video sender as the camera. Never
  // downscale it like a face cam: text must stay readable, so keep full
  // resolution and give it a higher bitrate even in a group call.
  const sharingScreen = state.screenSharing;
  const bitrate = sharingScreen ? 2_500_000 : targetBitrate(peers.size);
  const degradation = sharingScreen ? 1 : peers.size <= 1 ? 1 : peers.size <= 3 ? 2 : 4;
  for (const handle of peers.values()) {
    const sender = handle.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) continue;
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      for (const encoding of params.encodings) {
        encoding.maxBitrate = bitrate;
        encoding.scaleResolutionDownBy = degradation;
      }
      await sender.setParameters(params);
    } catch {
      /* not every browser allows sender parameters */
    }
  }
}

/**
 * Read the real numbers from every peer: ICE/connection state, the selected
 * candidate pair (`host→srflx` = direct, `…→relay` = via TURN), bytes in/out per
 * kind and the state of the remote tracks.
 *
 * "No audio and no video" cannot be diagnosed from a screenshot, so these numbers
 * are also the in-call warning's payload. When nothing has arrived for
 * `MEDIA_STALL_MS` the overlay says so and offers an ICE-restart retry, and the
 * first stall of a call is reported to the admin Inbox (content-free).
 */
async function measureQuality(): Promise<void> {
  const handles = [...peers.values()];
  if (!handles.length) {
    setState({ quality: 'unknown' });
    return;
  }
  let worst: CallQuality = 'good';
  let latencyMs: number | null = null;
  let packetLoss: number | null = null;
  let audioIn = 0;
  let videoIn = 0;
  let audioOut = 0;
  let videoOut = 0;
  let remoteTracks = 0;
  let remoteMuted = 0;
  let receiverCount = 0;
  let missingMediaPeers = 0;
  for (const handle of handles) {
    for (const track of handle.stream.getTracks()) {
      if (track.readyState !== 'live') continue;
      remoteTracks += 1;
      if (track.muted) remoteMuted += 1;
    }
    try {
      receiverCount += handle.pc
        .getReceivers()
        .filter((receiver) => Boolean(receiver.track) && receiver.track.readyState === 'live').length;
    } catch {
      /* the peer may be closing */
    }
    let peerIn = 0;
    let peerOut = 0;
    try {
      const stats = await handle.pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          latencyMs = Math.max(latencyMs ?? 0, Math.round((report.currentRoundTripTime || 0) * 1000));
        }
        if (report.type === 'inbound-rtp') {
          const bytes = Number(report.bytesReceived || 0);
          peerIn += bytes;
          if (report.kind === 'video') {
            videoIn += bytes;
            const received = report.packetsReceived || 0;
            const lost = report.packetsLost || 0;
            if (received + lost > 20) {
              const ratio = lost / (received + lost);
              packetLoss = Math.max(packetLoss ?? 0, Math.round(ratio * 1000) / 10);
              if (ratio > 0.12) worst = 'poor';
              else if (worst !== 'poor' && ratio > 0.04) worst = 'fair';
            }
          } else if (report.kind === 'audio') {
            audioIn += bytes;
          }
        }
        if (report.type === 'outbound-rtp') {
          const bytes = Number(report.bytesSent || 0);
          peerOut += bytes;
          if (report.kind === 'video') videoOut += bytes;
          else if (report.kind === 'audio') audioOut += bytes;
        }
      });
      if ((latencyMs ?? 0) > 400) worst = 'poor';
      else if (worst !== 'poor' && (latencyMs ?? 0) > 220) worst = 'fair';
    } catch {
      /* ignore a peer that just closed */
    }

    // One-way-call detector: ICE/DTLS are connected and we keep sending, but the
    // peer's negotiated receive direction (from our side) is missing, so inbound
    // stays at 0 B. That is an SDP direction problem — an ICE restart cannot fix
    // it; the overlay says who is not sending and Retry renegotiates.
    const connected = handle.pc.connectionState === 'connected';
    if (connected && peerOut > 0 && peerIn === 0) {
      handle.noInboundSince ??= Date.now();
    } else {
      handle.noInboundSince = null;
      handle.missingMediaLogged = false;
    }
    if (handle.noInboundSince !== null && Date.now() - handle.noInboundSince >= MISSING_MEDIA_MS) {
      missingMediaPeers += 1;
      if (!handle.missingMediaLogged) {
        handle.missingMediaLogged = true;
        console.warn(
          `[call] ${handle.info.displayName || handle.info.id.slice(0, 8)} is connected and we send ${peerOut} B but receive 0 B · remote directions ${transceiverDirections(handle.pc) ?? 'unknown'}`,
        );
      }
    }
  }

  // ICE state and the selected candidate pair from the first live peer: the mesh
  // is symmetric, so one sample already tells direct from relayed from nothing.
  let candidatePair: string | null = null;
  let iceConnectionState = 'new';
  let connectionState = 'new';
  const primary = handles[0];
  if (primary) {
    iceConnectionState = primary.pc.iceConnectionState;
    connectionState = primary.pc.connectionState;
    try {
      const stats = await primary.pc.getStats();
      const types = new Map<string, string>();
      let selectedPairId: string | null = null;
      stats.forEach((report) => {
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          types.set(String(report.id), String(report.candidateType || '?'));
        }
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          selectedPairId = String(report.selectedCandidatePairId);
        }
      });
      if (selectedPairId) {
        const pairId = selectedPairId;
        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.id === pairId) {
            const local = types.get(String(report.localCandidateId)) ?? '?';
            const remote = types.get(String(report.remoteCandidateId)) ?? '?';
            candidatePair = `${local}→${remote}`;
          }
        });
      }
    } catch {
      /* stats are advisory; a closed peer must not break the call UI */
    }
  }

  let screenBitrateKbps: number | null = null;
  let screenRttMs: number | null = null;
  let screenLossPct: number | null = null;
  let screenLow = false;
  let screenQuality: CallQuality = 'unknown';
  const remoteSharers = state.participants.filter((participant) => participant.screenSharing);
  const localSharing = state.screenSharing && Boolean(screenStream);
  const screenActive = localSharing || remoteSharers.length > 0;
  if (screenActive) {
    let bytes = 0;
    let packets = 0;
    let lost = 0;
    let rtt: number | null = null;
    const collect = async (pc: RTCPeerConnection): Promise<void> => {
      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = Math.max(rtt ?? 0, Math.round((report.currentRoundTripTime || 0) * 1000));
          }
          if (localSharing) {
            // Sharer: what our screen encoder actually puts on the wire.
            if (report.type === 'outbound-rtp' && report.kind === 'video') bytes += Number(report.bytesSent || 0);
          } else if (report.type === 'inbound-rtp' && report.kind === 'video') {
            // Viewer: the inbound video stream IS the shared screen while sharing.
            bytes += Number(report.bytesReceived || 0);
            packets += Number(report.packetsReceived || 0);
            lost += Number(report.packetsLost || 0);
          }
        });
      } catch {
        /* peer closing */
      }
    };
    if (localSharing) {
      for (const handle of handles) await collect(handle.pc);
    } else {
      for (const sharer of remoteSharers) {
        const handle = peers.get(sharer.id);
        if (handle) await collect(handle.pc);
      }
    }
    const now = Date.now();
    const previous = screenSample;
    if (previous && now - previous.at >= 500) {
      const elapsedSeconds = (now - previous.at) / 1000;
      screenBitrateKbps = Math.max(0, Math.round(((bytes - previous.bytes) * 8) / 1000 / elapsedSeconds));
    }
    screenSample = { at: now, bytes };
    screenRttMs = rtt;
    if (packets + lost > 0) screenLossPct = Math.round((lost / (packets + lost)) * 1000) / 10;
    screenQuality = 'good';
    if (screenBitrateKbps !== null) {
      if (screenBitrateKbps < SCREEN_LOW_KBPS) screenQuality = 'poor';
      else if (screenBitrateKbps < SCREEN_GOOD_KBPS) screenQuality = 'fair';
    }
    if (screenLossPct !== null) {
      if (screenLossPct > 12) screenQuality = 'poor';
      else if (screenQuality !== 'poor' && screenLossPct > 4) screenQuality = 'fair';
    }
    if (screenRttMs !== null) {
      if (screenRttMs > 400) screenQuality = 'poor';
      else if (screenQuality !== 'poor' && screenRttMs > 220) screenQuality = 'fair';
    }
    const lowNow = screenBitrateKbps !== null && screenBitrateKbps < SCREEN_LOW_KBPS;
    if (lowNow) screenLowSince ??= now;
    else {
      screenLowSince = null;
      screenLowNotified = false;
    }
    screenLow = screenLowSince !== null && now - screenLowSince >= SCREEN_LOW_MS;
    if (screenLow && !screenLowNotified) {
      screenLowNotified = true;
      setState({ notice: 'Screen share quality is low — text may look blurry. Retry if it stays blurry.' });
    }
  } else {
    screenSample = null;
    screenLowSince = null;
    screenLowNotified = false;
  }
  // While sharing, the pill and the detail popover follow the SCREEN path only.
  const effectiveQuality: CallQuality = screenActive ? screenQuality : worst;
  const effectiveStats = screenActive
    ? { latencyMs: screenRttMs, packetLoss: screenLossPct }
    : { latencyMs, packetLoss };
  const screenStats: ScreenShareStats = {
    active: screenActive,
    bitrateKbps: screenActive ? screenBitrateKbps : null,
    rttMs: screenActive ? screenRttMs : null,
    lossPct: screenActive ? screenLossPct : null,
    low: screenActive && screenLow,
  };

  const relayConfigured = (iceServersCache?.servers ?? []).some((server) =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => String(url).startsWith('turn')),
  );
  const mediaExpected = state.status === 'active' || state.status === 'connecting';
  if (mediaExpected && !mediaWatchStartedAt) mediaWatchStartedAt = Date.now();
  const waited = mediaWatchStartedAt ? Date.now() - mediaWatchStartedAt : 0;
  const stalledSeconds = Math.round(waited / 1000);
  const remoteDirections =
    [...new Set(handles.map((handle) => transceiverDirections(handle.pc)).filter((value): value is string => Boolean(value)))].join(
      ' | ',
    ) || null;
  const mediaMissing = mediaExpected && missingMediaPeers > 0;
  // The banner appears as soon as a one-way peer is proven (5 s), or later for a
  // plain stall when no peer is sending anything at all.
  const mediaStalled = mediaExpected && (mediaMissing || (waited >= MEDIA_STALL_MS && audioIn + videoIn === 0));
  const diagnostics: CallDiagnostics = {
    iceConnectionState,
    connectionState,
    candidatePair,
    audioIn,
    videoIn,
    audioOut,
    videoOut,
    remoteTracks,
    remoteMuted,
    receiverCount,
    remoteDirections,
    missingMediaPeers,
    relayConfigured,
    stalledSeconds,
    screenActive,
    screenBitrateKbps: screenActive ? screenBitrateKbps : null,
    screenRttMs: screenActive ? screenRttMs : null,
    screenLossPct: screenActive ? screenLossPct : null,
    screenLow: screenActive && screenLow,
    controlLocal: state.controlSupported,
    controlRemote: state.controlHostCapable,
    controlChannel: state.controlChannelReady,
  };
  setState({
    quality: effectiveQuality,
    stats: effectiveStats,
    diagnostics,
    mediaStalled,
    screenQuality: screenActive ? screenQuality : 'unknown',
    screenStats,
  });
  if (mediaStalled && !stallReported) {
    stallReported = true;
    reportStalledCall(diagnostics, stalledSeconds);
  }
  if (effectiveQuality === 'poor' && state.video && !state.lowBandwidth) {
    setState({
      lowBandwidth: true,
      notice: 'Low bandwidth: incoming video was turned off automatically. You can turn it back on from the connection menu.',
    });
  }
}

/**
 * Retry the media path: a FULL renegotiation per peer — rebuild sendrecv
 * directions, re-attach local tracks, refresh ICE and send a new offer. An ICE
 * restart alone cannot repair the one-way state: the transport is connected and
 * the missing half is the SDP receive direction. Wired to the in-call "Retry
 * connection" button.
 */
export function retryCallMedia(): void {
  mediaWatchStartedAt = Date.now();
  stallReported = false;
  setState({ mediaStalled: false, quality: 'unknown', notice: 'Re-negotiating the media path…' });
  for (const handle of peers.values()) {
    handle.noInboundSince = null;
    handle.missingMediaLogged = false;
    void (async () => {
      try {
        await iceServers(Date.now() - (iceServersCache?.fetchedAt ?? 0) > (iceServersCache?.ttlMs ?? 0));
        handle.pc.setConfiguration({ iceServers: serversForPeer() });
        handle.pc.restartIce();
      } catch {
        /* fresh TURN credentials are best effort; the offer still renegotiates */
      }
      await sendOffer(handle);
    })();
  }
}

/**
 * Report a stalled call to the admin Inbox. Content-free by construction: only
 * transport facts (states, candidate types, byte counters) leave the device.
 */
function reportStalledCall(diagnostics: CallDiagnostics, stalledSeconds: number): void {
  const callId = state.callId;
  if (!callId) return;
  void api
    .reportCallQuality({
      callId,
      video: state.video,
      status: state.status,
      iceConnectionState: diagnostics.iceConnectionState,
      connectionState: diagnostics.connectionState,
      candidatePair: diagnostics.candidatePair,
      audioIn: diagnostics.audioIn,
      videoIn: diagnostics.videoIn,
      audioOut: diagnostics.audioOut,
      videoOut: diagnostics.videoOut,
      remoteTracks: diagnostics.remoteTracks,
      remoteMuted: diagnostics.remoteMuted,
      stalledSeconds,
      platform: isAndroidNative() ? 'android' : 'browser',
    })
    .catch(() => undefined);
}

/* -------------------------------------------------------------- peer setup */

function removePeer(peerId: string): void {
  const handle = peers.get(peerId);
  if (!handle) return;
  if (handle.restartTimer) window.clearTimeout(handle.restartTimer);
  try {
    handle.pc.onicecandidate = null;
    handle.pc.ontrack = null;
    handle.pc.onconnectionstatechange = null;
    handle.pc.close();
  } catch {
    /* already closed */
  }
  stopTracks(handle.stream);
  peers.delete(peerId);
  controlCapabilityWarned.delete(peerId);
  refreshControlChannelReady();
  void applyVideoQuality();
}

function clearTimers(): void {
  if (ringTimer) window.clearTimeout(ringTimer);
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  if (statsTimer) window.clearInterval(statsTimer);
  if (endTimer) window.clearTimeout(endTimer);
  ringTimer = null;
  reconnectTimer = null;
  statsTimer = null;
  endTimer = null;
}

function cleanup(): void {
  clearTimers();
  for (const id of [...peers.keys()]) removePeer(id);
  stopTracks(localStream);
  localStream = null;
  stopTracks(screenStream);
  screenStream = null;
  current = null;
  pendingInvite = null;
  streamTick = 0;
  mediaWatchStartedAt = 0;
  stallReported = false;
  // Remote control never survives a call teardown.
  setInjectionActive(false);
  screenSample = null;
  screenLowSince = null;
  screenLowNotified = false;
  controlRateWindow = { at: 0, count: 0 };
  controlCapabilityWarned.clear();
  localControlWarned = false;
  if (state.controlChannelReady || state.controlHostCapable !== null) {
    setState({ controlChannelReady: false, controlHostCapable: null });
  }
}

/**
 * End the call with a specific outcome. Failures, declines and missed calls get
 * their own wording — "Call ended" is only used for a normal end.
 */
function finish(outcome: CallOutcome, message: string, patch: Partial<CallState> = {}): void {
  const durationSeconds = state.startedAt ? Math.max(0, Math.round((Date.now() - state.startedAt) / 1000)) : 0;
  cleanup();
  setState({
    ...IDLE,
    status: 'ended',
    outcome,
    message,
    durationSeconds,
    canRetry: Boolean(lastTarget),
    ...patch,
  });
  endTimer = window.setTimeout(() => setState({ ...IDLE, streamTick: 0 }), 8000);
}

export function dismissCall(): void {
  clearTimers();
  cleanup();
  setState({ ...IDLE });
}

function markActive(): void {
  if (state.status === 'connecting' || state.status === 'calling' || state.status === 'reconnecting') {
    setState({ status: 'active', startedAt: state.startedAt ?? Date.now() });
  }
  if (ringTimer) {
    window.clearTimeout(ringTimer);
    ringTimer = null;
  }
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function startReconnectWindow(): void {
  if (reconnectTimer || !current) return;
  if (state.status === 'incoming' || state.status === 'calling') return;
  setState({ status: 'reconnecting' });
  reconnectTimer = window.setTimeout(() => {
    // A dropped connection is a failed call, never "Call ended" — and the copy
    // says what to check instead of leaving a vague "connection dropped".
    finish(
      'failed',
      state.startedAt
        ? 'Connection lost — the call could not reconnect. Check your network and call again.'
        : 'Failed to connect — check your network and try again.',
    );
  }, RECONNECT_WINDOW_MS);
}

function addParticipant(info: CallParticipant): void {
  if (state.participants.some((p) => p.id === info.id)) return;
  setState({ participants: [...state.participants, info] });
}

async function createPeer(info: CallParticipant): Promise<PeerHandle | null> {
  if (!current || !localStream) return null;
  const existing = peers.get(info.id);
  if (existing) {
    existing.info = info;
    // A peer that already told us they stopped receiving video keeps that state.
    if (info.incomingVideoOff) setPeerVideoDelivery(info.id, false);
    return existing;
  }
  const cap = current.capacity;
  if (peers.size >= cap - 1) {
    setState({ notice: `This call is full (up to ${cap} people).` });
    return null;
  }

  await iceServers();
  const pc = new RTCPeerConnection({ iceServers: serversForPeer(), bundlePolicy: 'max-bundle' });
  const handle: PeerHandle = {
    pc,
    stream: new MediaStream(),
    info,
    polite: myUserId < info.id,
    makingOffer: false,
    ignoreOffer: false,
    pendingCandidates: [],
    restartTimer: null,
    disconnectedAt: null,
    videoSender: null,
    audioSender: null,
    noInboundSince: null,
    missingMediaLogged: false,
    controlChannel: null,
    controlRemoteSeen: false,
  };
  peers.set(info.id, handle);

  // The offerer opens ONE ordered+reliable control channel alongside the media
  // m-lines; the answerer receives it here. Consent is a separate, in-band
  // handshake on that channel (see the control helpers below).
  pc.ondatachannel = (event) => {
    if (event.channel.label !== CONTROL_CHANNEL_LABEL) return;
    handle.controlRemoteSeen = true;
    attachControlChannel(handle, event.channel);
  };

  // Negotiation is ROLE-specific and the ordering is critical:
  //  - the OFFERER creates the explicit audio+video transceivers itself, right
  //    before its offer (see ensureOfferSenders) — one video m-line always, even
  //    without a camera, so an audio-only answer cannot reject it and the camera
  //    can be switched on later;
  //  - the ANSWERER must NOT create transceivers before setRemoteDescription:
  //    Chrome does not associate pre-created transceivers with the offer's
  //    m-lines, it creates fresh recvonly ones instead, the answer then
  //    negotiates recvonly and the caller receives zero bytes forever while the
  //    connection shows "connected" (the one-way call bug). handleOffer applies
  //    the offer first, then attaches our tracks to the offer's transceivers.
  // The sender refs stay null here; whichever role path runs first fills them.

  pc.ontrack = (event) => {
    // With explicit transceivers an incoming track carries no stream id, so
    // fall back to the track itself instead of trusting streams[0].
    const incoming = event.streams[0]?.getTracks() ?? [event.track];
    for (const track of incoming) {
      if (handle.stream.getTracks().some((existing) => existing.id === track.id)) continue;
      // A camera that was switched off leaves an ended track behind; drop it so
      // the tile does not keep a dead video element alive.
      for (const dead of handle.stream.getTracks()) {
        if (dead.kind === track.kind && dead.readyState === 'ended') handle.stream.removeTrack(dead);
      }
      handle.stream.addTrack(track);
    }
    streamTick += 1;
    setState({ streamTick });
    // A live remote track means media is negotiated: the call is genuinely
    // connected, so never keep showing "Calling…"/"Connecting…" while frames flow.
    if (handle.stream.getTracks().some((track) => track.readyState === 'live')) markActive();
  };

  pc.onicecandidate = (event) => {
    if (!event.candidate || !current) return;
    realtime.emit('call:ice', {
      callId: current.callId,
      toUserId: info.id,
      candidate: event.candidate.toJSON(),
    });
  };

  pc.onconnectionstatechange = () => {
    const connection = pc.connectionState;
    if (connection === 'connected') {
      handle.disconnectedAt = null;
      if (handle.restartTimer) {
        window.clearTimeout(handle.restartTimer);
        handle.restartTimer = null;
      }
      markActive();
      void applyVideoQuality();
      return;
    }
    if (connection === 'disconnected') {
      handle.disconnectedAt = Date.now();
      startReconnectWindow();
      // ICE usually recovers on its own within a few seconds (a Wi-Fi ↔ mobile
      // handover, a NAT rebind). Restarting too early tears down a connection
      // that was about to fix itself, so wait 6 s first.
      if (!handle.restartTimer) {
        handle.restartTimer = window.setTimeout(() => {
          handle.restartTimer = null;
          void restartIce(handle);
        }, 6_000);
      }
      return;
    }
    if (connection === 'failed') {
      startReconnectWindow();
      void restartIce(handle);
    }
  };

  return handle;
}

/** ICE restart on one peer. Credentials are refreshed first if they are stale. */
async function restartIce(handle: PeerHandle): Promise<void> {
  if (!current || !handle.pc) return;
  try {
    await iceServers(Date.now() - (iceServersCache?.fetchedAt ?? 0) > (iceServersCache?.ttlMs ?? 0));
    handle.pc.setConfiguration({ iceServers: serversForPeer() });
    handle.pc.restartIce();
    if (!handle.polite) {
      // The impolite side re-offers; the polite side waits and yields.
      await ensureOfferSenders(handle);
      const offer = await handle.pc.createOffer({ iceRestart: true });
      await handle.pc.setLocalDescription(offer);
      realtime.emit('call:offer', {
        callId: current.callId,
        toUserId: handle.info.id,
        sdp: handle.pc.localDescription,
      });
    }
  } catch {
    /* a failed restart leaves the reconnect window to decide */
  }
}

/** The local track for one kind (null when the camera is off or absent). */
function localTrackFor(kind: 'audio' | 'video'): MediaStreamTrack | null {
  return kind === 'audio'
    ? (localStream?.getAudioTracks()[0] ?? null)
    : (localStream?.getVideoTracks()[0] ?? null);
}

/**
 * OFFERER/caller path: create the explicit sendrecv audio+video m-lines and
 * attach our local tracks. Always one video m-line, even with no camera track:
 * it stays sendrecv so an audio-only answer cannot reject it, and the camera can
 * be switched on later by renegotiation. Safe to call again before any
 * renegotiation (it reuses the stored senders).
 */
async function ensureOfferSenders(handle: PeerHandle): Promise<void> {
  const pc = handle.pc;
  const ensure = async (kind: 'audio' | 'video'): Promise<void> => {
    let sender = kind === 'audio' ? handle.audioSender : handle.videoSender;
    if (!sender) {
      try {
        sender = pc.addTransceiver(kind, { direction: 'sendrecv' }).sender;
      } catch {
        return;
      }
      if (kind === 'audio') handle.audioSender = sender;
      else handle.videoSender = sender;
    }
    const transceiver = pc.getTransceivers().find((candidate) => candidate.sender === sender);
    if (transceiver && transceiver.direction !== 'sendrecv') {
      try {
        transceiver.direction = 'sendrecv';
      } catch {
        /* a stopped transceiver cannot change direction */
      }
    }
    // Respect a peer that told us they stopped receiving video.
    const track = kind === 'video' && handle.info.incomingVideoOff ? null : localTrackFor(kind);
    try {
      await sender.replaceTrack(track);
    } catch {
      /* the m-line still negotiates; renegotiation can attach the track later */
    }
  };
  await ensure('audio');
  await ensure('video');
}

/**
 * ANSWERER/callee path, called AFTER setRemoteDescription(offer): attach our
 * tracks to the transceivers the offer created and make them sendrecv. Never
 * call addTransceiver before the offer — that is what made Chrome answer
 * recvonly and broke our receive direction (see the comment in createPeer).
 */
async function attachAnswererSenders(handle: PeerHandle, stopOrphans = false): Promise<void> {
  const pc = handle.pc;
  const chosen = new Set<RTCRtpSender>();
  for (const kind of ['audio', 'video'] as const) {
    // Only transceivers created by the applied offer carry a mid. A transceiver
    // WE created for an offer that lost a glare collision has mid === null: using
    // it for the answer would answer recvonly again, so it is ignored here.
    const associated = pc
      .getTransceivers()
      .filter((candidate) => candidate.receiver.track?.kind === kind && candidate.sender && candidate.mid !== null);
    const known = kind === 'audio' ? handle.audioSender : handle.videoSender;
    const transceiver = (known ? associated.find((candidate) => candidate.sender === known) : undefined) ?? associated[0];
    if (!transceiver) continue;
    chosen.add(transceiver.sender);
    if (transceiver.direction !== 'sendrecv') {
      try {
        transceiver.direction = 'sendrecv';
      } catch {
        /* a stopped transceiver cannot change direction */
      }
    }
    if (kind === 'audio') handle.audioSender = transceiver.sender;
    else handle.videoSender = transceiver.sender;
    const track = kind === 'video' && handle.info.incomingVideoOff ? null : localTrackFor(kind);
    try {
      await transceiver.sender.replaceTrack(track);
    } catch {
      /* the answer still negotiates; the retry path can attach the track later */
    }
  }
  if (!stopOrphans) return;
  // Clean up the transceivers that lost the glare collision. They are not part of
  // the negotiated SDP; leaving them would add duplicate m-lines to our next offer.
  for (const transceiver of pc.getTransceivers()) {
    if (transceiver.mid !== null || chosen.has(transceiver.sender)) continue;
    const stopper = transceiver as RTCRtpTransceiver & { stop?: () => void };
    try {
      stopper.stop?.();
    } catch {
      /* nothing to stop */
    }
  }
}

async function sendOffer(handle: PeerHandle): Promise<void> {
  if (!current) return;
  try {
    handle.makingOffer = true;
    // The offerer owns the m-lines: create them (sendrecv, audio then video) and
    // attach local tracks BEFORE the offer so the answer cannot be audio-only
    // and cannot reject our video section.
    await ensureOfferSenders(handle);
    // One ordered+reliable control channel per peer, created together with the
    // media m-lines (the answerer gets it through pc.ondatachannel).
    if (!handle.controlChannel && !handle.controlRemoteSeen) {
      try {
        attachControlChannel(handle, handle.pc.createDataChannel(CONTROL_CHANNEL_LABEL, { ordered: true }));
      } catch {
        /* data channels unavailable: remote control simply stays off */
      }
    }
    const offer = await handle.pc.createOffer();
    if (handle.pc.signalingState !== 'stable') return;
    await handle.pc.setLocalDescription(offer);
    realtime.emit('call:offer', {
      callId: current.callId,
      toUserId: handle.info.id,
      sdp: handle.pc.localDescription,
    });
  } catch {
    removePeer(handle.info.id);
  } finally {
    handle.makingOffer = false;
  }
}

/* ------------------------------------------------------- remote control */

interface DesktopControlBridge {
  control?: {
    send?: (event: ControlInputMessage) => void | Promise<unknown>;
    setActive?: (active: boolean) => void | Promise<unknown>;
    available?: () => Promise<boolean>;
  };
}

function desktopControlBridge(): NonNullable<DesktopControlBridge['control']> | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { chatgramDesktop?: DesktopControlBridge }).chatgramDesktop;
  return bridge?.control && typeof bridge.control === 'object' ? bridge.control : null;
}

/** Detect whether this shell can inject input (Windows desktop app only). */
export async function syncControlSupport(): Promise<boolean> {
  const bridge = desktopControlBridge();
  if (!bridge?.available) {
    if (state.controlSupported) setState({ controlSupported: false });
    if (state.screenSharing) {
      warnLocalControlUnavailable('this build has no input bridge');
      emitScreenSignal();
    }
    return false;
  }
  let supported = false;
  try {
    supported = (await bridge.available()) === true;
  } catch {
    supported = false;
  }
  setState({ controlSupported: supported });
  if (supported) {
    localControlWarned = false;
  } else if (state.screenSharing) {
    warnLocalControlUnavailable('the native input module failed to load');
  }
  // The viewer needs the capability bit while sharing: advertise it as soon as
  // it is known (the initial share signal may be sent before this resolves).
  if (state.screenSharing) emitScreenSignal();
  return supported;
}

/** One console warning per sharing session explaining why control is off. */
function warnLocalControlUnavailable(reason: string): void {
  if (localControlWarned) return;
  localControlWarned = true;
  console.warn(
    `[call] remote control unavailable locally (${reason}): this client cannot inject OS input, so viewers get a disabled Control button`,
  );
}

/** Advertise the share + whether THIS client can host remote control. */
function emitScreenSignal(): void {
  emitSignal({
    kind: 'screen',
    screenSharing: state.screenSharing,
    sharingKind: 'screen',
    hasSystemAudio: state.screenAudio,
    controlCapable: state.controlSupported,
  });
}

/** Warn once per peer when a sharer cannot host control (browser/Android/old build). */
function noteRemoteControlCapability(participantId: string, displayName: string, capable: boolean | null): void {
  if (capable === true) {
    controlCapabilityWarned.delete(participantId);
    return;
  }
  if (controlCapabilityWarned.has(participantId)) return;
  controlCapabilityWarned.add(participantId);
  const reason =
    capable === false
      ? 'sharer cannot inject OS input (browser/Android client or native module missing)'
      : 'sharer did not advertise control capability (older client)';
  console.warn(`[call] remote control unavailable for ${displayName || participantId.slice(0, 8)}: ${reason}`);
}

/** Keep the viewer's "control channel ready" bit in sync with the peers. */
function refreshControlChannelReady(): void {
  const ready = [...peers.values()].some((handle) => handle.controlChannel?.readyState === 'open');
  if (ready !== state.controlChannelReady) setState({ controlChannelReady: ready });
}

function nameOfPeer(handle: PeerHandle): string {
  return handle.info.displayName || 'Someone';
}

function setInjectionActive(active: boolean): void {
  const bridge = desktopControlBridge();
  try {
    void bridge?.setActive?.(active);
  } catch {
    /* the bridge is best effort */
  }
}

function sendControlMessage(handle: PeerHandle, message: ControlMessage): boolean {
  const channel = handle.controlChannel;
  if (!channel || channel.readyState !== 'open') return false;
  try {
    channel.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function broadcastControlMessage(message: ControlMessage): void {
  for (const handle of peers.values()) sendControlMessage(handle, message);
}

function controlKeyAllowed(key: string): boolean {
  if (key.length === 1) {
    const code = key.charCodeAt(0);
    return code >= 32 && code <= 126;
  }
  return CONTROL_KEY_NAMES.has(key);
}

const unitRange = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** Validate an untrusted data-channel payload into a typed control event. */
function parseControlInput(raw: unknown): ControlInputMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.t === 'm') {
    return unitRange(value.x) && unitRange(value.y) ? { t: 'm', x: value.x, y: value.y } : null;
  }
  if (value.t === 'w') {
    if (!unitRange(value.x) || !unitRange(value.y) || typeof value.dy !== 'number' || !Number.isFinite(value.dy)) return null;
    return { t: 'w', x: value.x, y: value.y, dy: Math.max(-10, Math.min(10, value.dy)) };
  }
  if (value.t === 'c') {
    const button = value.button === 0 || value.button === 1 || value.button === 2 ? value.button : null;
    if (button === null || !unitRange(value.x) || !unitRange(value.y) || typeof value.down !== 'boolean') return null;
    return { t: 'c', x: value.x, y: value.y, button, down: value.down };
  }
  if (value.t === 'k') {
    if (typeof value.key !== 'string' || typeof value.down !== 'boolean') return null;
    if (!controlKeyAllowed(value.key)) return null;
    return { t: 'k', key: value.key, down: value.down };
  }
  return null;
}

/** Sharer: hand one validated input event to the Electron injection bridge. */
function injectControlInput(input: ControlInputMessage): void {
  const bridge = desktopControlBridge();
  if (!bridge?.send) return;
  try {
    void bridge.send(input);
  } catch {
    /* injection must never break the call */
  }
}

function dropControlViewer(notice?: string): void {
  const viewerId = state.controlViewerId;
  if (viewerId) {
    const viewer = peers.get(viewerId);
    if (viewer) sendControlMessage(viewer, { t: 'revoke' });
  }
  setInjectionActive(false);
  setState({
    controlViewerId: null,
    controlPendingId: null,
    ...(notice ? { notice } : {}),
  });
}

/** Clear every control role; used by stop-share, disconnect and call end. */
export function resetRemoteControl(notice?: string): void {
  if (state.controlViewerId || state.controlAllowed || state.controlPendingId) {
    dropControlViewer();
    setState({ controlAllowed: false });
    broadcastControlMessage({ t: 'allow', on: false });
  }
  if (state.controlStatus !== 'idle' || state.controlPeerId || state.controlAvailable) {
    setState({ controlStatus: 'idle', controlPeerId: null, controlAvailable: false, controlMessage: notice ?? null });
  }
}

function announceControlConsent(): void {
  broadcastControlMessage({
    t: 'allow',
    on: state.controlAllowed && state.controlSupported && state.screenSharing,
    capable: state.controlSupported,
  });
}

function handleControlRequest(handle: PeerHandle): void {
  if (!state.screenSharing || !state.controlAllowed || !state.controlSupported) return;
  if (state.controlViewerId || state.controlPendingId) {
    sendControlMessage(handle, { t: 'deny' });
    return;
  }
  setState({
    controlPendingId: handle.info.id,
    notice: `${nameOfPeer(handle)} wants to control your screen.`,
  });
}

function handleControlRelease(handle: PeerHandle): void {
  if (state.controlViewerId !== handle.info.id) return;
  setInjectionActive(false);
  setState({ controlViewerId: null, controlPendingId: null, notice: `${nameOfPeer(handle)} released control.` });
}

function handleViewerControlMessage(handle: PeerHandle, message: Record<string, unknown>): void {
  const sharer = state.participants.find((participant) => participant.id === handle.info.id);
  if (message.t === 'allow') {
    const allowed = message.on === true && sharer?.screenSharing === true && !state.screenSharing;
    const capable = typeof message.capable === 'boolean' ? message.capable : state.controlHostCapable;
    setState({ controlAvailable: allowed, controlHostCapable: capable });
    if (capable !== null) noteRemoteControlCapability(handle.info.id, nameOfPeer(handle), capable);
    if (!allowed && state.controlStatus !== 'idle') {
      setState({ controlStatus: 'idle', controlPeerId: null, controlMessage: 'The other person stopped allowing remote control.' });
    }
    // The viewer asked while consent was off: once the owner allows it, send the
    // request again so the owner actually gets the approval prompt.
    if (allowed && state.controlStatus === 'requested' && state.controlPeerId === handle.info.id) {
      sendControlMessage(handle, { t: 'request' });
    }
    return;
  }
  if (message.t === 'accept') {
    if (state.controlStatus === 'requested' && state.controlPeerId === handle.info.id) {
      setState({
        controlStatus: 'active',
        notice: `You are controlling ${nameOfPeer(handle)}'s screen. Press Escape to release.`,
      });
    }
    return;
  }
  if (message.t === 'deny' || message.t === 'revoke') {
    if (state.controlPeerId !== null && state.controlPeerId !== handle.info.id) return;
    setState({
      controlStatus: 'idle',
      controlPeerId: null,
      controlMessage: message.t === 'deny' ? 'The other person declined remote control.' : 'Remote control ended.',
    });
  }
}

function handleControlMessage(handle: PeerHandle, raw: unknown): void {
  if (typeof raw !== 'string' || raw.length > 2048) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  const message = parsed as Record<string, unknown>;
  // Host (sharer) side: requests and input from the approved viewer.
  if (state.screenSharing) {
    if (message.t === 'request') {
      handleControlRequest(handle);
      return;
    }
    if (message.t === 'release') {
      handleControlRelease(handle);
      return;
    }
    const input = parseControlInput(message);
    if (input) {
      // Defence in depth: the channel, the consent flag and the single approved
      // viewer must all agree, and the host rate limit must not be exceeded.
      if (state.controlAllowed && state.controlSupported && state.controlViewerId === handle.info.id && allowHostControlEvent()) {
        injectControlInput(input);
      }
      return;
    }
  }
  handleViewerControlMessage(handle, message);
}

function attachControlChannel(handle: PeerHandle, channel: RTCDataChannel): void {
  handle.controlChannel = channel;
  channel.onopen = () => {
    refreshControlChannelReady();
    // Only the sharer announces consent; the viewer has nothing to allow.
    if (state.screenSharing) announceControlConsent();
  };
  channel.onclose = () => {
    if (handle.controlChannel === channel) handle.controlChannel = null;
    refreshControlChannelReady();
    if (state.controlViewerId === handle.info.id) dropControlViewer('The viewer disconnected.');
    if (state.controlPeerId === handle.info.id) {
      setState({ controlStatus: 'idle', controlPeerId: null, controlAvailable: false, controlMessage: 'The connection closed.' });
    }
  };
  channel.onmessage = (event) => handleControlMessage(handle, event.data);
}

/** Sharer: explicit per-session consent for remote control of my share. */
export function setRemoteControlAllowed(allowed: boolean): void {
  if (!state.screenSharing) return;
  const next = allowed === true && state.controlSupported;
  if (next === state.controlAllowed) return;
  if (!next) {
    dropControlViewer();
    setState({ controlAllowed: false, controlMessage: null });
    announceControlConsent();
    setState({ notice: 'Remote control is off.' });
    return;
  }
  setState({ controlAllowed: true, controlMessage: null });
  announceControlConsent();
  setState({ notice: 'Remote control is on. The other person can ask to control this screen.' });
}

/** Sharer: accept or deny the pending viewer request (one viewer at a time). */
export function respondRemoteControlRequest(accept: boolean): void {
  const viewerId = state.controlPendingId;
  if (!viewerId) return;
  const viewer = peers.get(viewerId);
  setState({ controlPendingId: null });
  if (!viewer) return;
  if (!accept || !state.screenSharing || !state.controlAllowed || !state.controlSupported) {
    sendControlMessage(viewer, { t: 'deny' });
    return;
  }
  setState({ controlViewerId: viewerId, notice: `${nameOfPeer(viewer)} is controlling your screen.` });
  sendControlMessage(viewer, { t: 'accept' });
  setInjectionActive(true);
}

/** Sharer: stop the active controller right now (also used by Stop sharing). */
export function revokeRemoteControl(): void {
  dropControlViewer('Remote control stopped.');
}

/** Viewer: ask the remote sharer for control (only when their consent is on). */
export function requestRemoteControl(): void {
  if (state.screenSharing || state.controlStatus === 'requested' || state.controlStatus === 'active') return;
  const sharer = state.participants.find((participant) => participant.screenSharing);
  if (!sharer) return;
  const handle = peers.get(sharer.id);
  if (!handle) return;
  if (!sendControlMessage(handle, { t: 'request' })) {
    setState({ controlMessage: 'Remote control is not available (no control channel).' });
    return;
  }
  setState({
    controlStatus: 'requested',
    controlPeerId: sharer.id,
    controlMessage: state.controlAvailable ? null : 'Waiting for the share owner to allow control',
    notice: state.controlAvailable
      ? 'Control request sent. Waiting for approval…'
      : 'Waiting for the share owner to allow control…',
  });
}

/** Viewer: release control (Escape or the Release control button). */
export function releaseRemoteControl(): void {
  const peerId = state.controlPeerId;
  if (peerId) {
    const handle = peers.get(peerId);
    if (handle) sendControlMessage(handle, { t: 'release' });
  }
  setInjectionActive(false);
  setState({ controlStatus: 'idle', controlPeerId: null, controlMessage: null });
}

/** Viewer: send one validated input event to the sharer's control channel. */
export function sendRemoteControlInput(input: ControlInputMessage): void {
  if (state.controlStatus !== 'active' || !state.controlPeerId) return;
  const handle = peers.get(state.controlPeerId);
  if (!handle) return;
  sendControlMessage(handle, input);
}

function armRingTimeout(): void {
  if (ringTimer) window.clearTimeout(ringTimer);
  ringTimer = window.setTimeout(() => {
    ringTimer = null;
    if (state.status === 'calling') {
      const callId = state.callId;
      if (callId) realtime.emit('call:end', { callId, reason: 'missed' });
      finish('missed', 'No answer.');
    } else if (state.status === 'incoming') {
      const callId = state.callId;
      if (callId) realtime.emit('call:decline', { callId });
      finish('missed', 'Missed call.');
    }
  }, RING_TIMEOUT_MS);
}

function startStatsLoop(): void {
  if (statsTimer) window.clearInterval(statsTimer);
  statsTimer = window.setInterval(() => void measureQuality(), STATS_INTERVAL_MS);
}

/* ------------------------------------------------------------- outcomes */

const OUTCOME_MESSAGES: Record<CallOutcome, string> = {
  declined: 'Call declined',
  missed: 'No answer',
  busy: 'Busy — they are on another call',
  failed: 'Failed to connect',
  ended: 'Call ended',
  cancelled: 'Call cancelled',
  'answered-elsewhere': 'Answered on another device',
  unavailable: 'Nobody available',
};

/** Sentence-case heading for an outcome (never "Call ended" for a failure). */
export function outcomeLabel(outcome: CallOutcome | null): string {
  return outcome ? OUTCOME_MESSAGES[outcome] : 'Call ended';
}

/** A normal end appends the duration; every other outcome keeps its own words. */
export function outcomeText(call: CallState): string {
  if (call.outcome === 'ended') {
    return call.durationSeconds > 0 ? `${OUTCOME_MESSAGES.ended} · ${clockForCall(call.durationSeconds)}` : OUTCOME_MESSAGES.ended;
  }
  return call.message || outcomeLabel(call.outcome);
}

export function clockForCall(totalSeconds: number): string {
  const elapsed = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Retry the last call from the ended screen. A failure is never a dead end.
 */
export function retryCall(): void {
  if (!lastTarget) return;
  const target = { ...lastTarget };
  const video = lastVideo;
  dismissCall();
  void startCall(target, { video });
}

/** Session bookkeeping shared by a fresh call and a late join. */
function enterSession(session: ActiveCall, extra: Partial<CallState> = {}): void {
  current = session;
  setState({
    ...IDLE,
    status: 'connecting',
    callId: session.callId,
    chatId: session.chatId,
    title: session.title,
    video: session.video,
    isGroup: session.isGroup,
    capacity: session.capacity,
    cameraOn: session.video,
    audioOnly: !session.video,
    ...extra,
  });
  startStatsLoop();
  // Remote-control injection is only available inside the Windows desktop shell.
  void syncControlSupport();
}

/* ---------------------------------------------------------------- lifecycle */

export async function startCall(
  target: { chatId: string; title: string; isGroup: boolean; participantCount?: number },
  options: { video?: boolean } = {},
): Promise<void> {
  if (state.status !== 'idle' && state.status !== 'ended') return;

  lastTarget = { ...target };
  lastVideo = options.video === true;

  // Honest caps before we even ring: a group video call above 6 people starts
  // as audio-only rather than failing later.
  let wantVideo = options.video === true;
  let capacity = wantVideo ? MAX_VIDEO_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS;
  let notice: string | undefined;
  if (wantVideo && target.isGroup && (target.participantCount ?? 0) > MAX_VIDEO_PARTICIPANTS) {
    wantVideo = false;
    capacity = MAX_AUDIO_PARTICIPANTS;
    notice = `This group has more than ${MAX_VIDEO_PARTICIPANTS} people, so the call starts with audio only.`;
  }

  let media;
  try {
    if (!(await mediaPreflight(wantVideo ? 'camera+microphone' : 'microphone', () => void startCall(target, options)))) {
      return;
    }
    media = await acquireMedia(wantVideo);
  } catch (error) {
    // No half-started call: the dialog explains what to fix and its "Try again"
    // runs startCall() again from a real tap.
    setState({ ...IDLE });
    reportCaptureFailure(error, mediaConstraints(wantVideo), () => void startCall(target, options));
    return;
  }

  const callId = newCallId();
  enterSession(
    {
      callId,
      chatId: target.chatId,
      video: media.video,
      isGroup: target.isGroup,
      title: target.title,
      capacity,
    },
    {
      status: 'calling',
      cameraOn: media.video,
      audioOnly: !media.video,
      notice: media.notice ?? notice,
    },
  );
  armRingTimeout();
  realtime.emit('call:start', { callId, chatId: target.chatId, video: media.video });
}

/**
 * Join a room that is already running (banner / call card "Join", or a member
 * who declined earlier). The server answers with call:joined + the peers to
 * connect to, exactly like accepting a ring.
 */
export async function joinActiveCall(room: CallRoom): Promise<void> {
  if (state.status !== 'idle' && state.status !== 'ended') return;
  if (!room.callId) return;
  lastTarget = { chatId: room.chatId, title: room.title, isGroup: true };
  lastVideo = room.video;
  const wantVideo = room.video && room.participantCount < MAX_VIDEO_PARTICIPANTS;
  let media;
  try {
    if (
      !(await mediaPreflight(wantVideo ? 'camera+microphone' : 'microphone', () => void joinActiveCall(room)))
    ) {
      return;
    }
    media = await acquireMedia(wantVideo);
  } catch (error) {
    setState({ ...IDLE });
    reportCaptureFailure(error, mediaConstraints(wantVideo), () => void joinActiveCall(room));
    return;
  }
  enterSession(
    {
      callId: room.callId,
      chatId: room.chatId,
      video: media.video,
      isGroup: true,
      title: room.title,
      // The mesh video cap is the camera slot count; an audio-only room caps at 12.
      capacity: room.video ? room.videoCapacity || MAX_VIDEO_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS,
    },
    {
      participants: room.participants.filter((participant) => participant.id !== myUserId),
      startedAt: room.startedAt,
      cameraOn: media.video,
      audioOnly: !media.video,
      notice: media.notice,
    },
  );
  realtime.emit('call:join', { callId: room.callId, chatId: room.chatId, audioOnly: !media.video });
}

/** Join whatever room is live in this chat, if any. */
export function joinRoomForChat(chatId: string): void {
  const room = getCallRoom(chatId);
  if (room && canJoinRoom(room)) void joinActiveCall(room);
}

/** Ask the server for the live room of a chat (e.g. right after opening it). */
export function requestRoomState(chatId: string): void {
  if (!chatId) return;
  realtime.emit('call:state:get', { chatId });
}

/** Somebody is ringing me. Auto-declines when I am already in a call. */
export function handleIncoming(payload: {
  callId: string;
  chatId: string;
  video: boolean;
  isGroup: boolean;
  title: string;
  capacity?: number;
  participantCount?: number;
  from: CallParticipant;
  participants?: CallParticipant[];
  startedAt?: number | string | null;
  cardMessageId?: string | null;
}): void {
  if (state.status !== 'idle' && state.status !== 'ended') {
    realtime.emit('call:decline', { callId: payload.callId });
    return;
  }
  const capacity = payload.capacity ?? (payload.video ? MAX_VIDEO_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS);
  // Never offer camera in a group call that is already past the video cap.
  const video = payload.video && (payload.isGroup ? capacity > MAX_VIDEO_PARTICIPANTS - 1 : true);
  const from = normalizeParticipant(payload.from);
  const others = Array.isArray(payload.participants)
    ? payload.participants.map(normalizeParticipant).filter((participant) => participant.id && participant.id !== myUserId)
    : [];
  // The caller is always first: the incoming screen treats participants[0] as
  // the person who is calling (see CallOverlay), even when the snapshot already
  // lists them somewhere else in the roster.
  const participants = [from, ...others.filter((participant) => participant.id !== from.id)];
  pendingInvite = {
    callId: payload.callId,
    chatId: payload.chatId,
    video,
    isGroup: payload.isGroup === true,
    title: payload.title || from.displayName || 'Call',
    capacity,
    from,
  };
  setState({
    ...IDLE,
    status: 'incoming',
    callId: payload.callId,
    chatId: payload.chatId,
    title: pendingInvite.title,
    video,
    isGroup: pendingInvite.isGroup,
    capacity,
    participants,
    ringCount: payload.participantCount ?? participants.length + 1,
    cameraOn: false,
  });
  armRingTimeout();
}

export async function acceptCall(options: { audioOnly?: boolean } = {}): Promise<void> {
  if (!pendingInvite) return;
  const invite = pendingInvite;
  const wantVideo = invite.video && !options.audioOnly;
  const retry = () => void acceptCall(options);
  let media;
  try {
    if (!(await mediaPreflight(wantVideo ? 'camera+microphone' : 'microphone', retry))) return;
    media = await acquireMedia(wantVideo);
  } catch (error) {
    // Keep ringing: declining here would silently lose the call. The retry
    // button answers it once the permission is granted.
    reportCaptureFailure(error, mediaConstraints(wantVideo), retry);
    return;
  }
  pendingInvite = null;
  enterSession(
    {
      callId: invite.callId,
      chatId: invite.chatId,
      video: media.video,
      isGroup: invite.isGroup,
      title: invite.title,
      capacity: invite.capacity,
    },
    {
      participants: state.participants.filter((participant) => participant.id !== myUserId),
      cameraOn: media.video,
      audioOnly: !media.video,
      notice: media.notice,
    },
  );
  realtime.emit('call:accept', { callId: invite.callId, audioOnly: !media.video });
}

/* --------------------------------------------------------- signalling paths */

export function handleJoined(payload: {
  callId: string;
  participants?: CallParticipant[];
  startedAt?: number | string | null;
  capacity?: number;
}): void {
  if (!current || current.callId !== payload.callId) return;
  const others = (payload.participants ?? [])
    .map(normalizeParticipant)
    .filter((participant) => participant.id && participant.id !== myUserId);
  const startedAt = toEpoch(payload.startedAt);
  setState({
    status: others.length ? 'connecting' : 'active',
    participants: others,
    startedAt: startedAt ?? (others.length ? null : Date.now()),
    capacity: payload.capacity ?? state.capacity,
  });
  for (const participant of others) {
    void createPeer(participant).then((handle) => {
      if (!handle) return null;
      void sendOffer(handle);
      emitMySignalsTo(participant.id);
      return handle;
    });
  }
  if (!others.length) markActive();
  void applyVideoQuality();
}

export function handleParticipantJoined(payload: {
  callId: string;
  participant: CallParticipant;
  participants?: CallParticipant[];
}): void {
  if (!current || current.callId !== payload.callId || !payload.participant?.id) return;
  const participant = normalizeParticipant(payload.participant);
  if (Array.isArray(payload.participants)) {
    const list = payload.participants.map(normalizeParticipant).filter((p) => p.id && p.id !== myUserId);
    setState({ participants: list });
  } else {
    addParticipant(participant);
  }
  // The newcomer needs to know our mute/camera/screen state before any frames.
  emitMySignalsTo(participant.id);
  // "X joined the call" must never sit next to a stale "Calling…": once somebody
  // is in the room we are at least connecting, and when their peer connection is
  // already up (or tracks are live) the call is really active.
  const patch: Partial<CallState> = { notice: `${participant.displayName || 'Someone'} joined the call.` };
  if (state.status === 'calling') patch.status = 'connecting';
  setState(patch);
  const joinedHandle = peers.get(participant.id);
  if (joinedHandle) {
    const peerConnected = joinedHandle.pc.connectionState === 'connected';
    const mediaLive = joinedHandle.stream.getTracks().some((track) => track.readyState === 'live');
    if (peerConnected || mediaLive) markActive();
  }
  void applyVideoQuality();
}

/** The server asked us to ring one more person after 1:1 → group conversion. */
export function handleParticipantInvited(payload: {
  callId?: string;
  participant: CallParticipant;
  participants?: CallParticipant[];
}): void {
  if (payload.callId && current && current.callId !== payload.callId) return;
  if (current) {
    current.isGroup = true;
    current.capacity = state.video ? MAX_VIDEO_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS;
  }
  const participant = normalizeParticipant(payload.participant);
  setState({
    isGroup: true,
    capacity: current?.capacity ?? state.capacity,
    participants: Array.isArray(payload.participants)
      ? payload.participants.map(normalizeParticipant).filter((p) => p.id && p.id !== myUserId)
      : state.participants,
    notice: `${participant.displayName || 'Someone'} was invited to the call.`,
  });
}

export function handleParticipantLeft(payload: {
  callId: string;
  userId: string;
  reason?: string;
  participants?: CallParticipant[];
}): void {
  if (!current || current.callId !== payload.callId) return;
  const who = state.participants.find((p) => p.id === payload.userId);
  removePeer(payload.userId);
  if (state.controlViewerId === payload.userId) dropControlViewer('The viewer left the call.');
  if (state.controlPeerId === payload.userId) {
    setState({ controlStatus: 'idle', controlPeerId: null, controlAvailable: false, controlMessage: 'The other person left the call.' });
  }
  const participants = Array.isArray(payload.participants)
    ? payload.participants.map(normalizeParticipant).filter((p) => p.id !== myUserId)
    : state.participants.filter((p) => p.id !== payload.userId);
  streamTick += 1;
  if (participants.length === 0) {
    // Nobody else is left. The server ends the room when the last participant
    // leaves, so this client must send its own call:end (otherwise the room
    // would stay "live" for the chat and block everyone from calling again).
    const outcome: CallOutcome =
      payload.reason === 'declined'
        ? 'declined'
        : payload.reason === 'failed'
          ? 'failed'
          : payload.reason === 'missed'
            ? 'missed'
            : 'ended';
    const callId = state.callId;
    if (callId) {
      realtime.emit('call:end', {
        callId,
        reason: outcome === 'declined' ? 'declined' : outcome === 'failed' ? 'failed' : 'hangup',
      });
    }
    finish(outcome, OUTCOME_MESSAGES[outcome]);
    return;
  }
  setState({
    participants,
    streamTick,
    notice: who?.displayName ? `${who.displayName} left the call.` : undefined,
  });
  void applyVideoQuality();
}

export function handleParticipantDeclined(payload: {
  userId: string;
  isGroup: boolean;
  participants?: CallParticipant[];
}): void {
  if (!payload.isGroup) {
    finish('declined', OUTCOME_MESSAGES.declined);
    return;
  }
  const participants = Array.isArray(payload.participants)
    ? payload.participants.map(normalizeParticipant).filter((p) => p.id !== myUserId)
    : state.participants;
  setState({ participants, notice: 'Someone declined the call.' });
}

export function rejectCall(): void {
  const callId = state.callId;
  if (callId) realtime.emit('call:decline', { callId });
  finish('declined', OUTCOME_MESSAGES.declined);
}

export function hangUp(): void {
  const callId = state.callId;
  // A call cancelled before anyone answered is "Cancelled", not "Ended".
  const neverConnected = state.status === 'calling' && !state.startedAt;
  if (callId) realtime.emit('call:end', { callId, reason: neverConnected ? 'cancel' : 'hangup' });
  finish(neverConnected ? 'cancelled' : 'ended', neverConnected ? OUTCOME_MESSAGES.cancelled : OUTCOME_MESSAGES.ended);
}

/** Accept a call that arrived on another tab? No — that tab answered. */
export function handleAnsweredElsewhere(payload: { callId: string }): void {
  if (!state.callId || state.callId !== payload.callId) return;
  if (state.status !== 'incoming') return;
  finish('answered-elsewhere', OUTCOME_MESSAGES['answered-elsewhere']);
}

export function handleBusy(payload: { message?: string }): void {
  finish('busy', payload?.message || OUTCOME_MESSAGES.busy);
}

export async function handleOffer(payload: {
  callId: string;
  from: CallParticipant;
  sdp: unknown;
}): Promise<void> {
  if (!current || current.callId !== payload.callId || !payload.from?.id) return;
  const handle = await createPeer(payload.from);
  if (!handle) return;

  const pc = handle.pc;
  const description = payload.sdp as RTCSessionDescriptionInit;
  const offerCollision = description.type === 'offer' && (handle.makingOffer || pc.signalingState !== 'stable');
  handle.ignoreOffer = !handle.polite && offerCollision;
  if (handle.ignoreOffer) return;

  try {
    if (offerCollision) {
      // Polite side rolls back its own offer and accepts theirs.
      await Promise.all([
        pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit).catch(() => undefined),
        pc.setRemoteDescription(description),
      ]);
    } else {
      await pc.setRemoteDescription(description);
    }
    // Candidates that arrived before the remote description are applied now.
    for (const candidate of handle.pendingCandidates.splice(0)) {
      await pc.addIceCandidate(candidate).catch(() => undefined);
    }
    // Attach our media to the m-lines the offer created, BEFORE createAnswer.
    // Doing this after setRemoteDescription is what keeps the answer sendrecv
    // instead of the recvonly answer that silently broke the caller's receive
    // direction (connected, sending, 0 B received, ontrack never fired).
    await attachAnswererSenders(handle, offerCollision);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    realtime.emit('call:answer', {
      callId: current.callId,
      toUserId: payload.from.id,
      sdp: pc.localDescription,
    });
    addParticipant(payload.from);
    void applyVideoQuality();
  } catch {
    removePeer(payload.from.id);
  }
}

function applySignal(signal: CallSignal, from: CallParticipant): void {
  if (!current) return;
  const source = normalizeParticipant(from);
  const participant = state.participants.find((p) => p.id === source.id) ?? source;
  const name = participant.displayName || 'The other person';
  if (!state.participants.some((p) => p.id === source.id)) addParticipant(source);
  const patchParticipant = (patch: Partial<CallParticipant>) =>
    setState({
      participants: state.participants.map((p) => (p.id === source.id ? { ...p, ...patch } : p)),
    });
  if (signal.kind === 'muted') {
    patchParticipant({ muted: Boolean(signal.muted) });
    if (signal.muted) setState({ notice: `${name} is muted.` });
  } else if (signal.kind === 'camera') {
    const cameraOn = signal.cameraOn !== false;
    patchParticipant({ cameraOn, videoOff: !cameraOn });
    if (!cameraOn) setState({ notice: `${name} turned their camera off.` });
  } else if (signal.kind === 'screen') {
    const screenSharing = signal.screenSharing === true;
    const controlCapable = typeof signal.controlCapable === 'boolean' ? signal.controlCapable : null;
    patchParticipant({
      screenSharing,
      sharingKind: signal.sharingKind ?? 'screen',
      hasSystemAudio: signal.hasSystemAudio === true,
      ...(controlCapable === null ? {} : { controlCapable }),
    });
    if (screenSharing) {
      // The sharer advertises whether their client can host control; the viewer
      // UI needs this to tell "cannot host" apart from "has not allowed yet".
      setState({ controlHostCapable: controlCapable });
      noteRemoteControlCapability(source.id, name, controlCapable);
      // Defensive: a local share flag with no screen stream behind it is stale
      // (a stop that never completed). Clear it so the UI cannot show "You are
      // sharing" and stale local screen frames while a REMOTE share is running.
      if (state.screenSharing && !screenStream) {
        setState({ screenSharing: false, screenAudio: false });
      }
      // A share is video content and must be visible even in a call this device
      // joined audio-only: the video m-line is always negotiated, so switch the
      // stage to video mode instead of silently showing nothing.
      if (!state.video || state.audioOnly) setState({ video: true, audioOnly: false });
      // A share must never be silently swallowed by the data-saving switches: if
      // local incoming video was off, re-enable it (and say so) so the shared
      // screen is actually visible instead of showing nothing.
      const wasSuppressed = state.incomingVideoOff;
      if (wasSuppressed) {
        for (const track of peers.get(source.id)?.stream.getVideoTracks() ?? []) track.enabled = true;
        setState({ incomingVideoOff: false, lowBandwidth: false });
      }
      setState({
        notice: `${name} is sharing their screen${signal.hasSystemAudio ? ' with system audio' : ''}.${
          wasSuppressed ? ' Incoming video was turned back on to show it.' : ''
        }`,
      });
    } else {
      // The remote share stopped: any control role towards it ends immediately.
      if (state.controlPeerId === source.id) {
        setState({ controlStatus: 'idle', controlPeerId: null, controlMessage: 'The other person stopped sharing.' });
      }
      setState({
        controlAvailable: false,
        screenQuality: 'unknown',
        screenStats: { active: false, bitrateKbps: null, rttMs: null, lossPct: null, low: false },
      });
    }
  } else if (signal.kind === 'incoming-video-off') {
    const off = signal.off === true;
    patchParticipant({ incomingVideoOff: off });
    // They stopped receiving our video: really stop sending them frames.
    setPeerVideoDelivery(source.id, !off);
    setState({ notice: off ? `${name} turned off incoming video.` : `${name} turned incoming video back on.` });
  } else if (signal.kind === 'video-request') {
    setState({ videoRequest: { ...participant } });
  } else if (signal.kind === 'video-accepted') {
    setState({ notice: 'The other person accepted video.' });
    if (state.videoUpgradePending) void becomeVideo();
  } else if (signal.kind === 'video-declined') {
    setState({ videoUpgradePending: false, notice: 'The other person declined video.' });
  }
}

/** The server relays per-participant media state (call:participant-state). */
export function handleParticipantState(payload: { callId?: string; participant: CallParticipant }): void {
  if (!current) return;
  if (payload.callId && payload.callId !== current.callId) return;
  if (!payload.participant?.id) return;
  const incoming = payload.participant;
  const patch: Partial<CallParticipant> = {
    muted: incoming.muted === true,
    cameraOn: incoming.cameraOn !== false,
    screenSharing: incoming.screenSharing === true,
    sharingKind: incoming.sharingKind,
    hasSystemAudio: incoming.hasSystemAudio === true,
    incomingVideoOff: incoming.incomingVideoOff === true,
    ...(typeof incoming.controlCapable === 'boolean' ? { controlCapable: incoming.controlCapable } : {}),
  };
  const existing = state.participants.find((p) => p.id === incoming.id);
  if (!existing) {
    addParticipant(normalizeParticipant(incoming));
    if (patch.incomingVideoOff) setPeerVideoDelivery(incoming.id, false);
    return;
  }
  setState({
    participants: state.participants.map((p) => (p.id === incoming.id ? { ...p, ...patch } : p)),
  });
  if (patch.incomingVideoOff) setPeerVideoDelivery(incoming.id, false);
  if (patch.screenSharing && typeof incoming.controlCapable === 'boolean') {
    setState({ controlHostCapable: incoming.controlCapable });
    noteRemoteControlCapability(incoming.id, incoming.displayName ?? '', incoming.controlCapable);
  }
}

export async function handleAnswer(payload: {
  callId: string;
  from: CallParticipant;
  sdp: unknown;
}): Promise<void> {
  const handle = payload.from?.id ? peers.get(payload.from.id) : undefined;
  if (!handle || !current || current.callId !== payload.callId) return;
  try {
    await handle.pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
    for (const candidate of handle.pendingCandidates.splice(0)) {
      await handle.pc.addIceCandidate(candidate).catch(() => undefined);
    }
  } catch {
    failCall('Failed to connect — the media negotiation failed.');
  }
}

/** In-call state signal relayed by the server (call:signal). */
export function handleCallSignal(payload: {
  callId: string;
  from?: CallParticipant;
  signal?: CallSignal | { kind: string };
}): void {
  if (!current || current.callId !== payload.callId || !payload.from?.id || !payload.signal) return;
  applySignal(payload.signal as CallSignal, payload.from);
}

/** ICE/DTLS failure is a failed call, never "Call ended". */
function failCall(message: string): void {
  const callId = state.callId;
  if (callId) realtime.emit('call:failed', { callId, reason: 'ice' });
  finish('failed', message);
}

export async function handleIce(payload: {
  callId: string;
  from?: CallParticipant;
  candidate: unknown;
  signal?: CallSignal | { kind: string };
}): Promise<void> {
  if (!current || current.callId !== payload.callId) return;
  if (payload.signal && payload.from?.id) {
    applySignal(payload.signal as CallSignal, payload.from);
    return;
  }
  if (!payload.candidate) return;
  const handle = payload.from?.id ? peers.get(payload.from.id) : undefined;
  if (!handle) return;
  const candidate = payload.candidate as RTCIceCandidateInit;
  if (!handle.pc.remoteDescription) {
    handle.pendingCandidates.push(candidate);
    return;
  }
  try {
    await handle.pc.addIceCandidate(candidate);
  } catch {
    /* a late candidate after hangup is harmless */
  }
}

export function handleEnded(payload: { reason?: string; status?: string; durationSeconds?: number }): void {
  const reason = String(payload?.reason ?? 'ended');
  const status = String(payload?.status ?? '');
  const outcome: CallOutcome =
    status === 'declined' || reason === 'declined'
      ? 'declined'
      : status === 'missed' || reason === 'missed'
        ? 'missed'
        : status === 'busy' || reason === 'busy'
          ? 'busy'
          : status === 'failed' || reason === 'failed'
            ? 'failed'
            : status === 'cancelled' || reason === 'cancelled' || reason === 'cancel'
              ? 'cancelled'
              : 'ended';
  const extra: Partial<CallState> = {};
  if (typeof payload?.durationSeconds === 'number' && payload.durationSeconds >= 0) {
    extra.durationSeconds = payload.durationSeconds;
  }
  finish(outcome, OUTCOME_MESSAGES[outcome], extra);
}

export function handleUnavailable(payload?: { isGroup?: boolean }): void {
  finish(
    'unavailable',
    payload?.isGroup ? 'Nobody in this group is online right now.' : 'The person is offline right now.',
  );
}

export function handleCallError(
  message: string,
  code?: string,
  extra: { capacity?: number; audioOnlyAvailable?: boolean } = {},
): void {
  // Video call full? Offer the audio-only way in.
  if (code === 'CALL_FULL' && state.video && state.callId && current && extra.audioOnlyAvailable !== false) {
    current.video = false;
    current.capacity = MAX_AUDIO_PARTICIPANTS;
    setState({
      video: false,
      cameraOn: false,
      audioOnly: true,
      capacity: MAX_AUDIO_PARTICIPANTS,
      notice: `${message} You can join with audio only.`,
    });
    void (async () => {
      if (localStream?.getVideoTracks()[0]) await replaceLocalTrack('video', null);
      realtime.emit('call:accept', { callId: current?.callId, audioOnly: true });
    })();
    return;
  }
  if (code === 'CALL_GONE') {
    finish('ended', message || 'This call has ended.');
    return;
  }
  // Errors from "Add participant" keep the current call running: they are a
  // notice, not the end of the call.
  if (
    code === 'CALL_PARTY_BUSY' ||
    code === 'CALL_PARTY_OFFLINE' ||
    code === 'CALL_INVALID' ||
    (code === 'CALL_FORBIDDEN' && (state.status === 'active' || state.status === 'connecting'))
  ) {
    setState({ notice: message || 'That person cannot be added right now.' });
    return;
  }
  if (code === 'CALL_BLOCKED') {
    finish('failed', message || 'You cannot join this call.');
    return;
  }
  finish('failed', message || OUTCOME_MESSAGES.failed);
}

/* --------------------------------------------------- in-call state signals */
/**
 * In-call state signals go through the server's call:signal event, which
 * validates the call membership and relays to the other participants (or only
 * to toUserId when given). Late joiners get the tracked state in snapshots.
 */
function emitSignal(payload: CallSignal): void {
  if (!current) return;
  realtime.emit('call:signal', { callId: current.callId, signal: payload });
}

function emitSignalTo(peerId: string, payload: CallSignal): void {
  if (!current) return;
  realtime.emit('call:signal', { callId: current.callId, toUserId: peerId, signal: payload });
}

/** Tell a newly connected peer our current media state before frames arrive. */
function emitMySignalsTo(peerId: string): void {
  if (!current) return;
  emitSignalTo(peerId, { kind: 'muted', muted: state.muted });
  if (state.video) emitSignalTo(peerId, { kind: 'camera', cameraOn: state.cameraOn });
  if (state.screenSharing) {
    emitSignalTo(peerId, {
      kind: 'screen',
      screenSharing: true,
      sharingKind: 'screen',
      hasSystemAudio: state.screenAudio,
      controlCapable: state.controlSupported,
    });
  }
  emitSignalTo(peerId, { kind: 'incoming-video-off', off: state.incomingVideoOff });
}

/**
 * Start / stop sending our camera video to one peer. Used when that person
 * turns incoming video off: no video frames leave us towards them, which is
 * what actually saves their data.
 */
function setPeerVideoDelivery(peerId: string, enabled: boolean): void {
  const handle = peers.get(peerId);
  if (!handle) return;
  const sender = handle.videoSender;
  if (!sender) return;
  const track = enabled ? (localStream?.getVideoTracks()[0] ?? null) : null;
  void sender.replaceTrack(track).catch(() => undefined);
}

export function toggleLowBandwidth(): void {
  toggleIncomingVideo();
}

/** Audio-only reception: stops receiving and sending video, audio still plays. */
export function toggleIncomingVideo(): void {
  const next = !state.incomingVideoOff;
  for (const handle of peers.values()) {
    for (const track of handle.stream.getVideoTracks()) track.enabled = !next;
  }
  setState({
    incomingVideoOff: next,
    lowBandwidth: next,
    notice: next
      ? 'Incoming video is off — you can still hear everyone, and your camera keeps sending unless you turn it off.'
      : 'Incoming video is back on.',
  });
  emitSignal({ kind: 'incoming-video-off', off: next });
  streamTick += 1;
  setState({ streamTick });
}

/** True inside the Capacitor Android wrapper (screen sharing is not available). */
export function isAndroidNative(): boolean {
  const capacitor = (window as unknown as {
    Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
  }).Capacitor;
  if (!capacitor) return false;
  const platform = capacitor.getPlatform?.();
  if (platform === 'android') return true;
  return capacitor.isNativePlatform?.() === true && platform === 'android';
}

export function isElectronShell(): boolean {
  return Boolean((window as unknown as { chatgramDesktop?: unknown }).chatgramDesktop);
}

export function isScreenSharingSupported(): boolean {
  if (isAndroidNative()) return false;
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

/** Honest reason when screen sharing is not available on this platform. */
export function screenShareUnavailableReason(): string | null {
  if (isAndroidNative()) return 'Screen sharing is not supported in the Android app yet.';
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    return 'This browser does not support screen sharing.';
  }
  return null;
}

/** Ask the other person to switch this audio call to video. */
export function requestVideoUpgrade(): void {
  if (!current || state.video) return;
  setState({ videoUpgradePending: true, notice: 'Waiting for the other person to accept video.' });
  emitSignal({ kind: 'video-request' });
}

/** Accept or decline a switch-to-video request from the other person. */
export async function respondVideoUpgrade(accept: boolean): Promise<void> {
  if (!state.videoRequest) return;
  setState({ videoRequest: null });
  if (!accept) {
    emitSignal({ kind: 'video-declined' });
    return;
  }
  await becomeVideo();
  emitSignal({ kind: 'video-accepted' });
}

async function becomeVideo(): Promise<void> {
  if (!current || state.video) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: mediaConstraints(true).video });
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    await replaceLocalTrack('video', track);
    setState({ video: true, cameraOn: true, screenSharing: false, audioOnly: false, videoUpgradePending: false, notice: 'Video is on.' });
    void refreshDevices();
    for (const handle of peers.values()) void sendOffer(handle);
    emitSignal({ kind: 'camera', cameraOn: true });
  } catch {
    setState({ videoUpgradePending: false, notice: 'Could not turn the camera on.' });
  }
}

/** Switch a video call to audio only (stops sending camera). */
export async function switchToAudioOnly(): Promise<void> {
  if (!state.video) return;
  await stopScreenShareInternal();
  await replaceLocalTrack('video', null);
  setState({ audioOnly: true, cameraOn: false, video: false, notice: 'You switched to audio only. Others can still hear you.' });
  for (const handle of peers.values()) void sendOffer(handle);
  emitSignal({ kind: 'camera', cameraOn: false });
}

/* -------------------------------------------------------------- screen share */

/** The shared-screen audio track (system audio), where the browser provides it. */
let screenAudioTrack: MediaStreamTrack | null = null;

async function requestDisplayStream(): Promise<MediaStream> {
  const withAudio: DisplayMediaStreamOptions = {
    video: { frameRate: { ideal: 15, max: 30 } },
    audio: true,
  };
  try {
    return await navigator.mediaDevices.getDisplayMedia(withAudio);
  } catch (error) {
    // Older Firefox/Safari reject `audio: true` outright — retry video-only.
    const name = error instanceof Error ? error.name : '';
    if (name !== 'NotAllowedError' && name !== 'AbortError') {
      return navigator.mediaDevices.getDisplayMedia({ video: true });
    }
    throw error;
  }
}

/** Replace the outgoing camera track with the screen, add system audio when available. */
export async function toggleScreenShare(): Promise<void> {
  if (!current) return;
  if (state.screenSharing) {
    await stopScreenShareInternal();
    return;
  }
  if (!isScreenSharingSupported()) {
    setState({ notice: screenShareUnavailableReason() ?? 'Screen sharing is not available here.' });
    return;
  }
  let display: MediaStream;
  try {
    display = await requestDisplayStream();
  } catch {
    setState({ notice: 'Screen sharing was cancelled.' });
    return;
  }
  const videoTrack = display.getVideoTracks()[0];
  if (!videoTrack) {
    setState({ notice: 'No screen was selected.' });
    return;
  }
  screenStream = display;
  await replaceLocalTrack('video', videoTrack);
  videoTrack.onended = () => void stopScreenShareInternal();

  // Optional system audio: add it as an extra audio track to every peer.
  const systemAudio = display.getAudioTracks()[0] ?? null;
  if (systemAudio && localStream) {
    screenAudioTrack = systemAudio;
    localStream.addTrack(systemAudio);
    for (const handle of peers.values()) {
      try {
        handle.pc.addTrack(systemAudio, localStream);
        void sendOffer(handle);
      } catch {
        /* one peer refusing the extra track must not break sharing */
      }
    }
  }

  setState({
    screenSharing: true,
    screenAudio: Boolean(systemAudio),
    video: true,
    cameraOn: false,
    audioOnly: false,
    // Consent is per share session and starts OFF.
    controlAllowed: false,
    controlPendingId: null,
    controlViewerId: null,
    controlMessage: null,
    screenQuality: 'unknown',
    screenStats: { active: true, bitrateKbps: null, rttMs: null, lossPct: null, low: false },
    notice: systemAudio
      ? 'You are sharing your screen with system audio.'
      : 'You are sharing your screen.',
  });
  // A new share starts its own quality sampler (never reuse the camera sample).
  screenSample = null;
  screenLowSince = null;
  screenLowNotified = false;
  // Tell the peers control is available-but-not-yet-consented, and refresh
  // whether this shell can inject input at all (Windows desktop only).
  announceControlConsent();
  void syncControlSupport().then(() => {
    if (state.screenSharing) emitScreenSignal();
  });
  emitScreenSignal();
}

async function stopScreenShareInternal(): Promise<void> {
  // Also recover a stale partial share (flag false but the screen track/stream
  // still attached): stopping must always restore the camera and clear the flag.
  if (!state.screenSharing && !screenStream && !screenAudioTrack) return;
  const hadSystemAudio = Boolean(screenAudioTrack);
  setState({
    screenSharing: false,
    screenAudio: false,
    screenQuality: 'unknown',
    screenStats: { active: false, bitrateKbps: null, rttMs: null, lossPct: null, low: false },
  });
  screenSample = null;
  screenLowSince = null;
  screenLowNotified = false;
  // Keep advertising capability after the stop (screenSharing false now).
  emitScreenSignal();
  // Stopping the share revokes remote control instantly (consent + channel).
  resetRemoteControl();
  stopTracks(screenStream);
  screenStream = null;
  if (screenAudioTrack && localStream) {
    const track = screenAudioTrack;
    screenAudioTrack = null;
    for (const handle of peers.values()) {
      const sender = handle.pc.getSenders().find((candidate) => candidate.track === track);
      try {
        if (sender) handle.pc.removeTrack(sender);
        void sendOffer(handle);
      } catch {
        /* peer may be gone */
      }
    }
    try {
      localStream.removeTrack(track);
      track.stop();
    } catch {
      /* already stopped */
    }
  }
  // Bring the camera back after the share (the camera track was replaced).
  try {
    const camera = await navigator.mediaDevices.getUserMedia({ video: mediaConstraints(true).video });
    const track = camera.getVideoTracks()[0];
    if (track) {
      await replaceLocalTrack('video', track);
      setState({ cameraOn: true, notice: hadSystemAudio ? 'You stopped sharing your screen.' : 'You stopped sharing your screen.' });
    }
  } catch {
    await replaceLocalTrack('video', null);
    setState({ cameraOn: false, notice: 'You stopped sharing your screen. Your camera is off.' });
  }
  for (const handle of peers.values()) void sendOffer(handle);
  emitSignal({ kind: 'camera', cameraOn: state.cameraOn });
}

/** Add one contact to a 1:1 call: the server converts the room to a group room. */
export function inviteParticipant(userId: string): void {
  if (!current || !userId || userId === myUserId) return;
  current.isGroup = true;
  current.capacity = state.video ? MAX_VIDEO_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS;
  setState({
    isGroup: true,
    capacity: current.capacity,
    notice: 'Inviting…',
  });
  realtime.emit('call:add-participant', { callId: current.callId, userId });
}

/** Flip between front and back cameras on phones (cycles video inputs). */
export async function flipCamera(): Promise<void> {
  const devices = state.devices.videoInput;
  if (!devices.length) {
    setState({ notice: 'No other camera found.' });
    return;
  }
  const currentTrack = localStream?.getVideoTracks()[0];
  const currentDevice = currentTrack?.getSettings().deviceId;
  const index = devices.findIndex((device) => device.deviceId === currentDevice);
  const next = devices[(index + 1) % devices.length];
  if (next) await switchDevice('video', next.deviceId);
}

/* ------------------------------------------------------------------ controls */

export async function toggleMute(): Promise<void> {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (track) {
    // Stopping the track (not just disabling it) releases the microphone.
    await replaceLocalTrack('audio', null);
    setState({ muted: true });
    emitSignal({ kind: 'muted', muted: true });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: mediaConstraints(false).audio });
    const fresh = stream.getAudioTracks()[0];
    if (fresh) await replaceLocalTrack('audio', fresh);
    setState({ muted: false });
    emitSignal({ kind: 'muted', muted: false });
  } catch {
    setState({ notice: 'Could not turn the microphone back on.' });
  }
}

export async function toggleCamera(): Promise<void> {
  if (!state.video) return;
  if (state.screenSharing) {
    setState({ notice: 'Stop sharing your screen before turning the camera on or off.' });
    return;
  }
  if (state.cameraOn) {
    // Privacy: stopping the track releases the camera light, and the removed
    // sender plus the signal means nobody keeps receiving our video.
    await replaceLocalTrack('video', null);
    setState({ cameraOn: false, notice: 'Camera off — others can still hear your audio.' });
    emitSignal({ kind: 'camera', cameraOn: false });
    for (const handle of peers.values()) void sendOffer(handle);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: mediaConstraints(true).video });
    const fresh = stream.getVideoTracks()[0];
    if (fresh) await replaceLocalTrack('video', fresh);
    setState({ cameraOn: true, notice: 'Camera on.' });
    emitSignal({ kind: 'camera', cameraOn: true });
    for (const handle of peers.values()) void sendOffer(handle);
  } catch {
    setState({ notice: 'Could not turn the camera back on.' });
  }
}

/** Switch microphone or camera to a different device. */
export async function switchDevice(kind: 'audio' | 'video', deviceId: string): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: kind === 'audio' ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true } : false,
      video: kind === 'video' ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    const track = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
    if (!track) return;
    await replaceLocalTrack(kind, track);
    void refreshDevices();
    setState({ notice: kind === 'audio' ? 'Microphone switched.' : 'Camera switched.' });
  } catch {
    setState({ notice: 'Could not switch that device.' });
  }
}

/** Route remote audio to a chosen speaker, where the browser supports it. */
export async function setSpeaker(deviceId: string): Promise<void> {
  setState({ sinkId: deviceId });
  for (const handle of peers.values()) {
    for (const element of document.querySelectorAll<HTMLMediaElement>(`[data-call-audio="${handle.info.id}"]`)) {
      const withSink = element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
      if (withSink.setSinkId) await withSink.setSinkId(deviceId).catch(() => undefined);
    }
  }
}

export function setMinimised(minimised: boolean): void {
  setState({ minimised });
}

export function supportsSpeakerSelection(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

/* ------------------------------------------------------------- page unload */

/**
 * Say goodbye when the tab is closed or reloaded mid-call, so the other side is
 * not left staring at a frozen tile and the server can log the call.
 */
export function handlePageHide(): void {
  if (!current) return;
  const callId = current.callId;
  if (state.status === 'incoming') realtime.emit('call:decline', { callId });
  else realtime.emit('call:end', { callId, reason: 'hangup' });
  cleanup();
  setState({ ...IDLE });
}

export function isCallActive(): boolean {
  return state.status !== 'idle' && state.status !== 'ended';
}

/* -------------------------------------------------- dev-only verification hook */

/**
 * Tiny hook for scripts/verify-calls.js only. Vite defines import.meta.env.DEV
 * as false in production builds, so this is stripped from the shipped bundle
 * and cannot be used to fake call outcomes in production.
 */
const IS_DEV_BUILD = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
if (IS_DEV_BUILD && typeof window !== 'undefined') {
  (window as unknown as { __chatgramCalls?: unknown }).__chatgramCalls = {
    getState: () => getCallState(),
    getPeerIds: () => getPeerIds(),
    getLocalTracks: () =>
      (localStream?.getTracks() ?? []).map((track) => ({ kind: track.kind, readyState: track.readyState })),
    getPeerTracks: (peerId: string) =>
      (peers.get(peerId)?.stream.getTracks() ?? []).map((track) => ({
        kind: track.kind,
        readyState: track.readyState,
        enabled: track.enabled,
      })),
    /** Ask the server to end the current call as failed (real signalling path). */
    simulateFailure: () => {
      if (!state.callId) return false;
      realtime.emit('call:failed', { callId: state.callId, reason: 'ice' });
      return true;
    },
    /** Local fallback if the server does not support call:failed yet. */
    forceFailed: (message = 'Failed to connect — the connection dropped.') => {
      if (!current) return false;
      failCall(message);
      return true;
    },
    /** Force the declined outcome locally (used only as a fallback). */
    forceDeclined: () => {
      if (!current) return false;
      finish('declined', OUTCOME_MESSAGES.declined);
      return true;
    },
    isScreenSharingSupported: () => isScreenSharingSupported(),
    toggleScreenShare: () => toggleScreenShare(),
  };
}

