import { useState } from 'react';
import { Mail, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { verificationFailure } from '../../lib/verificationMessages';
import { SettingsRow, SettingsNotice, focusRing } from './ui';

/**
 * Change the sign-in email/phone with the existing verification-code flow.
 * Moved out of the old Settings scroll unchanged (same endpoint, same truthful
 * CODE_* wording); it now opens inline inside the Account page.
 */
export function ChangeIdentifier({ onDone }: { onDone: (message: string) => void }) {
  const { t } = useI18n();
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
      // The identifier confirm checks a 6-digit code and returns the same
      // CODE_EXPIRED / CODE_INVALID / CODE_MISSING / too-many-attempts codes as
      // sign-up; say which one it was instead of the raw server sentence.
      const verification = verificationFailure(err);
      if (verification) {
        setError(
          t(verification.key, verification.retryAfterSeconds ? { seconds: verification.retryAfterSeconds } : undefined),
        );
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not save the new address');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <SettingsRow
        icon={Mail}
        title="Change email or phone"
        subtitle="We send a code to the new address before switching"
        testId="settings-change-identifier"
        onClick={() => setOpen(true)}
      />
    );
  }

  return (
    <div className="px-4 py-3" data-testid="change-identifier">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold">Change email or phone</p>
        <button
          type="button"
          className={`btn-ghost !px-2 ${focusRing}`}
          onClick={() => setOpen(false)}
          aria-label="Cancel changing the sign-in address"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
      {info ? <div className="mb-2"><SettingsNotice tone="info">{info}</SettingsNotice></div> : null}

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
          className={`btn-primary mt-3 w-full ${focusRing}`}
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
            <button
              type="button"
              className={`btn-primary flex-1 ${focusRing}`}
              disabled={busy || code.length !== 6}
              onClick={() => void confirm()}
            >
              {busy ? 'Saving…' : 'Verify and save'}
            </button>
            <button type="button" className={`btn-ghost ${focusRing}`} onClick={() => void requestCode()} disabled={busy}>
              Resend
            </button>
          </div>
        </>
      )}
    </div>
  );
}
