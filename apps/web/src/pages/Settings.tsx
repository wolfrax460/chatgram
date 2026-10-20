import { useEffect, useRef, useState } from 'react';
import TwoFactorSettings from '../components/TwoFactorSettings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings as SettingsIcon, Sun, Moon, Monitor, Bell, Volume2, Eye, MessageCircle,
  LogOut, Info, Lock, Pencil, Check, X,
} from 'lucide-react';
import { usePrefs, useSession, useTheme } from '@chatgram/core';
import { api, API_URL, APP_VERSION } from '../lib/api';
import {
  notificationPermission, requestNotificationPermission, notificationsSupported,
} from '../lib/notify';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-ink-200 dark:border-white/10">
      <p className="px-4 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
        {title}
      </p>
      {children}
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  title,
  subtitle,
  value,
  onChange,
}: {
  icon: typeof Bell;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-[13px] text-ink-500 dark:text-ink-400">{subtitle}</span>
      </span>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          value ? 'bg-brand-600' : 'bg-ink-300 dark:bg-white/15'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

export default function Settings({ onOpenSupport }: { onOpenSupport: (chatId: string) => void }) {
  const user = useSession((s) => s.user);
  const patchUser = useSession((s) => s.patchUser);
  const setUser = useSession((s) => s.setUser);
  const { mode, setMode } = useTheme();
  const prefs = usePrefs();
  const queryClient = useQueryClient();

  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [about, setAbout] = useState(user?.about ?? '');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const privacy = useQuery({ queryKey: ['privacy'], queryFn: () => api.privacy() });
  const [showOnline, setShowOnline] = useState(true);

  useEffect(() => {
    if (privacy.data) setShowOnline(privacy.data.showOnlineStatus);
  }, [privacy.data]);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setAbout(user?.about ?? '');
  }, [user?.displayName, user?.about]);

  const meId = user?.id ?? '';

  const saveProfile = useMutation({
    mutationFn: () => api.updateProfile(meId, { displayName: displayName.trim(), about: about.trim() }),
    onSuccess: (updated) => {
      patchUser(updated);
      setEditing(false);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not save profile'),
  });

  async function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image is larger than 10 MB.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const result = await api.uploadAvatar(meId, file);
      patchUser({ ...result.user, avatarUrl: result.url ?? result.user.avatarUrl });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload avatar');
    } finally {
      setUploading(false);
    }
  }

  async function toggleNotifications(next: boolean) {
    if (!next) {
      prefs.setPref('notifications', false);
      return;
    }
    if (!notificationsSupported()) {
      setError('This browser does not support notifications.');
      return;
    }
    const result = await requestNotificationPermission();
    if (result === 'granted') prefs.setPref('notifications', true);
    else if (result === 'denied') setError('Notifications are blocked. Allow them for this site in browser settings.');
  }

  async function toggleOnline(next: boolean) {
    setShowOnline(next);
    try {
      await api.updatePrivacy({ showOnlineStatus: next });
    } catch (err) {
      setShowOnline(!next);
      setError(err instanceof Error ? err.message : 'Could not update privacy');
    }
  }

  async function openSupport() {
    setError('');
    try {
      const chat = await api.openSupportChat();
      onOpenSupport(chat.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open support chat');
    }
  }

  const permission = notificationPermission();

  return (
    <div className="no-scrollbar mx-auto flex h-full w-full flex-col overflow-y-auto">
      <header className="flex items-center gap-2 border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <SettingsIcon className="h-5 w-5 text-brand-600" />
        <h2 className="font-bold">Settings</h2>
        <span className="flex-1" />
        {!editing ? (
          <button type="button" className="btn-ghost text-sm" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> Edit profile
          </button>
        ) : null}
      </header>

      {error ? (
        <p className="mx-4 mt-3 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      {/* profile */}
      <div className="flex items-center gap-4 px-4 py-5">
        <div className="relative">
          <div className="grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xl font-bold text-white">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.displayName} className="h-full w-full object-cover" />
            ) : (
              (user?.displayName ?? 'You').slice(0, 2).toUpperCase()
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickAvatar} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Change photo"
            className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-brand-600 text-white shadow dark:border-ink-900"
          >
            {uploading ? <span className="text-[10px]">…</span> : <Pencil className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{user?.displayName}</p>
          <p className="truncate text-sm text-ink-500 dark:text-ink-400">{user?.email || user?.phone || ''}</p>
          {user?.about ? <p className="truncate text-[13px] text-ink-500 dark:text-ink-400">{user.about}</p> : null}
        </div>
      </div>

      {editing ? (
        <div className="mx-4 mb-4 rounded-2xl border border-ink-200 p-4 dark:border-white/10 animate-fade-up">
          <label className="label" htmlFor="dn">Display name</label>
          <input id="dn" className="field" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <label className="label mt-3" htmlFor="ab">About</label>
          <input id="ab" className="field" maxLength={139} placeholder="Available" value={about} onChange={(e) => setAbout(e.target.value)} />
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={saveProfile.isPending || !displayName.trim()}
              onClick={() => saveProfile.mutate()}
            >
              <Check className="h-4 w-4" /> {saveProfile.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* appearance */}
      <Section title="Security">
        <TwoFactorSettings />
      </Section>

      <Section title="Appearance">
        <div className="flex gap-2 px-4 py-3">
          {([
            ['light', 'Light', Sun],
            ['dark', 'Dark', Moon],
            ['system', 'System', Monitor],
          ] as const).map(([key, label, Icon]) => (
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
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </Section>

      {/* notifications */}
      <Section title="Notifications">
        <ToggleRow
          icon={Bell}
          title="Desktop notifications"
          subtitle={
            permission === 'granted'
              ? 'You will be notified about new messages'
              : permission === 'denied'
                ? 'Blocked in browser settings'
                : 'Get a popup when a message arrives'
          }
          value={prefs.notifications}
          onChange={toggleNotifications}
        />
        <ToggleRow
          icon={Volume2}
          title="Message sounds"
          subtitle="Play a short chime for new messages"
          value={prefs.sounds}
          onChange={(next) => prefs.setPref('sounds', next)}
        />
      </Section>

      {/* time format */}
      <Section title="Time format">
        <div className="flex gap-2 px-4 py-3">
          {(['12h', '24h'] as const).map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => prefs.setTimeFormat(format)}
              className={`flex flex-1 items-center justify-center rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                prefs.timeFormat === format
                  ? 'border-brand-600 bg-brand-600/10 text-brand-700 dark:text-brand-300'
                  : 'border-ink-200 text-ink-600 hover:bg-ink-100/70 dark:border-white/10 dark:text-ink-300 dark:hover:bg-white/5'
              }`}
            >
              {format === '12h' ? '12-hour (9:19 AM)' : '24-hour (09:19)'}
            </button>
          ))}
        </div>
      </Section>

      {/* privacy */}
      <Section title="Privacy">
        <ToggleRow
          icon={Eye}
          title="Show when I am online"
          subtitle="Contacts can see your online status and last seen"
          value={showOnline}
          onChange={toggleOnline}
        />
      </Section>

      {/* support */}
      <Section title="Support">
        <button
          type="button"
          onClick={openSupport}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
            <MessageCircle className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Help &amp; feedback</span>
            <span className="block truncate text-[13px] text-ink-500 dark:text-ink-400">
              Report a bug, ask for help or request a change
            </span>
          </span>
        </button>
      </Section>

      {/* about */}
      <Section title="About">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
            <Info className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Chatgram for web</span>
            <span className="block text-[13px] text-ink-500 dark:text-ink-400">Version {APP_VERSION}</span>
          </span>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
            <Lock className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Server</span>
            <span className="block truncate text-[13px] text-ink-500 dark:text-ink-400">{API_URL}</span>
          </span>
        </div>
      </Section>

      <div className="p-4">
        <button
          type="button"
          className="btn w-full border border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
          onClick={async () => {
            await api.logout().catch(() => {});
            setUser(null);
          }}
        >
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </div>
    </div>
  );
}
