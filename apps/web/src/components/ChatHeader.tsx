import { useState } from 'react';
import { Search, Phone, MoreVertical, User, BellOff, Trash2, Ban, ChevronLeft, X } from 'lucide-react';
import type { Chat, User as ChatUser } from '@chatgram/core';
import { chatTitle } from '@chatgram/core';
import { avatarGradient, initialsFor, lastSeenLabel, type TimeFormat } from '../lib/ui';

export interface HeaderMenuActions {
  onContactInfo: () => void;
  onMute: () => void;
  onForward?: () => void;
  onClearChat: () => void;
  onBlock: () => void;
}

/**
 * Conversation header.
 *
 * Per the brief there is no persistent connection icon: a "Reconnecting…"
 * line appears only while the socket is down.
 */
export function ChatHeader({
  chat,
  meId,
  partner,
  typing,
  online,
  connected,
  timeFormat,
  inChatSearchOpen,
  onToggleSearch,
  onCall,
  menu,
  onBack,
}: {
  chat: Chat;
  meId: string;
  partner: ChatUser | undefined;
  typing: boolean;
  online: boolean;
  connected: boolean;
  timeFormat: TimeFormat;
  inChatSearchOpen: boolean;
  onToggleSearch: () => void;
  onCall: () => void;
  menu: HeaderMenuActions;
  onBack: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = chatTitle(chat, meId);

  const subtitle = !connected
    ? 'Reconnecting…'
    : typing
      ? 'typing…'
      : chat.type === 'group'
        ? `${chat.participants.length} members`
        : online
          ? 'online'
          : lastSeenLabel(partner?.lastSeen, timeFormat);

  return (
    <header className="relative flex items-center gap-3 border-b border-ink-200 px-3 py-2.5 dark:border-white/10">
      <button type="button" className="btn-ghost !px-2 lg:hidden" onClick={onBack} title="Back">
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div
        className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br ${avatarGradient(
          partner?.id ?? chat.id,
        )} text-xs font-bold text-white`}
      >
        {partner?.avatarUrl ? (
          <img src={partner.avatarUrl} alt={title} className="h-full w-full object-cover" />
        ) : (
          initialsFor(chat.type === 'group' ? chat.groupName : title)
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold leading-tight">{title}</p>
        <p
          className={`truncate text-[12.5px] leading-tight ${
            !connected
              ? 'font-semibold text-amber-500'
              : typing
                ? 'font-semibold text-brand-600 dark:text-brand-300'
                : 'text-ink-600 dark:text-ink-300'
          }`}
        >
          {subtitle}
        </p>
      </div>

      <button type="button" className="btn-ghost !px-2" title="Search in chat" onClick={onToggleSearch}>
        {inChatSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
      </button>
      <button type="button" className="btn-ghost !px-2" title="Call" onClick={onCall}>
        <Phone className="h-5 w-5" />
      </button>
      <button
        type="button"
        className="btn-ghost !px-2"
        title="More"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {menuOpen ? (
        <div className="absolute right-3 top-14 z-30 w-48 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-ink-700">
          {[
            { label: 'Contact info', Icon: User, run: menu.onContactInfo },
            { label: 'Mute notifications', Icon: BellOff, run: menu.onMute },
            { label: 'Clear chat', Icon: Trash2, run: menu.onClearChat },
            { label: 'Block contact', Icon: Ban, run: menu.onBlock, danger: true },
          ].map(({ label, Icon, run, danger }) => (
            <button
              key={label}
              type="button"
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10 ${
                danger ? 'text-rose-600' : ''
              }`}
              onClick={() => {
                run();
                setMenuOpen(false);
              }}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
