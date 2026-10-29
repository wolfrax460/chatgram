import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell, Bot, Check, Clock, Copy, HardDrive, Info, LifeBuoy, Search, Settings as SettingsIcon,
  ShieldCheck, Sparkles, Timer, UserRound, UserRoundPlus, MessageCircle,
} from 'lucide-react';
import { useSession } from '@chatgram/core';
import AccountPage from './settings/AccountPage';
import AiPage from './settings/AiPage';
import AutoReplyPage from './settings/AutoReplyPage';
import ChatsPage from './settings/ChatsPage';
import DeleteAccountPage from './settings/DeleteAccountPage';
import DisappearingDefaultPage from './settings/DisappearingDefaultPage';
import HelpPage from './settings/HelpPage';
import InvitePage from './settings/InvitePage';
import NotificationsPage from './settings/NotificationsPage';
import PrivacyPage from './settings/PrivacyPage';
import ProfilePage from './settings/ProfilePage';
import StoragePage from './settings/StoragePage';
import WallpaperPage from './settings/WallpaperPage';
import WhatsNewPage from './settings/WhatsNewPage';
import type { SettingsRoute } from './settings/types';
import { SettingsRow, focusRing, useCopyToClipboard } from './settings/ui';

interface ListRow {
  route: SettingsRoute;
  icon: typeof UserRound;
  title: string;
  subtitle: string;
  keywords: string;
  testId: string;
}

/**
 * WhatsApp-style Settings: a single list that opens one page per group.
 *
 * Mobile = push navigation (back button on the page). Desktop = two panes: the
 * list stays on the left, the selected page renders on the right at max 720 px.
 * The old long scroll, the "Server https://…" row and the red buttons on the
 * main list are gone.
 */
