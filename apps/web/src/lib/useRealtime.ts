import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRealtime, useSession, type Message } from '@chatgram/core';
import { api, realtime, SOCKET_URL } from './api';

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
  const setTyping = useRealtime((s) => s.setTyping);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return undefined;
    const token = api.accessToken;
    if (!token) return undefined;

    realtime.connect({
      url: SOCKET_URL,
      token,
      handlers: {
        onConnected: () => setConnected(true),
        onDisconnected: () => setConnected(false),

        onMessageNew: (message: Message) => {
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
          // Unread counts and last-message previews come from the server.
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
        },

        onTyping: ({ chatId, userId: typingId, isTyping }) => {
          if (typingId === userId) return;
          setTyping(chatId, isTyping ? typingId : null);
        },

        onPresence: ({ userId: presenceId, isOnline }) => {
          setOnline(presenceId, isOnline);
        },

        onChatNew: () => void queryClient.invalidateQueries({ queryKey: ['chats'] }),
        onChatUpdated: () => void queryClient.invalidateQueries({ queryKey: ['chats'] }),
        onChatRemoved: () => void queryClient.invalidateQueries({ queryKey: ['chats'] }),

        onUserUpdated: (updated) => {
          // The signed-in user may have changed their own profile elsewhere.
          if (updated.id === userId) {
            useSession.getState().patchUser(updated);
          }
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
        },
      },
    });

    return () => {
      realtime.disconnect();
      setConnected(false);
    };
  }, [userId, queryClient, setConnected, setOnline, setTyping]);
}
