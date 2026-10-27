/**
 * Socket.IO wrapper.
 *
 * Behaviour deliberately mirrors the Flutter client
 * (`client/lib/shared/services/socket_service.dart`) so both clients stay
 * compatible while Flutter is still in use:
 *
 *  - transports: websocket with polling fallback (websocket-only produced real
 *    "Socket connection error: timeout" bugs),
 *  - 20 reconnection attempts, 1000ms delay growing to 5000ms,
 *  - **re-emit `authenticate` on every connect**, because room memberships are
 *    lost whenever the connection drops.
 */
import { io, type Socket } from 'socket.io-client';
import {
  messageFromJson,
  chatFromJson,
  userFromJson,
  type Chat,
  type Message,
  type MessageType,
  type User,
} from '@chatgram/core';

export interface RealtimeHandlers {
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onAuthError?: (message: string) => void;
  onMessageNew?: (message: Message) => void;
  onMessageDelivered?: (payload: { messageId: string; chatId: string; userId: string }) => void;
  onMessageRead?: (payload: { chatId: string; userId: string; all?: boolean }) => void;
  onMessageError?: (payload: { message: string; clientId?: string }) => void;
  onTyping?: (payload: { chatId: string; userId: string; isTyping: boolean }) => void;
  onPresence?: (payload: { userId: string; isOnline: boolean; lastSeen?: string }) => void;
  onChatNew?: (chat: Chat) => void;
  onChatUpdated?: (chat: Chat) => void;
  onChatRemoved?: (chatId: string) => void;
  onUserUpdated?: (user: User) => void;
  onMessageReaction?: (payload: {
    messageId: string;
    chatId: string;
    reactions: { userId: string; emoji: string }[];
  }) => void;
  onMessageDeleted?: (payload: { messageId: string; chatId: string; scope: string }) => void;
  /** The sender edited the text of a message. */
  onMessageEdited?: (payload: { messageId: string; chatId: string; content: string; editedAt: string }) => void;
  /** WebRTC call signalling (1:1 and group, voice and video). */
  onCallIncoming?: (payload: CallIncoming) => void;
  onCallRinging?: (payload: CallRinging) => void;
  /** I joined a call: connect to everyone already in it. */
  onCallJoined?: (payload: CallJoined) => void;
  onCallParticipantJoined?: (payload: CallParticipantJoined) => void;
  onCallParticipantLeft?: (payload: CallParticipantLeft) => void;
  onCallParticipantDeclined?: (payload: CallParticipantDeclined) => void;
  onCallParticipantInvited?: (payload: CallParticipantInvited) => void;
  /** Relayed media-state signal (mute/camera/screen/incoming-video-off). */
  onCallSignal?: (payload: CallSignalEvent) => void;
  /** Per-participant media state snapshot from the server. */
  onCallParticipantState?: (payload: CallParticipantState) => void;
  onCallOffer?: (payload: CallOffer) => void;
  onCallAnswer?: (payload: CallAnswer) => void;
  onCallIce?: (payload: CallIce) => void;
  /** The whole call is over (missed, declined, failed, cancelled, ended). */
  onCallEnded?: (payload: CallEnd) => void;
  onCallUnavailable?: (payload: CallUnavailable) => void;
  onCallBusy?: (payload: CallBusy) => void;
  onCallAnsweredElsewhere?: (payload: CallAnsweredElsewhere) => void;
  onCallError?: (payload: { message: string; code?: string; capacity?: number; audioOnlyAvailable?: boolean }) => void;
  /** Live room snapshot for this chat (banner / call card "Join"). */
  onCallRoom?: (room: CallRoomUpdate) => void;
  /** The persisted call card message changed state (started/ongoing/ended). */
  onCallCardUpdated?: (payload: { chatId: string; messageId: string; call: Record<string, unknown> }) => void;
  /** A group member list changed (add/remove/leave/promote). */
  onGroupMembers?: (payload: { chatId: string }) => void;
  /** Somebody @mentioned me in a group. */
  onMessageMention?: (payload: {
    message: Message;
    chatId: string;
    groupName: string;
    chatType: string;
  }) => void;
}

