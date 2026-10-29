import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Mail, ShieldAlert } from 'lucide-react';
import { useSession, type User } from '@chatgram/core';
import { ApiError } from '@chatgram/api-client';
import { api } from '../../lib/api';
import type { SettingsPageProps } from './types';
import {
  RowDivider,
  SettingsDialog,
  SettingsGroup,
  SettingsNotice,
  SettingsPage,
  SettingsRow,
  focusRing,
} from './ui';

/**
 * Delete account — three deliberate steps, matching the server contract:
 *   POST /api/account/delete/request-code  {}                         -> { sent, channel, expiresInSeconds }
 *   POST /api/account/delete/confirm       { password?, code, confirmWord: 'DELETE', reason? }
 *                                                                       -> { scheduled, deleteAt }
 *   POST /api/account/delete/cancel        {}                         -> { cancelled: true }
 * Password is only checked at confirm time and not required for Google-only
 * accounts; the 14-day grace period is stored on the user and surfaced as
 * `pendingDeletion: { deleteAt, reason? }` by /auth/me.
 * If the routes are not deployed on an environment (404), the page says so
 * plainly instead of pretending.
 */
const CONFIRM_WORD = 'DELETE';

type Availability = 'idle' | 'unavailable';

interface DeleteConfirmResponse {
  scheduled?: boolean;
  deleteAt?: string;
  message?: string;
}

interface DeleteCancelResponse {
  cancelled?: boolean;
  message?: string;
}

/** Additive /auth/me field added with protected self-deletion. */
type UserWithDeletion = User & {
  pendingDeletion?: { deleteAt?: string | null; reason?: string | null } | null;
};

function apiStatus(error: unknown): number {
  return error instanceof ApiError ? error.status : 0;
}

function apiCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

function isMissingRoute(error: unknown): boolean {
  const status = apiStatus(error);
  return status === 404 || status === 405 || status === 501;
}

/** Truthful wording for the confirm-step failures (codes match the server). */
function confirmErrorMessage(error: unknown): string {
  switch (apiCode(error)) {
    case 'PASSWORD_REQUIRED':
      return 'Enter your current password to continue.';
    case 'PASSWORD_INVALID':
      return 'That password is not correct.';
    case 'CONFIRM_WORD_REQUIRED':
      return 'Type DELETE exactly in the confirmation box.';
    case 'CODE_EXPIRED':
      return 'That code has expired. Request a new one.';
    case 'CODE_INVALID':
      return 'That code is not correct.';
    case 'CODE_MISSING':
      return 'That code is no longer valid. Request a new one.';
    case 'CODE_TOO_MANY_ATTEMPTS':
      return 'Too many wrong codes. Request a new code.';
    case 'EMAIL_REQUIRED':
      return 'Add an email address to your account before deleting it.';
    default:
      return error instanceof Error ? error.message : 'Could not schedule the deletion.';
  }
}

