import { onlineNow, usePresenceView } from '../lib/presence';
import { useMemo, useState } from 'react';
import { Search, UserRoundPlus, Check, CheckCheck, Sparkles } from 'lucide-react';
import type { Chat } from '@chatgram/core';
import { chatTitle, chatPartner } from '@chatgram/core';
import { avatarGradient, formatTime, initialsFor, previewText, type TimeFormat } from '../lib/ui';

/**
 * Conversation list: search, compose button, unread badges, "You:"/tick
 * previews, stable per-contact avatar colours and recency sorting.
 */
export function ChatList({
  chats,
  meId,
  selectedId,
  typingByChat,
  timeFormat,
  onSelect,
  onNewChat,
  onOpenProfile,
  onAskAi,
}: {
  chats: Chat[];
  meId: string;
  selectedId: string | null;
  typingByChat: Record<string, string | null>;
  timeFormat: TimeFormat;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  /** Open a direct chat partner's profile from their avatar. */
  onOpenProfile?: (userId: string, chatId: string) => void;
  /** Send the search text to Chatgram AI (WhatsApp-style "Ask Meta AI" row). */
  onAskAi?: (text: string) => void;
}) {
  const presenceView = usePresenceView();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const sorted = [...chats].sort((a, b) => {
      const at = a.lastMessage?.sentAt ?? a.updatedAt ?? '';
      const bt = b.lastMessage?.sentAt ?? b.updatedAt ?? '';
      return new Date(bt).getTime() - new Date(at).getTime();
    });
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => chatTitle(c, meId).toLowerCase().includes(q));
  }, [chats, meId, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-ink-200 px-3 py-2.5 dark:border-white/10">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-bold">Chats</h2>
          <span className="flex-1" />
          <button type="button" className="btn-primary !px-2.5" onClick={onNewChat} title="New chat or contact" aria-label="New chat or contact">
            <UserRoundPlus className="h-4 w-4" />
          </button>
        </div>
        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-500 dark:text-ink-400" />
          <input
            className="field pl-9"
            placeholder="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.trim() && onAskAi ? (
          <button
            type="button"
            data-testid="ask-ai-row"
            onClick={() => onAskAi(query.trim())}
            className="flex w-full items-center gap-3 border-b border-ink-200 px-3 py-2.5 text-left hover:bg-ink-100/70 dark:border-white/10 dark:hover:bg-white/[.04]"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white"><Sparkles className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Ask Chatgram AI</span>
              <span className="block truncate text-[12.5px] text-ink-500 dark:text-ink-300">"{query.trim().slice(0, 70)}"</span>
            </span>
          </button>
        ) : null}

        {visible.length === 0 ? (
          <p className="p-4 text-sm text-ink-600 dark:text-ink-300">
            {query ? 'No chat matches — try the Chatgram AI row above.' : 'No conversations yet.'}
          </p>
        ) : null}

        {visible.map((chat) => {
          const partner = chatPartner(chat, meId);
          const isGroup = chat.type === 'group';
          const avatarUrl = isGroup ? chat.groupAvatarUrl : partner?.avatarUrl;
          const partnerOnline = !isGroup && onlineNow(presenceView, partner?.id, partner?.isOnline);
          const unread = chat.unreadCount ?? 0;
          const typing = Boolean(typingByChat[chat.id]);
          const last = chat.lastMessage;
          const mine = last ? last.senderId === meId : false;
          const preview = typing ? 'typing…' : previewText(last, meId);
          // readBy/deliveredTo include the sender, so only OTHER participants count.
          const others = chat.participants.filter((participant) => participant.id !== meId).map((participant) => participant.id);
          const delivered = last ? last.deliveredTo.some((id) => others.includes(id)) : false;
          const read = last ? last.readBy.some((id) => others.includes(id)) : false;

          return (
            <div
              key={chat.id}
              className={`flex w-full items-center gap-3 px-3 py-2.5 transition ${
                chat.id === selectedId
                  ? 'bg-brand-600/10 dark:bg-white/[.07]'
                  : 'hover:bg-ink-100/70 dark:hover:bg-white/[.04]'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  !isGroup && partner && onOpenProfile ? onOpenProfile(partner.id, chat.id) : onSelect(chat.id)
                }
                className="relative shrink-0 rounded-full"
                title={!isGroup && partner ? `Open ${partner.displayName}'s profile` : 'Open chat'}
                aria-label={!isGroup && partner ? `Open ${partner.displayName}'s profile` : undefined}
                data-testid="chat-list-avatar"
              >
                <div
                  className={`grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-gradient-to-br ${avatarGradient(
                    isGroup ? chat.id : partner?.id ?? chat.id,
                  )} text-xs font-bold text-white`}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initialsFor(isGroup ? chat.groupName : chatTitle(chat, meId))
                  )}
                </div>
                {partnerOnline ? (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-ink-900" />
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => onSelect(chat.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{chatTitle(chat, meId)}</span>
                  <span className="shrink-0 text-[11px] text-ink-600 dark:text-ink-300">
                    {formatTime(last?.sentAt ?? chat.updatedAt, timeFormat)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  {typing ? (
                    <span className="truncate text-[12.5px] font-medium text-brand-600 dark:text-brand-300">typing…</span>
                  ) : (
                    <>
                      {mine && last ? (
                        read ? (
                          <CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#53bdeb]" />
                        ) : delivered ? (
                          <CheckCheck className="h-3.5 w-3.5 shrink-0 text-ink-500 dark:text-ink-400" />
                        ) : (
                          <Check className="h-3.5 w-3.5 shrink-0 text-ink-500 dark:text-ink-400" />
                        )
                      ) : null}
                      <span className="truncate text-[12.5px] text-ink-600 dark:text-ink-300">{preview}</span>
                    </>
                  )}
                  {unread > 0 ? (
                    <span className="ml-auto grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  ) : null}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
