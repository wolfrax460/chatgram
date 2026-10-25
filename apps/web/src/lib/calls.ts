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

export type CallStatus =
  | 'idle'
  | 'calling'
  | 'incoming'
  | 'connecting'
  | 'reconnecting'
  | 'active'
  | 'ended'
  | 'error';

export interface CallParticipant {
  id: string;
  displayName?: string;
  avatarUrl?: string | null;
  audioOnly?: boolean;
}

export type CallQuality = 'unknown' | 'good' | 'fair' | 'poor';

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
  minimised: false,
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
}

let current: ActiveCall | null = null;
let localStream: MediaStream | null = null;
let pendingInvite: (ActiveCall & { from: CallParticipant }) | null = null;
const peers = new Map<string, PeerHandle>();
let iceServersCache: { servers: RTCIceServer[]; fetchedAt: number; ttlMs: number } | null = null;

let ringTimer: number | null = null;
let reconnectTimer: number | null = null;
let statsTimer: number | null = null;
let endTimer: number | null = null;
let streamTick = 0;
let myUserId = '';

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
    const sender = handle.pc.getSenders().find((s) => s.track?.kind === kind);
    try {
      if (sender) await sender.replaceTrack(track);
      else if (track && localStream) handle.pc.addTrack(track, localStream);
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

function targetBitrate(peerCount: number): number {
  if (peerCount <= 1) return 1_500_000;
  if (peerCount <= 3) return 700_000;
  if (peerCount <= 5) return 400_000;
  return 250_000;
}

/** Reduce video bitrate/resolution as more people join the mesh. */
async function applyVideoQuality(): Promise<void> {
  if (!state.video) return;
  const bitrate = targetBitrate(peers.size);
  const degradation = peers.size <= 1 ? 1 : peers.size <= 3 ? 2 : 4;
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

async function measureQuality(): Promise<void> {
  const handles = [...peers.values()];
  if (!handles.length) {
    setState({ quality: 'unknown' });
    return;
  }
  let worst: CallQuality = 'good';
  for (const handle of handles) {
    try {
      const stats = await handle.pc.getStats();
      let rtt = 0;
      let loss = 0;
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = Math.max(rtt, (report.currentRoundTripTime || 0) * 1000);
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          const received = report.packetsReceived || 0;
          const lost = report.packetsLost || 0;
          if (received + lost > 20) loss = Math.max(loss, lost / (received + lost));
        }
      });
      if (rtt > 400 || loss > 0.12) worst = 'poor';
      else if (worst !== 'poor' && (rtt > 220 || loss > 0.04)) worst = 'fair';
    } catch {
      /* ignore a peer that just closed */
    }
  }
  setState({ quality: worst });
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
  current = null;
  pendingInvite = null;
  streamTick = 0;
}

