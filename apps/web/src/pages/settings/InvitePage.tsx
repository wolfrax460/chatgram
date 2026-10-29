import { useState } from 'react';
import { Check, Copy, Share2, UserRoundPlus } from 'lucide-react';
import type { SettingsPageProps } from './types';
import { SettingsGroup, SettingsNotice, SettingsPage, SettingsCross, focusRing } from './ui';

function inviteLink(): string {
  try {
    return `${window.location.origin}/`;
  } catch {
    return 'https://chatgram-xi.vercel.app/';
  }
}

/** Invite a friend: the app link, with copy and the OS share sheet when available. */
export default function InvitePage({ onBack }: SettingsPageProps) {
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const link = inviteLink();

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setError('');
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Could not copy the link. Select it and copy manually.');
    }
  }

  async function share() {
    setError('');
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Chatgram', text: 'Join me on Chatgram', url: link });
        setNotice('Shared.');
      } else {
        await copy();
      }
    } catch {
      /* the user dismissed the share sheet */
    }
  }

  return (
    <SettingsPage title="Invite a friend" description="Share Chatgram with one tap" onBack={onBack} testId="settings-page-invite">
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
      {notice ? <div className="mb-2"><SettingsNotice tone="success">{notice}</SettingsNotice></div> : null}

      <SettingsGroup title="Your invite link">
        <div className="px-4 py-4" data-testid="settings-invite-link">
          <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-700 dark:text-ink-200">{link}</span>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="Copy invite link"
              data-testid="settings-invite-copy"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-brand-700 transition hover:bg-brand-600/10 dark:text-brand-300 ${focusRing}`}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-500 dark:text-ink-400">
            {copied ? 'Link copied.' : 'Send it over WhatsApp, email or anywhere else.'}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className={`btn-primary flex-1 ${focusRing}`} onClick={() => void share()} data-testid="settings-invite-share">
              <Share2 className="h-4 w-4" /> Share
            </button>
            <button type="button" className={`btn-ghost ${focusRing}`} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="px-4 py-3 text-[12px] leading-relaxed text-ink-500 dark:text-ink-400">
          <UserRoundPlus className="mr-1 inline h-4 w-4" aria-hidden="true" />
          Invite links open the Chatgram download page; the person can create an account with their email.
        </div>
        <div className="px-4 pb-3">
          <SettingsCross>Chatgram never sends the invite for you — you choose who sees the link.</SettingsCross>
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}
