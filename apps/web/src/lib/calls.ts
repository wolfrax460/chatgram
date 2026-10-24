/**
 * 1:1 WebRTC calls.
 *
 * The server only forwards signalling (SDP/ICE) between the two users; media is
 * peer-to-peer (or relayed through TURN when configured). This module owns the
 * RTCPeerConnection and publishes a small observable state that the overlay
 * renders.
 */
import { api, realtime } from './api';

export type CallStatus = 'idle' | 'calling' | 'incoming' | 'connecting' | 'active' | 'ended' | 'error';

export interface CallPeer {
  id: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface CallState {
  status: CallStatus;
  callId: string | null;
  chatId: string | null;
  peer: CallPeer | null;
  video: boolean;
  muted: boolean;
  cameraOn: boolean;
  startedAt: number | null;
  message?: string;
}

const IDLE: CallState = {
  status: 'idle',
  callId: null,
  chatId: null,
  peer: null,
  video: false,
  muted: false,
  cameraOn: false,
  startedAt: null,
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

let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let current: { callId: string; chatId: string; video: boolean } | null = null;
let pendingOffer: { callId: string; chatId: string; video: boolean; sdp: RTCSessionDescriptionInit; from: CallPeer } | null = null;
let endTimer: number | null = null;

export function getLocalStream(): MediaStream | null {
  return localStream;
}

export function getRemoteStream(): MediaStream | null {
  return remoteStream;
}

function newCallId(): string {
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createPeer(video: boolean): Promise<void> {
  const ice = await api.iceServers();
  pc = new RTCPeerConnection({ iceServers: ice.iceServers });
  remoteStream = new MediaStream();
  pc.ontrack = (event) => {
    for (const stream of event.streams) {
      for (const track of stream.getTracks()) {
        if (!remoteStream?.getTracks().some((existing) => existing.id === track.id)) remoteStream?.addTrack(track);
      }
    }
    setState({});
  };
  pc.onicecandidate = (event) => {
    if (!event.candidate || !current || !state.peer) return;
    realtime.emit('call:ice', {
      toUserId: state.peer.id,
      chatId: current.chatId,
      callId: current.callId,
      candidate: event.candidate.toJSON(),
    });
  };
  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'connected' && state.status !== 'active') {
      setState({ status: 'active', startedAt: Date.now() });
    }
    if (pc?.connectionState === 'failed') {
      setState({ status: 'error', message: 'The connection failed. Try again.' });
    }
  };

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
}

function cleanup(): void {
  localStream?.getTracks().forEach((track) => track.stop());
  remoteStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  remoteStream = null;
  try {
    pc?.close();
  } catch {
    /* already closed */
  }
  pc = null;
  current = null;
  pendingOffer = null;
}

function finish(message: string): void {
  cleanup();
  setState({ ...IDLE, status: 'ended', message });
  if (endTimer) window.clearTimeout(endTimer);
  endTimer = window.setTimeout(() => setState({ ...IDLE }), 6000);
}

export function dismissCall(): void {
  if (endTimer) window.clearTimeout(endTimer);
  cleanup();
  setState({ ...IDLE });
}

export async function startCall(peer: CallPeer, chatId: string, options: { video?: boolean } = {}): Promise<void> {
  if (state.status !== 'idle' && state.status !== 'ended') return;
  const callId = newCallId();
  const video = options.video === true;
  current = { callId, chatId, video };
  setState({ status: 'calling', callId, chatId, peer, video, muted: false, cameraOn: video, startedAt: null, message: undefined });
  try {
    await createPeer(video);
    const offer = await pc!.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
    await pc!.setLocalDescription(offer);
    realtime.emit('call:offer', {
      toUserId: peer.id,
      chatId,
      callId,
      video,
      sdp: pc!.localDescription,
    });
  } catch (error) {
    finish(error instanceof Error && error.name === 'NotAllowedError' ? 'Microphone/camera permission was denied.' : 'Could not start the call.');
  }
}

export function handleIncoming(payload: {
  callId: string;
  chatId: string;
  video: boolean;
  sdp: unknown;
  from: { id: string; displayName?: string; avatarUrl?: string };
}): void {
  if (state.status !== 'idle' && state.status !== 'ended') {
    realtime.emit('call:reject', { toUserId: payload.from.id, chatId: payload.chatId, callId: payload.callId });
    return;
  }
  pendingOffer = {
    callId: payload.callId,
    chatId: payload.chatId,
    video: payload.video,
    sdp: payload.sdp as RTCSessionDescriptionInit,
    from: payload.from,
  };
  setState({
    status: 'incoming',
    callId: payload.callId,
    chatId: payload.chatId,
    peer: payload.from,
    video: payload.video,
    muted: false,
    cameraOn: false,
    startedAt: null,
    message: undefined,
  });
}

export async function acceptCall(): Promise<void> {
  if (!pendingOffer) return;
  const offer = pendingOffer;
  current = { callId: offer.callId, chatId: offer.chatId, video: offer.video };
  setState({ status: 'connecting', cameraOn: offer.video });
  try {
    await createPeer(offer.video);
    await pc!.setRemoteDescription(offer.sdp);
    const answer = await pc!.createAnswer();
    await pc!.setLocalDescription(answer);
    realtime.emit('call:answer', {
      toUserId: offer.from.id,
      chatId: offer.chatId,
      callId: offer.callId,
      sdp: pc!.localDescription,
    });
    pendingOffer = null;
  } catch {
    rejectCall();
    setState({ status: 'error', message: 'Could not answer the call.' });
  }
}

export function rejectCall(): void {
  const callId = state.callId;
  const chatId = state.chatId;
  if (callId && chatId && state.peer) {
    realtime.emit('call:reject', { toUserId: state.peer.id, chatId, callId });
  }
  finish('Call declined');
}

export function hangUp(): void {
  const callId = state.callId;
  const chatId = state.chatId;
  if (callId && chatId && state.peer) {
    realtime.emit('call:end', { toUserId: state.peer.id, chatId, callId, reason: 'hangup' });
  }
  finish('Call ended');
}

export async function handleAnswer(payload: { callId: string; sdp: unknown }): Promise<void> {
  if (!pc || state.callId !== payload.callId) return;
  try {
    await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
  } catch {
    finish('Could not connect the call.');
  }
}

export async function handleIce(payload: { callId: string; candidate: unknown }): Promise<void> {
  if (!pc || state.callId !== payload.callId || !payload.candidate) return;
  try {
    await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit);
  } catch {
    /* a late candidate after hangup is harmless */
  }
}

export function handleRemoteEnd(reason: string): void {
  finish(reason === 'declined' ? 'Call declined' : 'Call ended');
}

export function handleUnavailable(): void {
  finish('The person is offline right now.');
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