function finish(message: string, patch: Partial<CallState> = {}): void {
  cleanup();
  setState({ ...IDLE, status: 'ended', message, ...patch });
  endTimer = window.setTimeout(() => setState({ ...IDLE, streamTick: 0 }), 6000);
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
    finish('Connection lost. The call ended.');
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
  };
  peers.set(info.id, handle);

  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

  pc.ontrack = (event) => {
    for (const incoming of event.streams[0]?.getTracks() ?? [event.track]) {
      if (!handle.stream.getTracks().some((track) => track.id === incoming.id)) handle.stream.addTrack(incoming);
    }
    streamTick += 1;
    setState({ streamTick });
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
      // Give ICE a moment, then restart it.
      if (!handle.restartTimer) {
        handle.restartTimer = window.setTimeout(() => {
          handle.restartTimer = null;
          void restartIce(handle);
        }, 2_000);
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

async function sendOffer(handle: PeerHandle): Promise<void> {
  if (!current) return;
  try {
    handle.makingOffer = true;
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

function armRingTimeout(): void {
  if (ringTimer) window.clearTimeout(ringTimer);
  ringTimer = window.setTimeout(() => {
    ringTimer = null;
    if (state.status === 'calling') {
      const callId = state.callId;
      if (callId) realtime.emit('call:end', { callId, reason: 'missed' });
      finish('No answer.');
    } else if (state.status === 'incoming') {
      const callId = state.callId;
      if (callId) realtime.emit('call:decline', { callId });
      finish('Missed call.');
    }
  }, RING_TIMEOUT_MS);
}

function startStatsLoop(): void {
  if (statsTimer) window.clearInterval(statsTimer);
  statsTimer = window.setInterval(() => void measureQuality(), STATS_INTERVAL_MS);
}

/* ---------------------------------------------------------------- lifecycle */

export async function startCall(
  target: { chatId: string; title: string; isGroup: boolean; participantCount?: number },
  options: { video?: boolean } = {},
): Promise<void> {
  if (state.status !== 'idle' && state.status !== 'ended') return;

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
    media = await acquireMedia(wantVideo);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    setState({
      ...IDLE,
      status: 'error',
      message:
        name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it in your browser settings to make calls.'
          : 'Could not access your microphone or camera.',
    });
    return;
  }

  const callId = newCallId();
  current = {
    callId,
    chatId: target.chatId,
    video: media.video,
    isGroup: target.isGroup,
    title: target.title,
    capacity,
  };
  setState({
    ...IDLE,
    status: 'calling',
    callId,
    chatId: target.chatId,
    title: target.title,
    video: media.video,
    isGroup: target.isGroup,
    capacity,
    cameraOn: media.video,
    audioOnly: !media.video,
    notice: media.notice ?? notice,
  });
  armRingTimeout();
  startStatsLoop();
  realtime.emit('call:start', { callId, chatId: target.chatId, video: media.video });
}

/** Somebody is ringing me. Auto-declines when I am already in a call. */
export function handleIncoming(payload: {
  callId: string;
  chatId: string;
  video: boolean;
  isGroup: boolean;
  title: string;
  capacity?: number;
  from: CallParticipant;
}): void {
  if (state.status !== 'idle' && state.status !== 'ended') {
    realtime.emit('call:decline', { callId: payload.callId });
    return;
  }
  const capacity = payload.capacity ?? (payload.video ? MAX_VIDEO_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS);
  // Never offer camera in a group call that is already past the video cap.
  const video = payload.video && (payload.isGroup ? capacity > MAX_VIDEO_PARTICIPANTS - 1 : true);
  pendingInvite = {
    callId: payload.callId,
    chatId: payload.chatId,
    video,
    isGroup: payload.isGroup === true,
    title: payload.title || payload.from.displayName || 'Call',
    capacity,
    from: payload.from,
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
    participants: [payload.from],
    cameraOn: false,
  });
  armRingTimeout();
}

export async function acceptCall(options: { audioOnly?: boolean } = {}): Promise<void> {
  if (!pendingInvite) return;
  const invite = pendingInvite;
  const wantVideo = invite.video && !options.audioOnly;
  let media;
  try {
    media = await acquireMedia(wantVideo);
  } catch {
    rejectCall();
    setState({ message: 'Could not access your microphone, so the call was declined.' });
    return;
  }
  current = {
    callId: invite.callId,
    chatId: invite.chatId,
    video: media.video,
    isGroup: invite.isGroup,
    title: invite.title,
    capacity: invite.capacity,
  };
  pendingInvite = null;
  setState({
    status: 'connecting',
    video: media.video,
    cameraOn: media.video,
    audioOnly: !media.video,
    participants: [invite.from],
    notice: media.notice,
  });
  startStatsLoop();
  realtime.emit('call:accept', { callId: invite.callId, audioOnly: !media.video });
}

/* --------------------------------------------------------- signalling paths */

export function handleJoined(payload: { callId: string; participants: CallParticipant[] }): void {
  if (!current || current.callId !== payload.callId) return;
  const others = payload.participants.filter((p) => p.id && p.id !== myUserId);
  setState({ status: others.length ? 'connecting' : 'active', participants: others, startedAt: others.length ? null : Date.now() });
  for (const participant of others) {
    void createPeer(participant).then((handle) => (handle ? sendOffer(handle) : null));
  }
  if (!others.length) markActive();
  void applyVideoQuality();
}

export function handleParticipantJoined(payload: { callId: string; participant: CallParticipant }): void {
  if (!current || current.callId !== payload.callId || !payload.participant?.id) return;
  addParticipant(payload.participant);
  void applyVideoQuality();
}

export function handleParticipantLeft(payload: { callId: string; userId: string; reason?: string }): void {
  if (!current || current.callId !== payload.callId) return;
  const who = state.participants.find((p) => p.id === payload.userId);
  removePeer(payload.userId);
  const participants = state.participants.filter((p) => p.id !== payload.userId);
  streamTick += 1;
  if (participants.length === 0) {
    finish(payload.reason === 'declined' ? 'Call declined' : 'Call ended');
    return;
  }
  setState({
    participants,
    streamTick,
    notice: who?.displayName ? `${who.displayName} left the call.` : undefined,
  });
  void applyVideoQuality();
}

export function handleParticipantDeclined(payload: { userId: string; isGroup: boolean }): void {
  if (!payload.isGroup) {
    finish('Call declined');
    return;
  }
  setState({ notice: 'Someone declined the call.' });
}

export function rejectCall(): void {
  const callId = state.callId;
  if (callId) realtime.emit('call:decline', { callId });
  finish('Call declined');
}

export function hangUp(): void {
  const callId = state.callId;
  if (callId) realtime.emit('call:end', { callId, reason: 'hangup' });
  finish('Call ended');
}

/** Accept a call that arrived on another tab? No — that tab answered. */
export function handleAnsweredElsewhere(payload: { callId: string }): void {
  if (!state.callId || state.callId !== payload.callId) return;
  if (state.status !== 'incoming') return;
  finish('Answered on another device.', { status: 'ended' });
}

export function handleBusy(payload: { message?: string }): void {
  finish(payload?.message || 'They are on another call.');
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
    finish('Could not connect the call.');
  }
}

export async function handleIce(payload: {
  callId: string;
  from?: CallParticipant;
  candidate: unknown;
}): Promise<void> {
  if (!current || current.callId !== payload.callId || !payload.candidate) return;
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

export function handleEnded(reason: string): void {
  finish(reason === 'declined' ? 'Call declined' : reason === 'missed' ? 'Missed call' : 'Call ended');
}

export function handleUnavailable(payload?: { isGroup?: boolean }): void {
  finish(payload?.isGroup ? 'Nobody in this group is online right now.' : 'The person is offline right now.');
}

export function handleCallError(message: string, code?: string): void {
  // Video call full? Offer the audio-only way in.
  if (code === 'CALL_FULL' && state.video && state.callId && current) {
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
      const audioTrack = localStream?.getVideoTracks()[0];
      if (audioTrack) await replaceLocalTrack('video', null);
      realtime.emit('call:accept', { callId: current?.callId, audioOnly: true });
    })();
    return;
  }
  finish(message);
}

/* ------------------------------------------------------------------ controls */

export async function toggleMute(): Promise<void> {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (track) {
    // Stopping the track (not just disabling it) releases the microphone.
    await replaceLocalTrack('audio', null);
    setState({ muted: true });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: mediaConstraints(false).audio });
    const fresh = stream.getAudioTracks()[0];
    if (fresh) await replaceLocalTrack('audio', fresh);
    setState({ muted: false });
  } catch {
    setState({ notice: 'Could not turn the microphone back on.' });
  }
}

export async function toggleCamera(): Promise<void> {
  if (!state.video) return;
  if (state.cameraOn) {
    await replaceLocalTrack('video', null);
    setState({ cameraOn: false });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: mediaConstraints(true).video });
    const fresh = stream.getVideoTracks()[0];
    if (fresh) await replaceLocalTrack('video', fresh);
    setState({ cameraOn: true });
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
