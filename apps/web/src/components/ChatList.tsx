import { useMemo, useState } from 'react';
import { Search, SquarePen, Check, CheckCheck } from 'lucide-react';
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
  online,
  timeFormat,
  onSelect,
  onNewChat,
}: {
  chats: Chat[];
  meId: string;
  selectedId: string | null;
  typingByChat: Record<string, string | null>;
  online: Record<string, boolean>;
  timeFormat: TimeFormat;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}) {
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
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-200 px-3 py-2.5 dark:border-white/10">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-bold">Chats</h2>
          <span className="flex-1" />
          <button type="button" className="btn-primary !px-2.5" onClick={onNewChat} title="New chat">
            <SquarePen className="h-4 w-4" />
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

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="p-4 text-sm text-ink-600 dark:text-ink-300">
            {query ? 'No matches.' : 'No conversations yet.'}
          </p>
        ) : null}

        {visible.map((chat) => {
          const partner = chatPartner(chat, meId);
          const onlineNow = partner ? (online[partner.id] ?? partner.isOnline ?? false) : false;
          const unread = chat.unreadCount ?? 0;
          const typing = Boolean(typingByChat[chat.id]);
          const last = chat.lastMessage;
          const mine = last ? last.senderId === meId : false;
          const preview = typing ? 'typing…' : previewText(last, meId);
          const delivered = last ? last.deliveredTo.length > 0 : false;
          const read = last ? last.readBy.length > 0 : false;

          return (
            <button
              key={chat.id}
              type="button"
              onClick={() => onSelect(chat.id)}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
                chat.id === selectedId
                  ? 'bg-brand-600/10 dark:bg-white/[.07]'
                  : 'hover:bg-ink-100/70 dark:hover:bg-white/[.04]'
              }`}
            >
              <div className="relative shrink-0">
                <div
                  className={`grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-gradient-to-br ${avatarGradient(
                    partner?.id ?? chat.id,
                  )} text-xs font-bold text-white`}
                >
                  {partner?.avatarUrl ? (
                    <img src={partner.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initialsFor(chat.type === 'group' ? chat.groupName : chatTitle(chat, meId))
                  )}
                </div>
                {onlineNow ? (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-ink-900" />
                ) : null}
              </div>

              <div className="min-w-0 flex-1">
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
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
