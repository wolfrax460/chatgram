import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings as SettingsIcon, Sun, Moon, Monitor, Bell, Volume2, Eye, MessageCircle,
  LogOut, Info, Lock, Pencil, Check, X, Mail, Phone, Smartphone, ShieldOff, UserX,
  Languages, Type, AlertTriangle, KeyRound, BellOff,
} from 'lucide-react';
import { usePrefs, useSession, useTheme, type TextSize } from '@chatgram/core';
import TwoFactorSettings from '../components/TwoFactorSettings';
import { DesktopUpdateCard } from '../components/DesktopUpdateCard';
import { AndroidUpdateCard } from '../components/AndroidUpdateCard';
import ChangePassword from '../components/ChangePassword';
import { api, API_URL, APP_VERSION } from '../lib/api';
import {
  notificationPermission, requestNotificationPermission, notificationsSupported,
} from '../lib/notify';
import { LOCALES, LOCALE_LABELS, useI18n } from '../lib/i18n';

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
  testId,
}: {
  icon: typeof Bell;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
      role="switch"
      aria-checked={value}
      aria-label={title}
      data-testid={testId}
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
        aria-hidden="true"
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

function Choice({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex gap-2 px-4 py-3" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={value === option.key}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[13px] font-semibold transition ${
            value === option.key
              ? 'border-brand-600 bg-brand-600/10 text-brand-700 dark:text-brand-300'
              : 'border-ink-200 text-ink-600 hover:bg-ink-100/70 dark:border-white/10 dark:text-ink-300 dark:hover:bg-white/5'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- change identifier */

function ChangeIdentifier({ onDone }: { onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'request' | 'confirm'>('request');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function requestCode() {
    setError('');
    setBusy(true);
    try {
      const result = await api.requestIdentifierChange(identifier.trim());
      setInfo(result.message + (result.delivered === false ? ' (delivery is not configured in this environment)' : ''));
      setStage('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setError('');
    setBusy(true);
    try {
      const result = await api.confirmIdentifierChange({
        identifier: identifier.trim(),
        code: code.trim(),
        currentPassword: password || undefined,
      });
      onDone(result.message);
      setOpen(false);
      setStage('request');
      setIdentifier('');
      setCode('');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the new address');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
          <Mail className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Change email or phone</span>
          <span className="block truncate text-[13px] text-ink-500 dark:text-ink-400">
            We send a code to the new address before switching
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="px-4 py-3" data-testid="change-identifier">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold">Change email or phone</p>
        <button type="button" className="btn-ghost !px-2" onClick={() => setOpen(false)} aria-label="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>
      {error ? (
        <p role="alert" className="mb-2 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      {info ? (
        <p role="status" className="mb-2 rounded-xl border border-brand-300/50 bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
          {info}
        </p>
      ) : null}

      <label className="label" htmlFor="new-identifier">New email or phone</label>
      <input
        id="new-identifier"
        className="field"
        placeholder="you@example.com or +250780000001"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        autoComplete="email"
      />

      {stage === 'request' ? (
        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={busy || !identifier.trim()}
          onClick={() => void requestCode()}
        >
          {busy ? 'Sending…' : 'Send verification code'}
        </button>
      ) : (
        <>
          <label className="label mt-3" htmlFor="identifier-code">6-digit code</label>
          <input
            id="identifier-code"
            className="field tracking-[0.4em]"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          />
          <label className="label mt-3" htmlFor="identifier-password">Current password</label>
          <input
            id="identifier-password"
            type="password"
            className="field"
            placeholder="Required to change your sign-in address"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary flex-1" disabled={busy || code.length !== 6} onClick={() => void confirm()}>
              {busy ? 'Saving…' : 'Verify and save'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => void requestCode()} disabled={busy}>
              Resend
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ delete modal */

function DeleteAccountModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api.deleteAccount(confirmation, password || undefined);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-ink-800" role="dialog" aria-label="Delete account">
        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="text-lg font-bold">Delete account</h3>
        </div>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
          This permanently deletes your profile, messages, statuses and media. Group chats are told you left.
          This cannot be undone.
        </p>
        {error ? <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
        <label className="label mt-3" htmlFor="delete-password">Password</label>
        <input
          id="delete-password"
          type="password"
          className="field"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
        <label className="label mt-2" htmlFor="delete-confirm">Type DELETE to confirm</label>
        <input
          id="delete-confirm"
          className="field"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
          autoComplete="off"
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="btn flex-1 bg-rose-600 text-white hover:bg-rose-700"
            disabled={busy || confirmation !== 'DELETE'}
            onClick={() => void remove()}
          >
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- settings */

export default function Settings({ onOpenSupport }: { onOpenSupport: (chatId: string) => void }) {
  const user = useSession((s) => s.user);
  const patchUser = useSession((s) => s.patchUser);
  const setUser = useSession((s) => s.setUser);
  const { mode, setMode } = useTheme();
  const prefs = usePrefs();
  const { locale, setLocale } = useI18n();
  const queryClient = useQueryClient();

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [about, setAbout] = useState(user?.about ?? '');
  const [uploading, setUploading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sessionPassword, setSessionPassword] = useState('');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [hidePicker, setHidePicker] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const privacy = useQuery({ queryKey: ['privacy'], queryFn: () => api.privacy() });
  const blocked = useQuery({ queryKey: ['blocked-users'], queryFn: () => api.blockedUsers() });
  const muted = useQuery({ queryKey: ['muted-chats'], queryFn: () => api.mutedChats() });
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts() });
  const notificationPrefs = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.notificationPrefs() });

  const [showOnline, setShowOnline] = useState(true);
  const [dndEnabled, setDndEnabled] = useState(false);
  const [dndStart, setDndStart] = useState('22:00');
  const [dndEnd, setDndEnd] = useState('07:00');

  useEffect(() => {
    if (privacy.data) setShowOnline(privacy.data.showOnlineStatus);
  }, [privacy.data]);

  useEffect(() => {
    if (!notificationPrefs.data) return;
    setDndEnabled(notificationPrefs.data.dndEnabled);
    setDndStart(notificationPrefs.data.dndStart);
    setDndEnd(notificationPrefs.data.dndEnd);
  }, [notificationPrefs.data]);

  const saveDnd = useMutation({
    mutationFn: (patch: { dndEnabled?: boolean; dndStart?: string; dndEnd?: string }) => api.updateNotificationPrefs(patch),
    onSuccess: () => {
      setNotice('Notification settings saved.');
      void queryClient.invalidateQueries({ queryKey: ['notification-prefs'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not save notification settings');
      void queryClient.invalidateQueries({ queryKey: ['notification-prefs'] });
    },
  });

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
      setNotice('Profile saved.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not save profile'),
  });

  const savePrivacy = useMutation({
    mutationFn: (patch: Parameters<typeof api.updatePrivacy>[0]) => api.updatePrivacy(patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['privacy'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not update privacy');
      void queryClient.invalidateQueries({ queryKey: ['privacy'] });
    },
  });

  const unblock = useMutation({
    mutationFn: (userId: string) => api.unblockUser(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      setNotice('User unblocked.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not unblock the user'),
  });

  const unmute = useMutation({
    mutationFn: (chatId: string) => api.unmuteChat(chatId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['muted-chats'] });
      setNotice('Chat unmuted.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not unmute the chat'),
  });

  async function pickAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
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

  async function logOutOtherDevices() {
    setSessionBusy(true);
    setError('');
    try {
      const result = await api.logoutOtherSessions(sessionPassword || undefined);
      setSessionPassword('');
      setNotice(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out the other devices');
    } finally {
      setSessionBusy(false);
    }
  }

  const permission = notificationPermission();
  const privacyData = privacy.data;
  const hiddenFrom = privacyData?.hiddenFrom ?? [];

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
        <p
          role="alert"
          data-testid="settings-error"
          className="mx-4 mt-3 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          aria-live="polite"
          data-testid="settings-notice"
          className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
        >
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss message" className="shrink-0">
            <X className="h-4 w-4" />
          </button>
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
          <p className="truncate text-lg font-bold" data-testid="settings-display-name">{user?.displayName}</p>
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

      {/* account */}
      <Section title="Account">
        <div className="flex items-center gap-3 px-4 py-2">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
            <Lock className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Sign-in details</span>
            <span className="block truncate text-[13px] text-ink-500 dark:text-ink-400" data-testid="settings-identifier">
              {user?.email || user?.phone || 'No email or phone on file'}
            </span>
          </span>
        </div>
        <ChangePassword onDone={(message) => { setError(''); setNotice(message); }} />
        <ChangeIdentifier
          onDone={(message) => {
            setError('');
            setNotice(message);
            // The sign-in address changed: refresh the cached session user.
            void api.me().then((fresh) => setUser(fresh)).catch(() => {});
          }}
        />
      </Section>

      {/* privacy */}
      <Section title="Privacy">
        <ToggleRow
          icon={Eye}
          title="Show when I am online"
          subtitle="Contacts can see your online status and last seen"
          value={showOnline}
          onChange={toggleOnline}
          testId="privacy-online"
        />
        <ToggleRow
          icon={Eye}
          title="Show my profile photo"
          subtitle="People who can open your profile see your photo"
          value={privacyData?.showProfilePhoto !== false}
          onChange={(next) => savePrivacy.mutate({ showProfilePhoto: next })}
          testId="privacy-photo"
        />
        <ToggleRow
          icon={Info}
          title="Show my about"
          subtitle="The short line under your name in your profile"
          value={privacyData?.showAbout !== false}
          onChange={(next) => savePrivacy.mutate({ showAbout: next })}
          testId="privacy-about"
        />
        <ToggleRow
          icon={Phone}
          title="Show my phone number"
          subtitle="Only contacts can ever see it"
          value={privacyData?.showPhone !== false}
          onChange={(next) => savePrivacy.mutate({ showPhone: next })}
          testId="privacy-phone"
        />
        <ToggleRow
          icon={Mail}
          title="Show my email address"
          subtitle="Only contacts can ever see it"
          value={privacyData?.showEmail !== false}
          onChange={(next) => savePrivacy.mutate({ showEmail: next })}
          testId="privacy-email"
        />
        <ToggleRow
          icon={Check}
          title="Read receipts"
          subtitle="When off, senders cannot see that you read their messages"
          value={privacyData?.readReceipts !== false}
          onChange={(next) => savePrivacy.mutate({ readReceipts: next })}
          testId="privacy-receipts"
        />
        <div className="px-4 pb-2">
          <p className="mb-1 text-[13px] font-semibold">Who can add me to groups</p>
          <Choice
            ariaLabel="Who can add me to groups"
            value={privacyData?.whoCanAddToGroups ?? 'everyone'}
            onChange={(key) => savePrivacy.mutate({ whoCanAddToGroups: key === 'contacts' ? 'contacts' : 'everyone' })}
            options={[
              { key: 'everyone', label: 'Everyone' },
              { key: 'contacts', label: 'My contacts' },
            ]}
          />
        </div>

        <div className="px-4 py-2">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold">
              Hide my last seen from {hiddenFrom.length > 0 ? `${hiddenFrom.length} ${hiddenFrom.length === 1 ? 'person' : 'people'}` : 'nobody'}
            </p>
            <button type="button" className="btn-ghost !py-1 text-[12px]" onClick={() => setHidePicker((value) => !value)}>
              {hidePicker ? 'Done' : 'Manage'}
            </button>
          </div>
          {hiddenFrom.length > 0 && !hidePicker ? (
            <p className="mt-0.5 text-[12px] text-ink-500 dark:text-ink-400">
              {hiddenFrom.map((person) => person.displayName).join(', ')}
            </p>
          ) : null}
          {hidePicker ? (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-ink-200 dark:border-white/10">
              {(contacts.data ?? []).length === 0 ? <p className="p-2 text-[12px] text-ink-500">No contacts yet.</p> : null}
              {(contacts.data ?? []).map((person) => {
                const checked = hiddenFrom.some((hidden) => hidden.id === person.id);
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => {
                      const ids = checked
                        ? hiddenFrom.filter((hidden) => hidden.id !== person.id).map((hidden) => hidden.id)
                        : [...hiddenFrom.map((hidden) => hidden.id), person.id];
                      savePrivacy.mutate({ hiddenFrom: ids });
                    }}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-ink-100 dark:hover:bg-white/5"
                  >
                    <span
                      className={`grid h-4 w-4 place-items-center rounded border ${
                        checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 dark:border-white/20'
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    {person.displayName}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="px-4 py-2">
          <p className="flex items-center gap-1 text-[13px] font-semibold">
            <UserX className="h-3.5 w-3.5" /> Blocked users
          </p>
          {(blocked.data ?? []).length === 0 ? (
            <p className="mt-1 text-[12px] text-ink-500 dark:text-ink-400">You have not blocked anyone.</p>
          ) : (
            (blocked.data ?? []).map((person) => {
              const id = person._id ?? person.id ?? '';
              return (
                <div key={id} className="mt-1 flex items-center gap-2">
                  <span className="flex-1 truncate text-[13px]" data-testid="blocked-user">{person.displayName}</span>
                  <button type="button" className="btn-ghost !py-1 text-[12px]" onClick={() => unblock.mutate(id)}>
                    Unblock
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="mx-4 mb-3 mt-1 rounded-lg border border-amber-300/40 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200" data-testid="privacy-admin-review-notice">
          <strong>How your messages are protected:</strong> chats are encrypted in transit, but they are
          <strong> not end-to-end encrypted</strong>. Authorised Chatgram administrators can review conversation
          content for security, abuse and legal reasons; every review needs a written reason, is read-only and is
          written to an audit log.
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
          testId="notifications-desktop"
        />
        <ToggleRow
          icon={Volume2}
          title="Message sounds"
          subtitle="Play a short chime for new messages"
          value={prefs.sounds}
          onChange={(next) => prefs.setPref('sounds', next)}
          testId="notifications-sounds"
        />
        <ToggleRow
          icon={Bell}
          title="Do not disturb"
          subtitle="Silence desktop notifications and sounds during the hours below"
          value={dndEnabled}
          onChange={(next) => {
            setDndEnabled(next);
            saveDnd.mutate({ dndEnabled: next });
          }}
          testId="notifications-dnd"
        />
        {dndEnabled ? (
          <div className="flex items-center gap-3 px-4 pb-3 text-[13px]">
            <label className="flex items-center gap-2">
              From
              <input
                type="time"
                className="field h-9 w-[110px]"
                value={dndStart}
                data-testid="dnd-start"
                onChange={(event) => setDndStart(event.target.value)}
                onBlur={() => saveDnd.mutate({ dndStart })}
              />
            </label>
            <label className="flex items-center gap-2">
              To
              <input
                type="time"
                className="field h-9 w-[110px]"
                value={dndEnd}
                data-testid="dnd-end"
                onChange={(event) => setDndEnd(event.target.value)}
                onBlur={() => saveDnd.mutate({ dndEnd })}
              />
            </label>
          </div>
        ) : null}
        {(muted.data ?? []).length > 0 ? (
          <div className="px-4 py-2">
            <p className="text-[13px] font-semibold">Muted chats</p>
            {(muted.data ?? []).map((entry) => (
              <div key={entry.chatId} className="mt-1 flex items-center gap-2">
                <span className="flex-1 truncate font-mono text-[11px] text-ink-500 dark:text-ink-400">{entry.chatId.slice(-8)}</span>
                <button type="button" className="btn-ghost !py-1 text-[12px]" onClick={() => unmute.mutate(entry.chatId)}>
                  Unmute
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      {/* appearance */}
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
        <div className="px-4 pb-1">
          <p className="flex items-center gap-1 text-[13px] font-semibold"><Type className="h-3.5 w-3.5" /> Text size</p>
        </div>
        <Choice
          ariaLabel="Text size"
          value={prefs.textSize}
          onChange={(key) => prefs.setTextSize(key as TextSize)}
          options={[
            { key: 'small', label: 'Small' },
            { key: 'normal', label: 'Normal' },
            { key: 'large', label: 'Large' },
          ]}
        />
      </Section>

      {/* language */}
      <Section title="Language">
        <div className="flex items-center gap-3 px-4 py-2">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
            <Languages className="h-5 w-5" />
          </span>
          <select
            className="field flex-1"
            value={locale}
            onChange={(event) => setLocale(event.target.value as typeof locale)}
            aria-label="Language"
            data-testid="settings-language"
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABELS[code]}
              </option>
            ))}
          </select>
        </div>
        <p className="px-4 pb-2 text-[11px] text-ink-500 dark:text-ink-400">
          English is complete; Kinyarwanda, French and Swahili are being translated.
        </p>
      </Section>

      {/* time format */}
      <Section title="Time format">
        <Choice
          ariaLabel="Time format"
          value={prefs.timeFormat}
          onChange={(key) => prefs.setTimeFormat(key === '24h' ? '24h' : '12h')}
          options={[
            { key: '12h', label: '12-hour (9:19 AM)' },
            { key: '24h', label: '24-hour (09:19)' },
          ]}
        />
      </Section>

      {/* security */}
      <Section title="Security">
        <TwoFactorSettings />
        <div className="px-4 py-3">
          <p className="flex items-center gap-1 text-[13px] font-semibold">
            <Smartphone className="h-3.5 w-3.5" /> Active sessions
          </p>
          <p className="mt-1 text-[12px] text-ink-500 dark:text-ink-400">
            This device is signed in. Changing your password or signing out other devices invalidates every
            other session immediately.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              className="field flex-1"
              type="password"
              placeholder="Current password"
              value={sessionPassword}
              onChange={(event) => setSessionPassword(event.target.value)}
              autoComplete="current-password"
              aria-label="Current password for signing out other devices"
            />
            <button type="button" className="btn-primary text-sm" disabled={sessionBusy} onClick={() => void logOutOtherDevices()}>
              <ShieldOff className="h-4 w-4" /> {sessionBusy ? 'Signing out…' : 'Log out other devices'}
            </button>
          </div>
        </div>
      </Section>

      {/* support */}
      <Section title="Support">
        <button
          type="button"
          onClick={() => void openSupport()}
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
            <KeyRound className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Server</span>
            <span className="block truncate text-[13px] text-ink-500 dark:text-ink-400">{API_URL}</span>
          </span>
        </div>
        <DesktopUpdateCard />
        <AndroidUpdateCard />
      </Section>

      <div className="space-y-2 p-4">
        <button
          type="button"
          className="btn w-full border border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
          onClick={() => setDeleteOpen(true)}
          data-testid="delete-account"
        >
          <AlertTriangle className="h-4 w-4" /> Delete account
        </button>
        <button
          type="button"
          className="btn w-full border border-ink-300 text-ink-700 hover:bg-ink-100 dark:border-white/15 dark:text-ink-100 dark:hover:bg-white/10"
          onClick={async () => {
            await api.logout().catch(() => {});
            setUser(null);
          }}
        >
          <LogOut className="h-4 w-4" /> Log out
        </button>
        <p className="flex items-center justify-center gap-1 pt-1 text-[11px] text-ink-400">
          <BellOff className="h-3 w-3" /> Statuses disappear after 24 hours; media is deleted with them.
        </p>
      </div>

      {deleteOpen ? (
        <DeleteAccountModal
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            api.clearTokens();
            setUser(null);
          }}
        />
      ) : null}
    </div>
  );
}