/** A person taking part in a call (or being rung by one). */
export interface CallParticipantInfo extends CallParticipantStateFields {
  id: string;
  displayName?: string;
  avatarUrl?: string | null;
}

/** Somebody rang me. Carries no SDP: offers arrive per peer once I accept. */
export interface CallIncoming {
  callId: string;
  chatId: string;
  video: boolean;
  /** True when the call belongs to a group chat (multi-party). */
  isGroup: boolean;
  /** Group name, or the caller's display name for a direct call. */
  title: string;
  /** How many people are being rung, including the caller. */
  participantCount: number;
  /** Participant cap for this call type (6 video / 12 audio). */
  capacity?: number;
  from: CallParticipantInfo;
  /** Everyone already in the room (with their media state). */
  participants?: CallParticipantInfo[];
  startedAt?: string | number | null;
  state?: string;
  /** The chat message that represents this call (persisted call card). */
  cardMessageId?: string | null;
}

/** My outgoing call is now ringing on at least one device. */
export interface CallRinging {
  callId: string;
  chatId: string;
  video: boolean;
  isGroup: boolean;
  title: string;
  participants: CallParticipantInfo[];
  ringCount: number;
  /** Participant cap for this call type (6 video / 12 audio). */
  capacity?: number;
  busyCount?: number;
}

/** The callee was already on another call. */
export interface CallBusy {
  callId: string;
  chatId?: string;
  message?: string;
}

/** The callee answered on another tab/device. */
export interface CallAnsweredElsewhere {
  callId: string;
}

/** I accepted/joined and am now in the call; these people are already connected. */
export interface CallJoined {
  callId: string;
  chatId: string;
  video: boolean;
  isGroup: boolean;
  title: string;
  participants: CallParticipantInfo[];
  startedAt?: string | number | null;
  capacity?: number;
}

export interface CallParticipantJoined {
  callId: string;
  participant: CallParticipantInfo;
  /** Every participant in the room after the change. */
  participants?: CallParticipantInfo[];
}

export interface CallParticipantLeft {
  callId: string;
  userId: string;
  reason: string;
  participants?: CallParticipantInfo[];
}

export interface CallParticipantDeclined {
  callId: string;
  userId: string;
  isGroup: boolean;
  participants?: CallParticipantInfo[];
}

export interface CallAnswer {
  callId: string;
  from: CallParticipantInfo;
  sdp: unknown;
}

export interface CallOffer {
  callId: string;
  from: CallParticipantInfo;
  sdp: unknown;
}

export interface CallIce {
  callId: string;
  from?: CallParticipantInfo;
  candidate: unknown;
  /** Older servers ride signals on call:ice; kept for compatibility. */
  signal?: CallSignalInfo;
}

export interface CallEnd {
  callId: string;
  chatId?: string;
  reason: string;
  status?: string;
  durationSeconds?: number;
  participants?: CallParticipantInfo[];
}

export interface CallUnavailable {
  callId: string;
  chatId: string;
  isGroup: boolean;
}

/** Media-state fields the server tracks for every call participant. */
export interface CallParticipantStateFields {
  audioOnly?: boolean;
  muted?: boolean;
  cameraOn?: boolean;
  screenSharing?: boolean;
  sharingKind?: 'screen' | 'window' | 'browser';
  hasSystemAudio?: boolean;
  /** This participant asked not to receive video (audio-only reception). */
  incomingVideoOff?: boolean;
}

