import { CircleDashed, MessageCircle, Phone, Settings as SettingsIcon, Users } from 'lucide-react';

type Tab = 'chats' | 'calls' | 'status' | 'groups' | 'settings' | 'ai';

const ITEMS: { key: Tab; label: string; Icon: typeof MessageCircle }[] = [
  { key: 'chats', label: 'Chats', Icon: MessageCircle },
  { key: 'calls', label: 'Calls', Icon: Phone },
  { key: 'status', label: 'Status', Icon: CircleDashed },
  { key: 'groups', label: 'Groups', Icon: Users },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];

/**
 * Bottom tab bar for phones (< 768 px).
 *
 * The desktop rail is hidden below `md`, so without this the mobile app had no
 * way to reach Calls / Status / Groups / Settings at all. Chatgram AI is reachable from its own floating button above this bar (Meta-AI style) rather than a tab. It is fixed to the
 * bottom, respects the Android gesture bar via safe-area insets, shows unread
 * badges and is hidden while a conversation is open (the chat header's back arrow
 * takes over). Tailwind `md:hidden` keeps the desktop layout untouched.
 */
export function MobileNav({
  tab,
  onSelect,
  badges,
  hasStatus,
}: {
  tab: Tab;
  onSelect: (tab: Tab) => void;
  badges: { chats: number; calls: number };
  hasStatus: boolean;
}) {
  return (
    <nav
      aria-label="Primary"
      data-testid="mobile-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur dark:border-white/10 dark:bg-ink-900/95 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-xl items-stretch justify-around px-1">
        {ITEMS.map(({ key, label, Icon }) => {
          const badge = key === 'chats' ? badges.chats : key === 'calls' ? badges.calls : 0;
          const dot = key === 'status' && hasStatus;
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-label={badge > 0 ? `${label}, ${badge} new` : label}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10.5px] font-semibold transition ${
                active ? 'text-brand-700 dark:text-brand-300' : 'text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200'
              }`}
            >
              <span className="relative">
                <Icon className={`h-[22px] w-[22px] ${active ? 'stroke-[2.4]' : ''}`} aria-hidden="true" />
                {badge > 0 ? (
                  <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white">
                    {badge > 9 ? '9+' : badge}
                  </span>
                ) : null}
                {dot ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-brand-600" aria-hidden="true" /> : null}
              </span>
              <span className="w-full truncate text-center">{label}</span>
              {active ? <span className="absolute -top-px h-0.5 w-8 rounded-full bg-brand-600 dark:bg-brand-400" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
