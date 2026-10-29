import { useEffect, useState } from 'react';
import { Clock, Loader2, Users } from 'lucide-react';
import { ApiError } from '@chatgram/api-client';
import { api } from '../../lib/api';
import type { SettingsPageProps } from './types';
import {
  SettingsChoice,
  SettingsField,
  SettingsGroup,
  SettingsNotice,
  SettingsPage,
  SettingsSpinner,
  SettingsToggle,
  focusRing,
} from './ui';

/**
 * Auto-reply — server contract being built in parallel:
 *   GET  /api/users/me/auto-reply  -> { enabled, message, schedule, startTime, endTime, audience }
 *   PUT  /api/users/me/auto-reply  -> same shape
 * Read tolerantly (unknown aliases ignored, malformed values fall back to the
 * defaults); a 404/405 shows an honest "not available yet" state and disables
 * saving instead of pretending the save worked.
 */
const MAX_MESSAGE = 500;

type Schedule = 'always' | 'outside-hours';
type Audience = 'contacts' | 'everyone';

interface RawAutoReply {
  enabled?: unknown;
  message?: unknown;
  schedule?: unknown;
  mode?: unknown;
  start?: unknown;
  startTime?: unknown;
  end?: unknown;
  endTime?: unknown;
  audience?: unknown;
}

function normalizeSchedule(value: unknown): Schedule {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('outside') || text === 'hours' || text === 'custom' || text === 'scheduled') {
    return 'outside-hours';
  }
  return 'always';
}

function normalizeAudience(value: unknown): Audience {
  return String(value ?? '').toLowerCase() === 'everyone' ? 'everyone' : 'contacts';
}

