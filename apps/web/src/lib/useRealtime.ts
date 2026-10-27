import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePrefs, useRealtime, useSession, type Message } from '@chatgram/core';
import { callCardFromJson } from '@chatgram/core';
import { playMessageSound, showNotification } from './notify';
import { api, realtime, SOCKET_URL } from './api';
import {
  handleAnswer,
  handleAnsweredElsewhere,
  handleBusy,
  handleCallError,
  handleCallSignal,
  handleEnded,
  handleIce,
  handleIncoming,
  handleJoined,
  handleOffer,
  handleParticipantDeclined,
  handleParticipantInvited,
  handleParticipantJoined,
  handleParticipantLeft,
  handleParticipantState,
  handleRoom,
  handleUnavailable,
  seedCallRooms,
} from './calls';

/**
 * Bridges the socket connection into React state.
 *
 * Server data lives in TanStack Query; ephemeral flags (presence, typing,
 * connected) live in Zustand. This hook is the only place that writes from the
 * socket into both, so the data flow stays one-directional and debuggable.
 */
export function useRealtimeBridge(): void {
  const queryClient = useQueryClient();
  const user = useSession((s) => s.user);
  const setConnected = useRealtime((s) => s.setConnected);
  const setOnline = useRealtime((s) => s.setOnline);
  const clearOnline = useRealtime((s) => s.clearOnline);
  const setTyping = useRealtime((s) => s.setTyping);
  const notifications = usePrefs((s) => s.notifications);
  const sounds = usePrefs((s) => s.sounds);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return undefined;
    const token = api.accessToken;
    if (!token) return undefined;

    realtime.connect({
      url: SOCKET_URL,
      token,
      handlers: {
        onConnected: () => {
          setConnected(true);
          // Re-sync presence snapshots after a reconnect or a cold start.
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
          void queryClient.invalidateQueries({ queryKey: ['contacts'] });
          // Seed live call banners: the server broadcasts rooms on authenticate,
          // the REST snapshot covers a reconnect that missed that broadcast.
          void api
            .callState()
            .then((result) => seedCallRooms(result.calls ?? []))
            .catch(() => undefined);
        },
        onDisconnected: () => {
          // Presence is unknown while we are offline: drop every cached value
          // instead of leaving green dots behind on a dead connection.
          setConnected(false);
          clearOnline();
        },

        onMessageNew: (message: Message) => {
          const hadCache = Boolean(queryClient.getQueryData<Message[]>(['messages', message.chatId]));
          queryClient.setQueryData<Message[]>(['messages', message.chatId], (prev) => {
            if (!prev) return prev;
            // Reconcile the optimistic bubble by clientId when present.
            if (message.clientId) {
              const idx = prev.findIndex((m) => m.clientId === message.clientId);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = message;
                return next;
              }
            }
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
          // The conversation was not open yet (or its first page was still
          // loading) — fetch the full history instead of dropping the event.
          if (!hadCache) {
            void queryClient.invalidateQueries({ queryKey: ['messages', message.chatId] });
          }
          // Notify only when the window is not in the foreground, so we never
          // interrupt someone reading the conversation. A call card never makes
          // a sound or raises a notification: the ring/call UI is the alert.
          if (message.senderId !== userId && message.type !== 'call') {
            const focused = document.visibilityState === 'visible' && document.hasFocus();
            if (!focused) {
              if (sounds) playMessageSound();
              if (notifications) {
                const body =
                  message.content ||
                  (message.type === 'image' ? 'Photo' : message.type === 'video' ? 'Video' : message.type === 'audio' ? 'Voice message' : message.type === 'file' ? 'Document' : 'New message');
                // The sender's name is the title ("Aline: hey"), so a locked phone
                // shows who wrote and the tap opens that conversation.
                showNotification(
                  message.sender?.displayName || 'New message',
                  body,
                  () => window.focus(),
                  message.chatId,
                );
              }
            }
          }
          // Unread counts and last-message previews come from the server.
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
        },

        onMessageDelivered: ({ messageId, chatId, userId: target }) => {
          queryClient.setQueryData<Message[]>(['messages', chatId], (prev) =>
            (prev ?? []).map((m) =>
              m.id === messageId && !m.deliveredTo.includes(target)
                ? { ...m, deliveredTo: [...m.deliveredTo, target] }
                : m,
            ),
          );
        },

        onMessageRead: ({ chatId, userId: reader, all }) => {
          queryClient.setQueryData<Message[]>(['messages', chatId], (prev) =>
            (prev ?? []).map((m) => {
              if (m.senderId === reader) return m;
              // A private AI message is not visible to this reader: the receipt
              // must not be attached to it (it would look like they read it).
              if ((m.visibleTo?.length ?? 0) > 0 && !m.visibleTo?.includes(reader)) return m;
              if (!all && m.readBy.includes(reader)) return m;
              if (m.readBy.includes(reader)) return m;
              return { ...m, readBy: [...m.readBy, reader] };
            }),
          );
        },

        /** The server rejected a send (blocked, admins-only group, …).
         * Drop the optimistic bubble by refetching the conversation. */
        onMessageError: () => {
          void queryClient.invalidateQueries({ queryKey: ['messages'] });
        },

        /** The sender edited a message: patch every open copy. */
        onMessageEdited: ({ messageId, chatId, content, editedAt }) => {
          queryClient.setQueryData<Message[]>(['messages', chatId], (prev) =>
            (prev ?? []).map((message) =>
              message.id === messageId ? { ...message, content, editedAt } : message,
            ),
          );
        },

        onTyping: ({ chatId, userId: typingId, isTyping }) => {          if (typingId === userId) return;
          setTyping(chatId, isTyping ? typingId : null);
        },

        onPresence: ({ userId: presenceId, isOnline }) => {
          setOnline(presenceId, isOnline);
        },

        onChatNew: () => {
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
          void queryClient.invalidateQueries({ queryKey: ['groups'] });
        },
        onChatUpdated: () => {
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
          void queryClient.invalidateQueries({ queryKey: ['groups'] });
          void queryClient.invalidateQueries({ queryKey: ['group-members'] });
        },
        onChatRemoved: () => {
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
          void queryClient.invalidateQueries({ queryKey: ['groups'] });
        },

        onGroupMembers: ({ chatId }) => {
          void queryClient.invalidateQueries({ queryKey: ['group-members', chatId] });
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
          void queryClient.invalidateQueries({ queryKey: ['groups'] });
        },

        onMessageMention: ({ message, chatId, groupName }) => {
          // Mention notifications fire even when the window is focused: being
          // named is the point of a mention.
          if (sounds) playMessageSound();
          if (notifications) {
            showNotification(
              `${groupName}: you were mentioned`,
              message.content || 'You were mentioned in a group',
              () => window.focus(),
              chatId,
            );
          }
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
          void queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
        },

        // ------------------------------------------- WebRTC calls (group+1:1)
        onCallIncoming: (payload) => handleIncoming(payload),
        onCallJoined: (payload) => handleJoined(payload),
        onCallParticipantJoined: (payload) => handleParticipantJoined(payload),
        onCallParticipantLeft: (payload) => handleParticipantLeft(payload),
        onCallParticipantDeclined: (payload) => handleParticipantDeclined(payload),
        onCallParticipantInvited: (payload) => handleParticipantInvited(payload),
        onCallParticipantState: (payload) => handleParticipantState(payload),
        onCallSignal: (payload) => handleCallSignal(payload),
        onCallRoom: (room) => handleRoom(room),
        onCallCardUpdated: ({ chatId, messageId, call }) => {
          const next = callCardFromJson(call);
          // Patch the persisted call card message in place (never refetch).
          queryClient.setQueryData<Message[]>(['messages', chatId], (prev) =>
            (prev ?? []).map((message) =>
              message.id === messageId ? { ...message, call: next ?? message.call } : message,
            ),
          );
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
        },
        onCallOffer: (payload) => void handleOffer(payload),
        onCallAnswer: (payload) => void handleAnswer(payload),
        onCallIce: (payload) => void handleIce(payload),
        onCallEnded: (payload) => handleEnded(payload),
        onCallUnavailable: (payload) => handleUnavailable(payload),
        onCallBusy: (payload) => handleBusy(payload),
        onCallAnsweredElsewhere: (payload) => handleAnsweredElsewhere(payload),
        onCallError: (payload) => handleCallError(payload.message, payload.code, payload),

        onUserUpdated: (updated) => {
          // The signed-in user may have changed their own profile elsewhere.
          if (updated.id === userId) {
            useSession.getState().patchUser(updated);
          }
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
        },
      },
    });

    // Presence heartbeat: the server drops a socket that has not pinged for
    // PRESENCE_STALE_MS (60s in production), which keeps a dead tab or a
    // sleeping phone from holding this user 'online' forever.
    const heartbeat = window.setInterval(() => {
      if (realtime.isConnected()) realtime.emit('presence:ping', {});
    }, 25_000);
    // Also run immediately so a freshly connected client is never stale.
    if (realtime.isConnected()) realtime.emit('presence:ping', {});

    return () => {
      window.clearInterval(heartbeat);
      realtime.disconnect();
      setConnected(false);
      clearOnline();
    };
  }, [userId, queryClient, setConnected, setOnline, setTyping, notifications, sounds]);
}