/** A live room snapshot broadcast to the whole chat (banner + call card). */
export interface CallRoomUpdate {
  chatId: string;
  callId: string | null;
  state: 'ringing' | 'active' | 'ended';
  status: 'ringing' | 'completed' | 'missed' | 'declined' | 'busy' | 'failed' | 'cancelled';
  video: boolean;
  mode: 'voice' | 'video';
  isGroup: boolean;
  title: string;
  startedBy: { id: string; displayName: string; avatarUrl?: string | null } | null;
  startedAt: string | number | null;
  answeredAt: string | number | null;
  endedAt: string | number | null;
  durationSeconds: number;
  participants: CallParticipantInfo[];
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

export interface CallSignalInfo {
  kind: string;
  muted?: boolean;
  cameraOn?: boolean;
  screenSharing?: boolean;
  sharingKind?: 'screen' | 'window' | 'browser';
  hasSystemAudio?: boolean;
  off?: boolean;
}

export interface CallSignalEvent {
  callId: string;
  from?: CallParticipantInfo;
  signal?: CallSignalInfo;
}

export interface CallParticipantState {
  callId?: string;
  participant: CallParticipantInfo;
}

export interface CallParticipantInvited {
  callId: string;
  participant: CallParticipantInfo;
  participants?: CallParticipantInfo[];
}

export interface RealtimeOptions {
  url: string;
  token: string;
  handlers?: RealtimeHandlers;
}

export class RealtimeClient {
  private socket: Socket | null = null;
  private token = '';
  private handlers: RealtimeHandlers = {};

