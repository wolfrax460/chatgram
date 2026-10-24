/**
 * WebRTC calls: one-to-one and group, voice and video (up to 20 people).
 *
 * The server only forwards signalling; media is peer-to-peer (or relayed via
 * TURN when configured). Group calls use a full mesh: every participant holds
 * one RTCPeerConnection per other participant. Joining is glare-free — whoever
 * accepts or is added connects *out* to everyone already in the call, so only
 * one side ever creates the offer for a given pair.
 */
import { api, realtime } from './api';

export type CallStatus = 'idle' | 'calling' | 'incoming' | 'connecting' | 'active' | 'ended' | 'error';

export interface CallParticipant {
  id: string;
  displayName?: string;
  avatarUrl?: string | null;
}

export interface CallState {
  status: CallStatus;
  callId: string | null;
  chatId: string | null;
  /** Group name, or the other person's name for a direct call. */
  title: string;
  video: boolean;
  isGroup: boolean;
  /** Everyone else in the call. */
  participants: CallParticipant[];
  muted: boolean;
  cameraOn: boolean;
  startedAt: number | null;
  message?: string;
  /** Human-readable note (e.g. "Kevin declined"). */
  notice?: string;
  /** Bumped whenever a media stream changes so the overlay re-renders. */
  streamTick: number;
}

export const MAX_CALL_PARTICIPANTS = 20;

const IDLE: CallState = {
  status: 'idle',
  callId: null,
  chatId: null,
  title: '',
  video: false,
  isGroup: false,
  participants: [],
  muted: false,
  cameraOn: false,
  startedAt: null,
  streamTick: 0,
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
}

interface PeerHandle {
  pc: RTCPeerConnection;
  stream: MediaStream;
  info: CallParticipant;
}

let current: ActiveCall | null = null;
let localStream: MediaStream | null = null;
const peers = new Map<string, PeerHandle>();
let pendingInvite: (ActiveCall & { from: CallParticipant }) | null = null;
let iceConfig: RTCIceServer[] | null = null;
let endTimer: number | null = null;
let streamTick = 0;

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

async function iceServers(): Promise<RTCIceServer[]> {
  if (iceConfig) return iceConfig;
  try {
    const config = await api.iceServers();
    iceConfig = config.iceServers;
  } catch {
    iceConfig = [{ urls: 'stun:stun.l.google.com:19302' }];
  }
  return iceConfig;
}

async function acquireMedia(video: boolean): Promise<MediaStream> {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  });
  return localStream;
}

function removePeer(peerId: string): void {
  const handle = peers.get(peerId);
  if (!handle) return;
  try {
    handle.pc.close();
  } catch {
    /* already closed */
  }
  handle.stream.getTracks().forEach((track) => track.stop());
  peers.delete(peerId);
}

function cleanup(): void {
  for (const id of [...peers.keys()]) removePeer(id);
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  current = null;
  pendingInvite = null;
  streamTick = 0;
}

function finish(message: string): void {
  cleanup();
  setState({ ...IDLE, status: 'ended', message });
  if (endTimer) window.clearTimeout(endTimer);
  endTimer = window.setTimeout(() => setState({ ...IDLE, streamTick: 0 }), 6000);
}

export function dismissCall(): void {
  if (endTimer) window.clearTimeout(endTimer);
  cleanup();
  setState({ ...IDLE });
}

/** Mark the call active once at least one peer connects (or immediately for a solo caller). */
function markActive(): void {
  if (state.status === 'connecting' || state.status === 'calling') {
    setState({ status: 'active', startedAt: state.startedAt ?? Date.now() });
  }
}

