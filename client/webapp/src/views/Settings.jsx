import React, { useState } from 'react';
import { api, API_BASE } from '../lib/api.js';
import { Avatar, Icon, ErrorNote, formatDay } from '../components/ui.jsx';
import { useTheme } from '../lib/theme.js';

/** Profile, appearance, help & feedback, session. */
export default function Settings({ user, onSignedOut, onOpenSupport }) {
  const { mode, setMode } = useTheme();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function openSupport() {
    setBusy(true);
    setError('');
    try {
      const chat = await api.openSupportChat();
      onOpenSupport(chat?._id || chat?.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto h-full w-full max-w-2xl overflow-y-auto">
      <div className="border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <h2 className="text-lg font-bold">Settings</h2>
      </div>

      {error ? <div className="p-3"><ErrorNote onDismiss={() => setError('')}>{error}</ErrorNote></div> : null}

      {/* profile */}
      <div className="flex items-center gap-4 px-4 py-5">
        <Avatar name={user?.displayName || 'You'} src={user?.avatarUrl} size={64} />
        <div className="min-w-0">
          <div className="truncate text-lg font-bold">{user?.displayName || 'You'}</div>
          <div className="truncate text-sm text-ink-500 dark:text-ink-400">
            {user?.email || user?.phone || ''}
          </div>
        </div>
      </div>

      <Section title="Appearance">
        <div className="flex gap-2 px-4 py-3">
          {[
            ['light', 'Light', Icon.sun],
            ['dark', 'Dark', Icon.moon],
            ['system', 'System', Icon.monitor],
          ].map(([key, label, I]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                mode === key
                  ? 'border-brand-600 bg-brand-600/10 text-brand-700 dark:text-brand-300'
                  : 'border-ink-200 text-ink-600 hover:bg-ink-100/70 dark:border-white/10 dark:text-ink-300 dark:hover:bg-white/5'
              }`}
            >
              <I className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Support">
        <Row
          icon={Icon.chat}
          title="Help & feedback"
          subtitle="Report a bug, ask for help or request a change"
          onClick={openSupport}
          busy={busy}
        />
      </Section>

      <Section title="About">
        <Row icon={Icon.info} title="Chatgram for web" subtitle="Version 1.0.0" />
        <Row icon={Icon.lock} title="Server" subtitle={API_BASE} />
      </Section>

      <div className="p-4">
        <button type="button" className="btn w-full border border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10" onClick={onSignedOut}>
          <Icon.logout className="h-4 w-4" /> Log out
        </button>
        <p className="mt-4 text-center text-xs text-ink-400">
          © {new Date().getFullYear()} Chatgram · Built with React, Tailwind and Socket.IO
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="border-t border-ink-200 dark:border-white/10">
      <div className="px-4 pb-1 pt-4 text-[11.5px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ icon: I, title, subtitle, onClick, busy }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
        onClick ? 'hover:bg-ink-100/70 dark:hover:bg-white/[.04]' : ''
      }`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
        <I className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-[13px] text-ink-500 dark:text-ink-400">{subtitle}</span>
      </span>
      {busy ? <span className="text-xs text-ink-400">…</span> : null}
    </Tag>
  );
}