export default function DeleteAccountPage({ onBack, navigate }: SettingsPageProps) {
  const user = useSession((s) => s.user) as UserWithDeletion | null;
  const setUser = useSession((s) => s.setUser);
  const [availability, setAvailability] = useState<Availability>('idle');
  const [password, setPassword] = useState('');
  const [googleOnly, setGoogleOnly] = useState(false);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'request' | 'code'>('request');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState('');
  const [scheduledFor, setScheduledFor] = useState<string | null>(() => {
    const fromSession = user?.pendingDeletion?.deleteAt ?? null;
    return fromSession;
  });

  // The session user may predate the deletion, and `userFromJson` intentionally
  // keeps only the core profile fields, so read /auth/me raw to see the additive
  // `pendingDeletion` contract field (a deletion scheduled on any device).
  useEffect(() => {
    let alive = true;
    void api
      .request<UserWithDeletion>('/api/auth/me')
      .then((fresh) => {
        if (!alive) return;
        const pending = fresh.pendingDeletion;
        if (pending?.deleteAt) setScheduledFor(pending.deleteAt);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function refreshSession() {
    try {
      setUser(await api.me());
    } catch {
      /* the session may be stale; the page still works from the raw response */
    }
  }

  const hasEmail = Boolean(user?.email);
  const phoneOnly = Boolean(user?.phone) && !hasEmail;

  async function requestCode() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const payload = await api.request<{ sent?: boolean; channel?: string; expiresInSeconds?: number; message?: string }>(
        '/api/account/delete/request-code',
        { method: 'POST', body: {} },
      );
      setStage('code');
      setNotice(
        payload?.message ??
          `We emailed a 6-digit confirmation code to ${user?.email ?? 'your registered email'}. It expires in ${
            Math.round((payload?.expiresInSeconds ?? 600) / 60)
          } minutes.`,
      );
    } catch (err) {
      if (isMissingRoute(err)) {
        setAvailability('unavailable');
        return;
      }
      const code = apiCode(err);
      if (code === 'EMAIL_REQUIRED') {
        setError('Add an email address to your account before deleting it.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not send the confirmation code');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeletion() {
    setError('');
    setBusy(true);
    try {
      const payload = await api.request<DeleteConfirmResponse>('/api/account/delete/confirm', {
        method: 'POST',
        body: {
          password: googleOnly ? undefined : password || undefined,
          code: code.trim(),
          confirmWord: confirmWord.trim(),
          reason: reason.trim() || undefined,
        },
      });
      const scheduledAt = payload?.deleteAt && !Number.isNaN(Date.parse(payload.deleteAt)) ? payload.deleteAt : null;
      setScheduledFor(scheduledAt);
      setConfirmOpen(false);
      setStage('request');
      setCode('');
      setReason('');
      setConfirmWord('');
      setNotice(
        scheduledAt
          ? `Your account is scheduled for deletion on ${new Date(scheduledAt).toLocaleDateString()}. You can cancel until then.`
          : 'Your account is scheduled for deletion in 14 days. You can cancel until then.',
      );
      void refreshSession();
    } catch (err) {
      setConfirmOpen(false);
      if (isMissingRoute(err)) {
        setAvailability('unavailable');
        return;
      }
      setError(confirmErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelDeletion() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const payload = await api.request<DeleteCancelResponse>('/api/account/delete/cancel', { method: 'POST', body: {} });
      setScheduledFor(null);
      setNotice(payload?.message ?? 'Account deletion cancelled. Your account stays active.');
      void refreshSession();
    } catch (err) {
      if (isMissingRoute(err)) {
        setAvailability('unavailable');
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not cancel the deletion');
    } finally {
      setBusy(false);
    }
  }

  if (availability === 'unavailable') {
    return (
      <SettingsPage title="Delete account" onBack={onBack} testId="settings-page-delete-account">
        <SettingsGroup title="Not available yet">
          <div className="px-4 py-6 text-center" data-testid="settings-delete-unavailable">
            <ShieldAlert className="mx-auto h-8 w-8 text-amber-500" aria-hidden="true" />
            <p className="mt-2 text-[14px] font-semibold">Account deletion is not available yet</p>
            <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
              The team is still rolling out the 14-day deletion flow. Nothing was deleted, and your account is
              unchanged. In the meantime you can log out from Account, or contact support and ask us to delete it.
            </p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" className={`btn-primary ${focusRing}`} onClick={() => navigate('account')}>
                Back to Account
              </button>
              <button type="button" className={`btn-ghost ${focusRing}`} onClick={() => navigate('help')}>
                Contact support
              </button>
            </div>
          </div>
        </SettingsGroup>
      </SettingsPage>
    );
  }

  if (scheduledFor) {
    return (
      <SettingsPage title="Delete account" onBack={onBack} testId="settings-page-delete-account">
        {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
        {notice ? <div className="mb-2"><SettingsNotice tone="success">{notice}</SettingsNotice></div> : null}
        <SettingsGroup title="Scheduled for deletion">
          <div className="px-4 py-4" data-testid="settings-delete-scheduled">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-rose-700 dark:text-rose-300">
                  Your account is scheduled for deletion on {new Date(scheduledFor).toLocaleDateString()}.
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
                  You will be signed out permanently on that date. Until then you can cancel and keep your account and
                  chats.
                </p>
              </div>
            </div>
            <button
              type="button"
              className={`btn-primary mt-3 w-full ${focusRing}`}
              disabled={busy}
              onClick={() => void cancelDeletion()}
              data-testid="settings-delete-cancel"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {busy ? 'Cancelling…' : 'Cancel deletion'}
            </button>
          </div>
        </SettingsGroup>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title="Delete account"
      description="A 14-day grace period: you can cancel during it"
      onBack={onBack}
      testId="settings-page-delete-account"
    >
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
      {notice ? <div className="mb-2"><SettingsNotice tone="success">{notice}</SettingsNotice></div> : null}

      <SettingsGroup title="What gets deleted">
        <div className="px-4 py-3 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-200">
          <p>
            Deleting your account <strong>permanently</strong> removes your profile, avatar, statuses, contacts,
            settings and the messages you sent.
          </p>
          <p className="mt-2">
            <strong>What remains:</strong> messages you sent stay visible in other people&apos;s chats (with your name
            replaced by “Deleted account” where the server supports it). Groups you own are transferred to another
            admin, or closed if you were the last member.
          </p>
          <p className="mt-2">
            The deletion is scheduled <strong>14 days ahead</strong> so you can cancel if you change your mind.
          </p>
        </div>
      </SettingsGroup>

      {phoneOnly ? (
        <div className="mt-3">
          <SettingsNotice tone="warning">
            This account has a phone number but no email. Deletion needs a 6-digit code emailed to a registered email,
            so add and verify an email first.
          </SettingsNotice>
          <SettingsRow
            icon={Mail}
            title="Add an email address"
            subtitle="Account → Change email or phone"
            onClick={() => navigate('account')}
            testId="settings-delete-add-email"
          />
        </div>
      ) : (
        <>
          <SettingsGroup title="Step 1 of 3 · confirm it is you">
            {googleOnly ? (
              <div className="px-4 py-3">
                <SettingsNotice tone="info">
                  Google-only account: no password needed. We will email a code to {user?.email}.
                </SettingsNotice>
              </div>
            ) : (
              <div className="px-4 py-3">
                <label className="label" htmlFor="delete-password">
                  Current password
                </label>
                <input
                  id="delete-password"
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Checked on the final step"
                />
                <label className="mt-2 flex items-center gap-2 text-[12px] text-ink-600 dark:text-ink-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-ink-300"
                    checked={googleOnly}
                    onChange={(event) => setGoogleOnly(event.target.checked)}
                  />
                  I signed in with Google and have no password
                </label>
              </div>
            )}
            <RowDivider />
            <SettingsRow
              icon={Mail}
              title="Email me a 6-digit code"
              subtitle={`Sent to ${user?.email ?? 'your registered email'}`}
              testId="settings-delete-request-code"
              trailing={busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : undefined}
              onClick={() => {
                if (!hasEmail) {
                  setError('Add an email address to your account before deleting it.');
                  return;
                }
                void requestCode();
              }}
            />
          </SettingsGroup>

          {stage === 'code' ? (
            <SettingsGroup title="Step 2 of 3 · enter the code">
              <div className="px-4 py-3">
                <label className="label" htmlFor="delete-code">6-digit code from your email</label>
                <input
                  id="delete-code"
                  className="field tracking-[0.4em]"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                />
                <label className="label mt-3" htmlFor="delete-reason">
                  Reason (optional)
                </label>
                <textarea
                  id="delete-reason"
                  className="field min-h-[64px] resize-y"
                  maxLength={200}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Anything you want the team to know"
                />
                <button
                  type="button"
                  className={`btn mt-3 w-full border border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10 ${focusRing}`}
                  disabled={code.length !== 6 || busy}
                  onClick={() => {
                    setError('');
                    setConfirmWord('');
                    setConfirmOpen(true);
                  }}
                  data-testid="settings-delete-continue"
                >
                  Continue to the final step
                </button>
              </div>
            </SettingsGroup>
          ) : null}
        </>
      )}

      {confirmOpen ? (
        <SettingsDialog
          title="Delete my account permanently?"
          description="This cannot be undone once the 14-day grace period ends. Type DELETE to confirm."
          destructive
          onClose={() => setConfirmOpen(false)}
          testId="settings-delete-confirm-dialog"
          footer={
            <>
              <button type="button" className={`btn-ghost flex-1 ${focusRing}`} onClick={() => setConfirmOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn flex-1 bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 ${focusRing}`}
                disabled={confirmWord.trim() !== CONFIRM_WORD || busy}
                onClick={() => void confirmDeletion()}
                data-testid="settings-delete-final"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                {busy ? 'Deleting…' : 'Delete my account'}
              </button>
            </>
          }
        >
          <label className="label" htmlFor="delete-confirm-word">Type {CONFIRM_WORD} to confirm</label>
          <input
            id="delete-confirm-word"
            className="field"
            value={confirmWord}
            onChange={(event) => setConfirmWord(event.target.value)}
            autoComplete="off"
            placeholder={CONFIRM_WORD}
          />
          {!googleOnly ? (
            <p className="mt-2 text-[11.5px] leading-snug text-ink-500 dark:text-ink-400">
              Your password is verified when you press the red button.
            </p>
          ) : null}
        </SettingsDialog>
      ) : null}
    </SettingsPage>
  );
}