async function createPeer(info: CallParticipant): Promise<PeerHandle | null> {
  if (!current || !localStream) return null;
  const existing = peers.get(info.id);
  if (existing) {
    existing.info = info;
    return existing;
  }
  if (peers.size >= MAX_CALL_PARTICIPANTS - 1) {
    setState({ notice: `This call is full (up to ${MAX_CALL_PARTICIPANTS} people).` });
    return null;
  }

  const pc = new RTCPeerConnection({ iceServers: await iceServers() });
  const stream = new MediaStream();
  const handle: PeerHandle = { pc, stream, info };
  peers.set(info.id, handle);

  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

  pc.ontrack = (event) => {
    for (const incoming of event.streams[0]?.getTracks() ?? [event.track]) {
      if (!stream.getTracks().some((track) => track.id === incoming.id)) stream.addTrack(incoming);
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
    if (pc.connectionState === 'connected') markActive();
    if (pc.connectionState === 'failed' && peers.size > 0) {
      removePeer(info.id);
      const participants = state.participants.filter((p) => p.id !== info.id);
      streamTick += 1;
      setState({ participants, streamTick, notice: `${handle.info.displayName ?? 'Someone'} lost connection.` });
      if (participants.length === 0) finish('Call ended');
    }
  };

  return handle;
}

async function sendOffer(info: CallParticipant): Promise<void> {
  const handle = await createPeer(info);
  if (!handle || !current) return;
  try {
    const offer = await handle.pc.createOffer();
    await handle.pc.setLocalDescription(offer);
    realtime.emit('call:offer', { callId: current.callId, toUserId: info.id, sdp: handle.pc.localDescription });
  } catch {
    removePeer(info.id);
  }
}

/** Start a call in a chat. Requests mic/camera first so the browser prompt has a user gesture. */
export async function startCall(
  target: { chatId: string; title: string; isGroup: boolean },
  options: { video?: boolean } = {},
): Promise<void> {
  if (state.status !== 'idle' && state.status !== 'ended') return;
  const video = options.video === true;
  const callId = newCallId();

  try {
    await acquireMedia(video);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    setState({
      ...IDLE,
      status: 'error',
      message:
        name === 'NotAllowedError'
          ? `${video ? 'Camera and microphone' : 'Microphone'} permission was denied.`
          : 'Could not access your microphone or camera.',
    });
    return;
  }

  current = { callId, chatId: target.chatId, video, isGroup: target.isGroup, title: target.title };
  setState({
    ...IDLE,
    status: 'calling',
    callId,
    chatId: target.chatId,
    title: target.title,
    video,
    isGroup: target.isGroup,
    cameraOn: video,
  });
  realtime.emit('call:start', { callId, chatId: target.chatId, video });
}

/** Somebody is ringing me. Auto-declines when I am already in a call. */
export function handleIncoming(payload: {
  callId: string;
  chatId: string;
  video: boolean;
  isGroup: boolean;
  title: string;
  from: CallParticipant;
}): void {
  if (state.status !== 'idle' && state.status !== 'ended') {
    realtime.emit('call:decline', { callId: payload.callId });
    return;
  }
  pendingInvite = {
    callId: payload.callId,
    chatId: payload.chatId,
    video: payload.video === true,
    isGroup: payload.isGroup === true,
    title: payload.title || payload.from.displayName || 'Call',
    from: payload.from,
  };
  setState({
    ...IDLE,
    status: 'incoming',
    callId: payload.callId,
    chatId: payload.chatId,
    title: pendingInvite.title,
    video: pendingInvite.video,
    isGroup: pendingInvite.isGroup,
    participants: [payload.from],
    cameraOn: false,
  });
}

export async function acceptCall(): Promise<void> {
  if (!pendingInvite) return;
  const invite = pendingInvite;
  try {
    await acquireMedia(invite.video);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    setState({ message: name === 'NotAllowedError' ? 'Permission was denied.' : 'Could not access your devices.' });
    rejectCall();
    return;
  }
  current = {
    callId: invite.callId,
    chatId: invite.chatId,
    video: invite.video,
    isGroup: invite.isGroup,
    title: invite.title,
  };
  pendingInvite = null;
  setState({ status: 'connecting', cameraOn: invite.video, participants: [invite.from] });
  realtime.emit('call:accept', { callId: invite.callId });
}

/** The server confirmed I am in the call: connect out to everyone already there. */
export function handleJoined(payload: { callId: string; participants: CallParticipant[] }): void {
  if (!current || current.callId !== payload.callId) return;
  const others = payload.participants.filter((p) => p.id);
  setState({ status: others.length ? 'connecting' : 'active', participants: others, startedAt: others.length ? null : Date.now() });
  for (const participant of others) void sendOffer(participant);
  if (!others.length) markActive();
}

export function handleParticipantJoined(payload: { callId: string; participant: CallParticipant }): void {
  if (!current || current.callId !== payload.callId || !payload.participant?.id) return;
  const exists = state.participants.some((p) => p.id === payload.participant.id);
  if (exists) return;
  setState({ participants: [...state.participants, payload.participant] });
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

export async function handleOffer(payload: {
  callId: string;
  from: CallParticipant;
  sdp: unknown;
}): Promise<void> {
  if (!current || current.callId !== payload.callId || !payload.from?.id) return;
  const handle = await createPeer(payload.from);
  if (!handle) return;
  try {
    await handle.pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
    const answer = await handle.pc.createAnswer();
    await handle.pc.setLocalDescription(answer);
    realtime.emit('call:answer', { callId: current.callId, toUserId: payload.from.id, sdp: handle.pc.localDescription });
    const exists = state.participants.some((p) => p.id === payload.from.id);
    if (!exists) setState({ participants: [...state.participants, payload.from] });
  } catch {
    // A failed answer means this peer is not reachable; drop it.
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
  try {
    await handle.pc.addIceCandidate(payload.candidate as RTCIceCandidateInit);
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

export function handleCallError(message: string): void {
  finish(message);
}

export function toggleMute(): void {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  setState({ muted: !track.enabled });
}

export function toggleCamera(): void {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  setState({ cameraOn: track.enabled });
}