  connect(options: RealtimeOptions): void {
    this.token = options.token;
    this.handlers = options.handlers ?? {};

    if (this.socket?.connected) {
      // Already live — just make sure the server knows the current identity.
      this.socket.emit('authenticate', this.token);
      return;
    }

    this.socket?.disconnect();
    this.socket = io(options.url, {
      auth: { token: options.token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.bind();
  }

  /** Send a call signalling event through the authenticated socket. */
  emit(event: string, payload: unknown): void {
    this.socket?.emit(event, payload);
  }

  /** True while the underlying socket is connected. */
  isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  private bind(): void {
    const socket = this.socket;
    if (!socket) return;
    const h = this.handlers;

    socket.on('connect', () => {
      // Rooms are lost on reconnect, so always re-authenticate.
      socket.emit('authenticate', this.token);
      h.onConnected?.();
    });

    socket.on('disconnect', (reason: string) => h.onDisconnected?.(reason));
    socket.on('connect_error', (error: Error) => h.onDisconnected?.(error.message));

    socket.on('authenticated', () => h.onConnected?.());
    socket.on('auth_error', (data: { message?: string }) =>
      h.onAuthError?.(data?.message ?? 'Invalid token'),
    );

    socket.on('message:new', (data: unknown) => h.onMessageNew?.(messageFromJson(data)));
    socket.on('message:delivered', (data: RealtimeHandlers extends never ? never : { messageId: string; chatId: string; userId: string }) =>
      h.onMessageDelivered?.(data),
    );
    socket.on('message:read', (data: { chatId: string; userId: string; all?: boolean }) =>
      h.onMessageRead?.(data),
    );
    socket.on('message:error', (data: { message: string; clientId?: string }) =>
      h.onMessageError?.(data),
    );

    socket.on('typing:start', (data: { chatId: string; userId: string }) =>
      h.onTyping?.({ ...data, isTyping: true }),
    );
    socket.on('typing:stop', (data: { chatId: string; userId: string }) =>
      h.onTyping?.({ ...data, isTyping: false }),
    );

    socket.on('presence:online', (data: { userId: string }) =>
      h.onPresence?.({ userId: data.userId, isOnline: true }),
    );
    socket.on('presence:offline', (data: { userId: string; lastSeen?: string }) =>
      h.onPresence?.({ userId: data.userId, isOnline: false, lastSeen: data.lastSeen }),
    );

    socket.on('chat:new', (data: unknown) => h.onChatNew?.(chatFromJson(data)));
    socket.on('chat:updated', (data: unknown) => h.onChatUpdated?.(chatFromJson(data)));
    socket.on('chat:removed', (data: { chatId: string }) => h.onChatRemoved?.(data.chatId));

    socket.on('user:updated', (data: unknown) => h.onUserUpdated?.(userFromJson(data)));

    socket.on('message:reaction', (data: { messageId: string; chatId: string; reactions: { userId: string; emoji: string }[] }) =>
      h.onMessageReaction?.(data),
    );
    socket.on('message:deleted', (data: { messageId: string; chatId: string; scope: string }) =>
      h.onMessageDeleted?.(data),
    );
    socket.on('group:members', (data: { chatId: string }) => h.onGroupMembers?.(data));
    socket.on('message:edited', (data: { messageId: string; chatId: string; content: string; editedAt: string }) =>
      h.onMessageEdited?.(data),
    );
    socket.on('call:incoming', (data: CallIncoming) => h.onCallIncoming?.(data));
    socket.on('call:ringing', (data: CallRinging) => h.onCallRinging?.(data));
    socket.on('call:joined', (data: CallJoined) => h.onCallJoined?.(data));
    socket.on('call:participant-joined', (data: CallParticipantJoined) => h.onCallParticipantJoined?.(data));
    socket.on('call:participant-left', (data: CallParticipantLeft) => h.onCallParticipantLeft?.(data));
    socket.on('call:participant-declined', (data: CallParticipantDeclined) => h.onCallParticipantDeclined?.(data));
    socket.on('call:participant-invited', (data: CallParticipantInvited) => h.onCallParticipantInvited?.(data));
    socket.on('call:participant-state', (data: CallParticipantState) => h.onCallParticipantState?.(data));
    socket.on('call:signal', (data: CallSignalEvent) => h.onCallSignal?.(data));
    socket.on('call:offer', (data: CallOffer) => h.onCallOffer?.(data));
    socket.on('call:answer', (data: CallAnswer) => h.onCallAnswer?.(data));
    socket.on('call:ice', (data: CallIce) => h.onCallIce?.(data));
    socket.on('call:room', (data: CallRoomUpdate) => h.onCallRoom?.(data));
    socket.on('call:card-updated', (data: { chatId: string; messageId: string; call: Record<string, unknown> }) =>
      h.onCallCardUpdated?.(data),
    );
    socket.on('call:ended', (data: CallEnd) => h.onCallEnded?.(data));
    socket.on('call:end', (data: CallEnd) => h.onCallEnded?.(data));
    socket.on('call:unavailable', (data: CallUnavailable) => h.onCallUnavailable?.(data));
    socket.on('call:busy', (data: CallBusy) => h.onCallBusy?.(data));
    socket.on('call:answered-elsewhere', (data: CallAnsweredElsewhere) => h.onCallAnsweredElsewhere?.(data));
    socket.on('call:error', (data: { message: string; code?: string; capacity?: number; audioOnlyAvailable?: boolean }) =>
      h.onCallError?.(data),
    );
    socket.on('message:mention', (data: unknown) => {
      const payload = (data ?? {}) as {
        message?: unknown;
        chatId?: string;
        groupName?: string;
        chatType?: string;
      };
      h.onMessageMention?.({
        message: messageFromJson(payload.message),
        chatId: String(payload.chatId ?? ''),
        groupName: String(payload.groupName ?? 'Group'),
        chatType: String(payload.chatType ?? 'group'),
      });
    });
  }

  get connected(): boolean {
    return this.socket?.connected === true;
  }

  joinChat(chatId: string): void {
    this.socket?.emit('chat:join', { chatId });
  }

  leaveChat(chatId: string): void {
    this.socket?.emit('chat:leave', { chatId });
  }

  sendMessage(input: {
    chatId: string;
    type?: MessageType;
    content?: string;
    mediaUrl?: string;
    clientId?: string;
  }): void {
    this.socket?.emit('message:send', { type: 'text', ...input });
  }

  markDelivered(messageId: string): void {
    this.socket?.emit('message:delivered', { messageId });
  }

  markRead(messageId: string): void {
    this.socket?.emit('message:read', { messageId });
  }

  markChatRead(chatId: string): void {
    this.socket?.emit('message:read', { chatId });
  }

  typingStart(chatId: string): void {
    this.socket?.emit('typing:start', { chatId });
  }

  typingStop(chatId: string): void {
    this.socket?.emit('typing:stop', { chatId });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  /** Manual "Retry" from the reconnect bar: reconnect the existing socket. */
  reconnect(): void {
    this.socket?.connect();
  }
}