export default function Settings({ onOpenSupport }: { onOpenSupport: (chatId: string) => void }) {
  const user = useSession((s) => s.user);
  const [route, setRoute] = useState<SettingsRoute>('list');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const { copied, copy } = useCopyToClipboard();

  const rows: ListRow[] = useMemo(
    () => [
      {
        route: 'account',
        icon: UserRound,
        title: 'Account',
        subtitle: 'Sign-in details, password, two-factor, sessions, auto-reply, delete account',
        keywords: 'email phone password security two factor 2fa sessions logout delete auto reply away vacation',
        testId: 'settings-row-account',
      },
      {
        route: 'privacy',
        icon: ShieldCheck,
        title: 'Privacy',
        subtitle: 'Who can see your info, blocked users, disappearing messages',
        keywords: 'online last seen profile photo about phone email receipts groups blocked checkup disappearing ephemeral timer default',
        testId: 'settings-row-privacy',
      },
      {
        route: 'chats',
        icon: MessageCircle,
        title: 'Chats',
        subtitle: 'Theme, text size, wallpaper, time format, language, Enter key',
        keywords: 'appearance dark light system text wallpaper language enter send',
        testId: 'settings-row-chats',
      },
      {
        route: 'notifications',
        icon: Bell,
        title: 'Notifications',
        subtitle: 'Alerts, sounds, do not disturb, per-chat overrides',
        keywords: 'push sounds vibration preview dnd muted',
        testId: 'settings-row-notifications',
      },
      {
        route: 'storage',
        icon: HardDrive,
        title: 'Storage and data',
        subtitle: 'Storage used, clear cache, auto-download, data saver',
        keywords: 'cache media download wifi mobile data saver',
        testId: 'settings-row-storage',
      },
      {
        route: 'ai',
        icon: Bot,
        title: 'Chatgram AI',
        subtitle: 'Suggested replies, clear AI history, report a bad answer',
        keywords: 'assistant memory history suggested replies smart chips feedback',
        testId: 'settings-row-ai',
      },
      {
        route: 'help',
        icon: LifeBuoy,
        title: 'Help',
        subtitle: 'Help centre, contact support, report a problem, terms',
        keywords: 'support guide report problem terms privacy version what\'s new changelog release notes updates',
        testId: 'settings-row-help',
      },
      {
        route: 'invite',
        icon: UserRoundPlus,
        title: 'Invite a friend',
        subtitle: 'Share your invite link',
        keywords: 'share link invite friend',
        testId: 'settings-row-invite',
      },
    ],
    [],
  );

  /**
   * Rows that only live inside a sub-page but must be findable from the search
   * (auto-reply, disappearing default, What's new, suggested replies). They are
   * rendered only while searching and open the page that hosts them.
   */
  const searchOnlyRows: ListRow[] = useMemo(
    () => [
      {
        route: 'auto-reply',
        icon: Clock,
        title: 'Auto-reply',
        subtitle: 'Account · automatic reply when you are away',
        keywords: 'auto reply away vacation out of office automation schedule audience',
        testId: 'settings-search-auto-reply',
      },
      {
        route: 'disappearing-default',
        icon: Timer,
        title: 'Disappearing messages default',
        subtitle: 'Privacy · new direct chats only',
        keywords: 'disappearing messages timer ephemeral 24 hours 7 days 90 days default',
        testId: 'settings-search-disappearing-default',
      },
      {
        route: 'whats-new',
        icon: Sparkles,
        title: "What's new",
        subtitle: 'Help · release notes and changelog',
        keywords: 'whats new changelog release notes updates version',
        testId: 'settings-search-whats-new',
      },
      {
        route: 'ai',
        icon: Sparkles,
        title: 'Suggested replies',
        subtitle: 'Chatgram AI · opt-in smart replies in the composer',
        keywords: 'suggested replies smart chips opt in ai composer',
        testId: 'settings-search-suggested-replies',
      },
    ],
    [],
  );

  // Ctrl+K (and Cmd+K) focuses the settings search, like the rest of the app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = (row: ListRow) => `${row.title} ${row.subtitle} ${row.keywords}`.toLowerCase().includes(needle);
  const filtered = needle
    ? [...rows.filter(matches), ...searchOnlyRows.filter(matches)].filter(
        (row, index, list) => list.findIndex((other) => other.testId === row.testId) === index,
      )
    : rows;

  const shareLink = (() => {
    try {
      return `${window.location.origin}/`;
    } catch {
      return 'https://chatgram-xi.vercel.app/';
    }
  })();

  function open(routeName: SettingsRoute) {
    setQuery('');
    setRoute(routeName);
  }

  function renderPage(page: SettingsRoute) {
    const onBack = () => setRoute('list');
    switch (page) {
      case 'profile':
        return <ProfilePage onBack={onBack} navigate={setRoute} />;
      case 'account':
        return <AccountPage onBack={onBack} navigate={setRoute} />;
      case 'auto-reply':
        return <AutoReplyPage onBack={onBack} navigate={setRoute} />;
      case 'delete-account':
        return <DeleteAccountPage onBack={onBack} navigate={setRoute} />;
      case 'privacy':
        return <PrivacyPage onBack={onBack} navigate={setRoute} />;
      case 'disappearing-default':
        return <DisappearingDefaultPage onBack={onBack} navigate={setRoute} />;
      case 'chats':
        return <ChatsPage onBack={onBack} navigate={setRoute} />;
      case 'wallpaper':
        return <WallpaperPage onBack={onBack} navigate={setRoute} />;
      case 'notifications':
        return <NotificationsPage onBack={onBack} navigate={setRoute} />;
      case 'storage':
        return <StoragePage onBack={onBack} navigate={setRoute} />;
      case 'ai':
        return <AiPage onBack={onBack} navigate={setRoute} />;
      case 'help':
        return <HelpPage onBack={onBack} navigate={setRoute} onOpenSupport={onOpenSupport} />;
      case 'whats-new':
        return <WhatsNewPage onBack={onBack} navigate={setRoute} />;
      case 'invite':
        return <InvitePage onBack={onBack} navigate={setRoute} />;
      default:
        return <ProfilePage onBack={onBack} navigate={setRoute} />;
    }
  }

  const list = (
    <div className="flex h-full min-h-0 flex-col border-r-0 border-ink-200 dark:border-white/10 lg:border-r">
      <header className="flex items-center gap-2 border-b border-ink-200 px-3 py-2.5 dark:border-white/10">
        <SettingsIcon className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
        <h1 className="flex-1 font-bold">Settings</h1>
      </header>

      <div className="px-3 pb-2 pt-2" role="search">
        <label className="sr-only" htmlFor="settings-search-input">
          Search settings
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            id="settings-search-input"
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
            placeholder="Search settings (Ctrl+K)"
            data-testid="settings-search"
            className="field h-10 pl-9 pr-3 text-[13px]"
            aria-describedby="settings-search-hint"
          />
        </div>
        <p id="settings-search-hint" className="mt-1 hidden text-[10.5px] text-ink-500 dark:text-ink-400 lg:block">
          Ctrl+K focuses this search
        </p>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {!needle ? (
          <div className="mb-2 mt-1 flex items-center gap-2 rounded-2xl px-2 py-2 transition hover:bg-ink-100/70 dark:hover:bg-white/[.04]">
            <button
              type="button"
              onClick={() => open('profile')}
              data-testid="settings-profile-card"
              aria-label="Open your profile"
              className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left ${focusRing}`}
            >
              <span className="relative shrink-0">
                <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (user?.displayName ?? 'You').slice(0, 2).toUpperCase()
                  )}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-bold" data-testid="settings-display-name">
                  {user?.displayName ?? 'Your profile'}
                </span>
                <span className="block truncate text-[12.5px] text-ink-500 dark:text-ink-400">
                  {user?.about || user?.email || user?.phone || 'Tap to edit your profile'}
                </span>
              </span>
            </button>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand-700 dark:text-brand-300">
                <Info className="h-2.5 w-2.5" aria-hidden="true" /> Tap to edit
              </span>
              <button
                type="button"
                onClick={() => void copy(shareLink, 'card')}
                data-testid="settings-profile-share"
                aria-label={copied === 'card' ? 'Invite link copied' : 'Copy invite link'}
                className={`inline-flex items-center gap-1 rounded-full bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-600 hover:bg-ink-200 dark:bg-white/10 dark:text-ink-200 dark:hover:bg-white/15 ${focusRing}`}
              >
                {copied === 'card' ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                {copied === 'card' ? 'Copied' : 'Share link'}
              </button>
            </span>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-ink-500 dark:text-ink-400" role="status">
            No settings match “{query.trim()}”.
          </p>
        ) : null}

        <div role="list" aria-label="Settings sections">
          {filtered.map((row) => (
            <div role="listitem" key={row.testId}>
              <SettingsRow
                icon={row.icon}
                title={row.title}
                subtitle={row.subtitle}
                onClick={() => open(row.route)}
                testId={row.testId}
              />
            </div>
          ))}
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 px-3 text-[11px] text-ink-400 dark:text-ink-500">
          <Bell className="h-3 w-3" aria-hidden="true" /> Statuses disappear after 24 hours.
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full" data-testid="settings-screen">
      {/* Mobile: list OR page. Desktop: list + page. */}
      <div className={`min-h-0 w-full lg:w-[340px] lg:shrink-0 ${route === 'list' ? 'block' : 'hidden lg:block'}`}>
        {list}
      </div>
      <div className={`no-scrollbar min-h-0 flex-1 overflow-y-auto ${route === 'list' ? 'hidden lg:block' : 'block'}`}>
        {renderPage(route === 'list' ? 'profile' : route)}
      </div>
    </div>
  );
}

