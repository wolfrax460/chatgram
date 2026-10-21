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
}
