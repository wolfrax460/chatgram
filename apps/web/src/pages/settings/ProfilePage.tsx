import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Copy, Mail, Pencil, Phone, Share2 } from 'lucide-react';
import { useSession } from '@chatgram/core';
import { api } from '../../lib/api';
import { useCopyToClipboard } from './ui';
import type { SettingsPageProps } from './types';
import { RowDivider, SettingsGroup, SettingsNotice, SettingsPage, SettingsField, focusRing } from './ui';

/**
 * Profile page (reached by tapping the profile card): avatar, display name,
 * about and a share link. Uses the existing uploadAvatar / updateProfile APIs.
 */
export default function ProfilePage({ onBack }: SettingsPageProps) {
  const user = useSession((s) => s.user);
  const patchUser = useSession((s) => s.patchUser);
  const { copied, copy } = useCopyToClipboard();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [about, setAbout] = useState(user?.about ?? '');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setAbout(user?.about ?? '');
  }, [user?.displayName, user?.about]);

  const meId = user?.id ?? '';
  const shareLink = (() => {
    try {
      return `${window.location.origin}/`;
    } catch {
      return 'https://chatgram-xi.vercel.app/';
    }
  })();

  async function pickAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image is larger than 10 MB.');
      return;
    }
    setUploading(true);
    try {
      const result = await api.uploadAvatar(meId, file);
      patchUser({ ...result.user, avatarUrl: result.url ?? result.user.avatarUrl });
      setNotice('Profile photo updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the photo');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaveError('');
    setNotice('');
    setBusy(true);
    try {
      const updated = await api.updateProfile(meId, { displayName: displayName.trim(), about: about.trim() });
      patchUser(updated);
      setNotice('Profile saved.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage title="Profile" description="Your name, photo and about" onBack={onBack} testId="settings-page-profile">
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
      {notice ? <div className="mb-2"><SettingsNotice tone="success">{notice}</SettingsNotice></div> : null}

      <SettingsGroup title="Your profile">
        <div className="flex flex-col items-center gap-2 px-4 py-5">
          <div className="relative">
            <div className="grid h-[88px] w-[88px] place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-2xl font-bold text-white">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                (user?.displayName ?? 'You').slice(0, 2).toUpperCase()
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => void pickAvatar(event)} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change profile photo"
              title="Change profile photo"
              className={`absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-brand-600 text-white shadow dark:border-ink-900 ${focusRing}`}
            >
              {uploading ? <span className="text-[10px]">…</span> : <Camera className="h-4 w-4" />}
            </button>
          </div>
          <p className="truncate text-lg font-bold" data-testid="settings-page-display-name">{user?.displayName}</p>
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[12px] text-ink-500 dark:text-ink-400">
            {user?.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{user.email}</span> : null}
            {user?.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{user.phone}</span> : null}
          </p>
        </div>
        <RowDivider />
        <SettingsField id="profile-name" label="Display name">
          <input
            id="profile-name"
            className="field"
            maxLength={40}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </SettingsField>
        <SettingsField id="profile-about" label="About" hint={`${139 - about.length} characters left`}>
          <input
            id="profile-about"
            className="field"
            maxLength={139}
            placeholder="Available"
            value={about}
            onChange={(event) => setAbout(event.target.value)}
          />
        </SettingsField>
        {saveError ? <div className="px-4 pb-2"><SettingsNotice tone="error">{saveError}</SettingsNotice></div> : null}
        <div className="flex gap-2 px-4 pb-3 pt-1">
          <button
            type="button"
            className={`btn-primary flex-1 ${focusRing}`}
            disabled={busy || !displayName.trim()}
            onClick={() => void save()}
            data-testid="settings-profile-save"
          >
            <Check className="h-4 w-4" /> {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Share your profile">
        <div className="px-4 py-3" data-testid="settings-profile-share-link">
          <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-700 dark:text-ink-200">{shareLink}</span>
            <button
              type="button"
              onClick={() => void copy(shareLink, 'profile')}
              aria-label="Copy profile share link"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-brand-700 hover:bg-brand-600/10 dark:text-brand-300 ${focusRing}`}
            >
              {copied === 'profile' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-500 dark:text-ink-400">
            <Share2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
            A QR code needs the profile-link endpoint that is not built yet; copy the link meanwhile.
          </p>
        </div>
        <RowDivider />
        <div className="flex items-start gap-2 px-4 py-3 text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">
          <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Tap your name or photo on the Settings card to come back here.
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}

