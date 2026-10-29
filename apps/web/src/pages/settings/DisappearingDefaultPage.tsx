import { useEffect, useState } from 'react';
import { Loader2, Timer } from 'lucide-react';
import { ApiError } from '@chatgram/api-client';
import { api } from '../../lib/api';
import type { SettingsPageProps } from './types';
import { SettingsChoice, SettingsGroup, SettingsNotice, SettingsPage, SettingsSpinner, focusRing } from './ui';

/**
 * Global default for disappearing messages (new direct chats only).
 * Server contract being built in parallel:
 *   GET/PUT /api/users/me/disappearing-default
 * The payload shape is not fixed yet, so reads accept `duration`, `seconds` or
 * `durationSeconds`; writes send the canonical `{ duration }` string. A 404
 * degrades to an honest unavailable state with saving disabled.
 */
type DisappearingChoice = 'off' | '24h' | '7d' | '90d';

const CHOICES: { key: DisappearingChoice; label: string; seconds: number }[] = [
  { key: 'off', label: 'Off', seconds: 0 },
  { key: '24h', label: '24 hours', seconds: 86_400 },
  { key: '7d', label: '7 days', seconds: 604_800 },
  { key: '90d', label: '90 days', seconds: 7_776_000 },
];

interface RawDisappearingDefault {
  duration?: unknown;
  seconds?: unknown;
  durationSeconds?: unknown;
  defaultSeconds?: unknown;
  defaultDisappearingSeconds?: unknown;
}

function isMissingRoute(error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : 0;
  return status === 404 || status === 405 || status === 501;
}

function normalizeChoice(raw: RawDisappearingDefault | null | undefined): DisappearingChoice {
  const duration = String(raw?.duration ?? '').toLowerCase();
  if (duration === 'off' || duration === '24h' || duration === '7d' || duration === '90d') return duration;
  const secondsRaw = raw?.seconds ?? raw?.durationSeconds ?? raw?.defaultSeconds ?? raw?.defaultDisappearingSeconds;
  const seconds = typeof secondsRaw === 'number' ? secondsRaw : Number(secondsRaw);
  const match = CHOICES.find((choice) => choice.seconds === seconds);
  return match ? match.key : 'off';
}

export default function DisappearingDefaultPage({ onBack }: SettingsPageProps) {
  const [choice, setChoice] = useState<DisappearingChoice>('off');
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    void api
      .request<RawDisappearingDefault>('/api/users/me/disappearing-default')
      .then((raw) => {
        if (alive) setChoice(normalizeChoice(raw));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (isMissingRoute(err)) setUnavailable(true);
        else setError(err instanceof Error ? err.message : 'Could not load the disappearing-messages default');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.request('/api/users/me/disappearing-default', { method: 'PUT', body: { duration: choice } });
      setNotice('Default saved. It applies to new direct chats only.');
    } catch (err) {
      if (isMissingRoute(err)) {
        setUnavailable(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not save the default');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage
      title="Disappearing messages"
      description="Default for new direct chats"
      onBack={onBack}
      testId="disappearing-default-page"
    >
      {loading ? <SettingsSpinner label="Loading default…" /> : null}
      {unavailable ? (
        <div className="mb-2">
          <SettingsNotice tone="warning">
            Disappearing-messages default is not available yet. The server route is still being rolled out — nothing was
            saved.
          </SettingsNotice>
        </div>
      ) : null}
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
      {notice ? <div className="mb-2"><SettingsNotice tone="success">{notice}</SettingsNotice></div> : null}

      <SettingsGroup title="New messages disappear after">
        <SettingsChoice
          ariaLabel="Disappearing messages default"
          value={choice}
          onChange={(key) => setChoice(key as DisappearingChoice)}
          options={CHOICES.map((item) => ({ key: item.key, label: item.label }))}
          testId="disappearing-default-choice"
        />
        <div className="flex items-start gap-2 border-t border-ink-100 px-4 py-3 text-[11.5px] leading-relaxed text-ink-500 dark:border-white/[.06] dark:text-ink-400">
          <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            This is the default for <strong>new direct chats only</strong>. Existing chats keep their current setting,
            and groups are not affected. Per-chat settings are unchanged and can still be changed from each chat.
          </span>
        </div>
      </SettingsGroup>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid="disappearing-default-save"
          className={`btn-primary flex-1 ${focusRing}`}
          disabled={unavailable || loading || busy}
          onClick={() => void save()}
          aria-busy={busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? 'Saving…' : 'Save default'}
        </button>
        <p className="flex-1 text-right text-[11px] text-ink-500 dark:text-ink-400">
          {unavailable ? 'Unavailable' : `Current: ${CHOICES.find((item) => item.key === choice)?.label ?? 'Off'}`}
        </p>
      </div>
    </SettingsPage>
  );
}
