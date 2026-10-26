import { useState } from 'react';
import {
  Search, Phone, Video, MoreVertical, User, BellOff, Trash2, Ban, ChevronLeft, X, History, Plus, Pin,
} from 'lucide-react';
import type { Chat, User as ChatUser } from '@chatgram/core';
import { chatTitle } from '@chatgram/core';
import { avatarGradient, initialsFor, lastSeenLabel, type TimeFormat } from '../lib/ui';

export interface HeaderMenuActions {
  onContactInfo?: () => void;
  onMute?: () => void;
  onForward?: () => void;
  onClearChat?: () => void;
  onBlock?: () => void;
  /** Chatgram AI conversation menu (Change 1). */
  onNewConversation?: () => void;
  onHistory?: () => void;
  onSearch?: () => void;
  onPin?: () => void;
  pinned?: boolean;
}

export interface AiHeaderInfo {
  title: string;
  /** The small subtitle under the name, e.g. "AI". */
  subtitle: string;
  avatarUrl: string;
  /** Show "Chatgram AI is typing…" instead of the subtitle. */
  typing?: boolean;
}

/**
 * Conversation header, shared by people and by the Chatgram AI thread.
 *
 * Per the brief there is no persistent connection icon: a "Reconnecting…"
 * line appears only while the socket is down. The AI thread passes `ai`, which
 * renders its own avatar/title/subtitle and hides the call buttons (an AI
 * conversation cannot be called), exactly like Meta AI in WhatsApp.
 */
export function ChatHeader({
  chat,
  meId,
  partner,
  typing = false,
  online = false,
  connected,
  timeFormat,
  inChatSearchOpen,
  onToggleSearch,
  onOpenProfile,
  onCall,
  onVideoCall,
  menu,
  onBack,
  ai,
}: {
  chat?: Chat;
  meId?: string;
  partner?: ChatUser;
  typing?: boolean;
  online?: boolean;
  connected: boolean;
  timeFormat: TimeFormat;
  inChatSearchOpen: boolean;
  onToggleSearch: () => void;
  /** Open the profile panel for the other participant. */
  onOpenProfile?: () => void;
  onCall?: () => void;
  onVideoCall?: () => void;
  menu: HeaderMenuActions;
  onBack: () => void;
  ai?: AiHeaderInfo;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = ai ? ai.title : chat ? chatTitle(chat, meId ?? '') : '';
  const aiTyping = Boolean(ai?.typing) || (!ai && typing);

  const subtitle = ai
    ? !connected
      ? 'Reconnecting…'
      : aiTyping
        ? `${ai.title} is typing…`
        : ai.subtitle
    : !connected
      ? 'Reconnecting…'
      : typing
        ? 'typing…'
        : chat?.type === 'group'
          ? `${chat.participants.length} members`
          : online
            ? 'online'
            : lastSeenLabel(partner?.lastSeen, timeFormat);

  type MenuItem = { label: string; Icon: typeof Search; run: () => void; danger?: boolean };

  const menuItems: MenuItem[] = ai
    ? ([
        menu.onNewConversation ? { label: 'New conversation', Icon: Plus, run: menu.onNewConversation } : null,
        menu.onHistory ? { label: 'Previous conversations', Icon: History, run: menu.onHistory } : null,
        menu.onSearch ? { label: 'Search in chat', Icon: Search, run: menu.onSearch } : null,
        menu.onMute ? { label: 'Mute notifications', Icon: BellOff, run: menu.onMute } : null,
        menu.onPin ? { label: menu.pinned === false ? 'Pin chat' : 'Unpin chat', Icon: Pin, run: menu.onPin } : null,
        menu.onClearChat ? { label: 'Clear chat', Icon: Trash2, run: menu.onClearChat } : null,
      ] as (MenuItem | null)[]).filter((item): item is MenuItem => Boolean(item))
    : ([
        menu.onContactInfo ? { label: chat?.type === 'group' ? 'Group info' : 'Contact info', Icon: User, run: menu.onContactInfo } : null,
        menu.onMute ? { label: 'Mute notifications', Icon: BellOff, run: menu.onMute } : null,
        menu.onClearChat ? { label: 'Clear chat', Icon: Trash2, run: menu.onClearChat } : null,
        menu.onBlock ? { label: 'Block contact', Icon: Ban, run: menu.onBlock, danger: true } : null,
      ] as (MenuItem | null)[]).filter((item): item is MenuItem => Boolean(item));

  return (
    <header className="relative flex items-center gap-3 border-b border-ink-200 px-3 py-2.5 dark:border-white/10">
      <button type="button" className="btn-ghost !px-2 lg:hidden" onClick={onBack} title="Back" aria-label="Back">
        <ChevronLeft className="h-5 w-5" />
      </button>

      {ai ? (
        <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-600 text-white">
            <img src={ai.avatarUrl} alt={ai.title} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight" data-testid="ai-header-title">
              {ai.title}
            </p>
            <p
              className={`truncate text-[12.5px] leading-tight ${
                !connected
                  ? 'font-semibold text-amber-500'
                  : aiTyping
                    ? 'font-semibold text-brand-600 dark:text-brand-300'
                    : 'text-ink-600 dark:text-ink-300'
              }`}
              data-testid="ai-header-subtitle"
            >
              {subtitle}
            </p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenProfile}
          disabled={!onOpenProfile}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
          aria-label={onOpenProfile ? (chat?.type === 'group' ? 'Open group info' : `Open ${title}'s profile`) : undefined}
          title={onOpenProfile ? (chat?.type === 'group' ? 'Open group info' : 'Open profile') : undefined}
        >
          <div
            className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br ${avatarGradient(
              partner?.id ?? chat?.id ?? title,
            )} text-xs font-bold text-white`}
          >
            {(chat?.type === 'group' ? chat?.groupAvatarUrl : partner?.avatarUrl) ? (
              <img src={(chat?.type === 'group' ? chat?.groupAvatarUrl : partner?.avatarUrl) ?? ''} alt={title} className="h-full w-full object-cover" />
            ) : (
              initialsFor(chat?.type === 'group' ? chat?.groupName : title)
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
        </button>
      )}

      <button type="button" className="btn-ghost !px-2" title="Search in chat" aria-label="Search in chat" onClick={onToggleSearch}>
        {inChatSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
      </button>
      {!ai ? (
        <>
          <button type="button" className="btn-ghost !px-2" title="Voice call" aria-label="Voice call" onClick={onCall}>
            <Phone className="h-5 w-5" />
          </button>
          <button type="button" className="btn-ghost !px-2" title="Video call" aria-label="Video call" onClick={onVideoCall}>
            <Video className="h-5 w-5" />
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="btn-ghost !px-2"
        title="More"
        aria-label="More"
        onClick={() => setMenuOpen((value) => !value)}
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {menuOpen ? (
        <div className="absolute right-3 top-14 z-30 w-56 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-ink-700">
          {menuItems.map(({ label, Icon, run, danger }) => (
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