function timeOr(value: unknown, fallback: string): string {
  const text = String(value ?? '');
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function isMissingRoute(error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : 0;
  return status === 404 || status === 405 || status === 501;
}

export default function AutoReplyPage({ onBack }: SettingsPageProps) {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [schedule, setSchedule] = useState<Schedule>('always');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('08:00');
  const [audience, setAudience] = useState<Audience>('contacts');
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    void api
      .request<RawAutoReply>('/api/users/me/auto-reply')
      .then((raw) => {
        if (!alive) return;
        setEnabled(raw?.enabled === true);
        setMessage(typeof raw?.message === 'string' ? raw.message.slice(0, MAX_MESSAGE) : '');
        setSchedule(normalizeSchedule(raw?.schedule ?? raw?.mode));
        setStartTime(timeOr(raw?.startTime ?? raw?.start, '18:00'));
        setEndTime(timeOr(raw?.endTime ?? raw?.end, '08:00'));
        setAudience(normalizeAudience(raw?.audience));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (isMissingRoute(err)) setUnavailable(true);
        else setError(err instanceof Error ? err.message : 'Could not load the auto-reply settings');
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
      await api.request('/api/users/me/auto-reply', {
        method: 'PUT',
        // Wire contract uses the camelCase spelling; the page keeps a dashed internal state.
        body: { enabled, message: message.trim(), schedule: schedule === 'outside-hours' ? 'outsideHours' : 'always', startTime, endTime, audience },
      });
      setNotice('Auto-reply saved.');
    } catch (err) {
      if (isMissingRoute(err)) {
        setUnavailable(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not save the auto-reply');
    } finally {
      setBusy(false);
    }
  }

  const remaining = MAX_MESSAGE - message.length;
  const canSave = !unavailable && !loading && !busy && (!enabled || message.trim().length > 0);

  return (
    <SettingsPage
      title="Auto-reply"
      description="An automatic reply when you are away"
      onBack={onBack}
      testId="auto-reply-page"
    >
      {loading ? <SettingsSpinner label="Loading auto-reply…" /> : null}
      {unavailable ? (
        <div className="mb-2">
          <SettingsNotice tone="warning">
            Auto-reply is not available yet. The server route is still being rolled out — nothing was saved.
          </SettingsNotice>
        </div>
      ) : null}
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
      {notice ? <div className="mb-2"><SettingsNotice tone="success">{notice}</SettingsNotice></div> : null}

      <SettingsGroup title="Auto-reply">
        <SettingsToggle
          icon={Clock}
          title="Send an auto-reply when I am away"
          subtitle="One automatic reply to people who message you directly"
          checked={enabled}
          onChange={setEnabled}
          disabled={unavailable || loading}
          testId="auto-reply-enabled"
        />
      </SettingsGroup>

      <SettingsGroup title="Message">
        <SettingsField
          id="auto-reply-message"
          label="Auto-reply message"
          hint={`${remaining} characters left`}
        >
          <textarea
            id="auto-reply-message"
            data-testid="auto-reply-message"
            className="field min-h-[92px] resize-y"
            maxLength={MAX_MESSAGE}
            value={message}
            disabled={unavailable || loading}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="e.g. I am away from my phone and will reply as soon as I can."
          />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup title="When">
        <SettingsChoice
          title="Schedule"
          ariaLabel="Auto-reply schedule"
          value={schedule}
          onChange={(key) => setSchedule(key === 'outside-hours' ? 'outside-hours' : 'always')}
          options={[
            { key: 'always', label: 'Always' },
            { key: 'outside-hours', label: 'Outside hours' },
          ]}
          testId="auto-reply-schedule"
        />
        {schedule === 'outside-hours' ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 px-4 py-3 text-[13px] dark:border-white/[.06]">
            <label className="flex items-center gap-2">
              Between
              <input
                type="time"
                aria-label="Auto-reply starts at"
                className="field h-9 w-[136px]"
                value={startTime}
                disabled={unavailable || loading}
                onChange={(event) => setStartTime(event.target.value)}
                data-testid="auto-reply-start"
              />
            </label>
            <label className="flex items-center gap-2">
              and
              <input
                type="time"
                aria-label="Auto-reply ends at"
                className="field h-9 w-[136px]"
                value={endTime}
                disabled={unavailable || loading}
                onChange={(event) => setEndTime(event.target.value)}
                data-testid="auto-reply-end"
              />
            </label>
          </div>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Who gets it">
        <SettingsChoice
          title="Audience"
          ariaLabel="Auto-reply audience"
          value={audience}
          onChange={(key) => setAudience(key === 'everyone' ? 'everyone' : 'contacts')}
          options={[
            { key: 'contacts', label: 'Contacts only' },
            { key: 'everyone', label: 'Everyone' },
          ]}
          testId="auto-reply-audience"
        />
        <div className="flex items-start gap-2 border-t border-ink-100 px-4 py-3 text-[11.5px] leading-relaxed text-ink-500 dark:border-white/[.06] dark:text-ink-400">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Groups, blocked people and Chatgram AI never receive it. Each person gets at most one auto-reply per day, and
          the reply is only sent once per conversation window.
        </div>
      </SettingsGroup>

      <SettingsGroup title="Preview">
        <div className="px-4 py-3" data-testid="auto-reply-preview">
          <div className="mx-auto flex max-w-[420px] flex-col gap-2 rounded-2xl bg-ink-100 p-3 dark:bg-white/5">
            <div className="max-w-[80%] self-start rounded-2xl rounded-bl-md bg-white px-3 py-2 text-[13px] shadow-sm dark:bg-ink-700">
              Are you around?
            </div>
            <div className="max-w-[86%] self-end rounded-2xl rounded-br-md bg-brand-600 px-3 py-2 text-[13px] text-white shadow-sm">
              <span className="block whitespace-pre-wrap break-words">
                {message.trim() || 'Your auto-reply message will appear here.'}
              </span>
              <span className="mt-1 block text-[10.5px] text-white/70">Auto-reply · once per person per day</span>
            </div>
          </div>
        </div>
      </SettingsGroup>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid="auto-reply-save"
          className={`btn-primary flex-1 ${focusRing}`}
          disabled={!canSave}
          onClick={() => void save()}
          aria-busy={busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? 'Saving…' : 'Save auto-reply'}
        </button>
        <p className="flex-1 text-right text-[11px] text-ink-500 dark:text-ink-400">
          {unavailable ? 'Unavailable' : enabled ? 'On' : 'Off'}
        </p>
      </div>
    </SettingsPage>
  );
}


