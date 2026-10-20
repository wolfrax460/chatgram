import React, { useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../lib/api.js';
import { Avatar, Icon, ErrorNote, Spinner } from '../components/ui.jsx';
import { useTheme } from '../lib/theme.js';
import { getPrefs, setPref } from '../lib/prefs.js';
import {
  notificationPermission,
  requestNotificationPermission,
  notificationsSupported,
} from '../lib/notify.js';

/** Profile, appearance, help & feedback, session. */
export default function Settings({ user, onSignedOut, onOpenSupport, onUserUpdated }) {
  const { mode, setMode } = useTheme();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // local copy so edits are visible immediately
  const [profile, setProfile] = useState(user || {});
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [about, setAbout] = useState(user?.about || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // ---- device preferences -------------------------------------------------
  const [prefs, setPrefs] = useState(getPrefs);
  const [permission, setPermission] = useState(notificationPermission());
  const [showOnline, setShowOnline] = useState(true);

  useEffect(() => {
    api
      .privacy()
      .then((p) => setShowOnline(p?.showOnlineStatus !== false))
      .catch(() => {});
  }, []);

  async function toggleNotifications() {
    if (prefs.notifications) {
      setPrefs(setPref('notifications', false));
      return;
    }
    if (!notificationsSupported()) {
      setError('This browser does not support notifications.');
      return;
    }
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === 'granted') {
      setPrefs(setPref('notifications', true));
    } else if (result === 'denied') {
      setError('Notifications are blocked. Allow them for this site in your browser settings.');
    }
  }

  async function toggleOnline(next) {
    setShowOnline(next);
    try {
      await api.updatePrivacy({ showOnlineStatus: next });
    } catch (err) {
      setShowOnline(!next);
      setError(err.message);
    }
  }

  useEffect(() => {
    setProfile(user || {});
    setDisplayName(user?.displayName || '');
    setAbout(user?.about || '');
  }, [user]);

  const meId = profile._id || profile.id;

  async function saveProfile() {
    if (!displayName.trim()) {
      setError('Display name cannot be empty.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.updateProfile(meId, {
        displayName: displayName.trim(),
        about: about.trim(),
      });
      const updated = res?.user || res;
      setProfile((p) => ({ ...p, ...updated }));
      onUserUpdated?.(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function pickAvatar(e) {
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
      const res = await api.uploadAvatar(meId, file);
      const updated = res?.user || res;
      setProfile((p) => ({ ...p, ...updated, avatarUrl: res?.url || updated?.avatarUrl }));
      onUserUpdated?.(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

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
      <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <h2 className="text-lg font-bold">Settings</h2>
        {!editing ? (
          <button type="button" className="btn-soft" onClick={() => setEditing(true)}>
            <Icon.user className="h-4 w-4" /> Edit profile
          </button>
        ) : null}
      </div>

      {error ? <div className="p-3"><ErrorNote onDismiss={() => setError('')}>{error}</ErrorNote></div> : null}

      {/* ------------------------------------------------------- profile */}
      <div className="flex items-center gap-4 px-4 py-5">
        <div className="relative">
          <Avatar name={profile.displayName || 'You'} src={profile.avatarUrl} size={72} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickAvatar} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Change photo"
            className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-brand-600 text-white shadow dark:border-ink-900"
          >
            {uploading ? <Spinner className="h-3.5 w-3.5" /> : <Icon.image className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold">{profile.displayName || 'You'}</div>
          <div className="truncate text-sm text-ink-500 dark:text-ink-400">
            {profile.email || profile.phone || ''}
          </div>
          {profile.about ? (
            <div className="truncate text-[13px] text-ink-500 dark:text-ink-400">{profile.about}</div>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="mx-4 mb-4 rounded-2xl border border-ink-200 p-4 dark:border-white/10 animate-fade-up">
          <label className="label" htmlFor="dn">Display name</label>
          <input
            id="dn"
            className="field"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
          />

          <label className="label mt-3" htmlFor="ab">About</label>
          <input
            id="ab"
            className="field"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="Available"
            maxLength={139}
          />

          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" onClick={saveProfile} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : <Icon.check className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setEditing(false);
                setDisplayName(profile.displayName || '');
                setAbout(profile.about || '');
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

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

      <Section title="Notifications">
        <ToggleRow
          icon={Icon.info}
          title="Desktop notifications"
          subtitle={
            notificationPermission() === 'granted'
              ? 'You will be notified about new messages'
              : 'Get a popup when a message arrives'
          }
          value={prefs.notifications}
          onChanged={toggleNotifications}
        />
        <ToggleRow
          icon={Icon.mic}
          title="Message sounds"
          subtitle="Play a short chime for new messages"
          value={prefs.sounds}
          onChanged={() => setPrefs(setPref('sounds', !prefs.sounds))}
        />
      </Section>

      <Section title="Privacy">
        <ToggleRow
          icon={Icon.user}
          title="Show when I am online"
          subtitle="Contacts can see your online status and last seen"
          value={showOnline}
          onChanged={toggleOnline}
        />
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
        <button
          type="button"
          className="btn w-full border border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
          onClick={onSignedOut}
        >
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

/** Labelled switch row used by the settings sections. */
function ToggleRow({ icon: I, title, subtitle, value, onChanged }) {
  return (
    <button
      type="button"
      onClick={() => onChanged(!value)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
        <I className="h-5 w-5" />
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