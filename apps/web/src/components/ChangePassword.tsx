import { useMemo, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Lock, ShieldCheck, X } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Settings → Account → Change password.
 *
 * - current + new + confirm, each with a show/hide toggle
 * - live strength meter and the same rules the server enforces
 * - on success the server returns a fresh token pair (this device stays signed
 *   in) and signs out every other device.
 */

const MIN_LENGTH = 8;

type Strength = 'weak' | 'fair' | 'good' | 'strong';

function scorePassword(password: string): { score: number; strength: Strength; hints: string[] } {
  const hints: string[] = [];
  let score = 0;
  if (password.length >= MIN_LENGTH) score += 1;
  else hints.push(`At least ${MIN_LENGTH} characters`);
  if (/[A-Za-z]/.test(password) && /[0-9]/.test(password)) score += 1;
  else hints.push('A letter and a number');
  if (password.length >= 12) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;

  const strength: Strength = score >= 5 ? 'strong' : score === 4 ? 'good' : score === 3 ? 'fair' : 'weak';
  return { score, strength, hints };
}

const STRENGTH_STYLE: Record<Strength, { label: string; bar: string; text: string }> = {
  weak: { label: 'Weak', bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
  fair: { label: 'Fair', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  good: { label: 'Good', bar: 'bg-lime-500', text: 'text-lime-600 dark:text-lime-400' },
  strong: { label: 'Strong', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
};

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className="field pr-11"
          type={visible ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
          className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-white/10"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function ChangePassword({ onDone }: { onDone?: (message: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [success, setSuccess] = useState('');

  const meter = useMemo(() => scorePassword(newPassword), [newPassword]);
  const style = STRENGTH_STYLE[meter.strength];
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setErrorCode('');
    setSuccess('');

    if (!currentPassword) {
      setError('Enter your current password.');
      setErrorCode('CURRENT_PASSWORD_REQUIRED');
      return;
    }
    if (newPassword.length < MIN_LENGTH) {
      setError(`Your new password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Your new password must be different from your current one.');
      return;
    }

    setSaving(true);
    try {
      const result = await api.changePassword(currentPassword, newPassword, confirmPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(
        result.notified?.email
          ? 'Password changed. Other devices were signed out and we emailed you a confirmation.'
          : 'Password changed. Every other device has been signed out.',
      );
      onDone?.(result.message || 'Password changed.');
    } catch (err) {
      const apiError = err as { message?: string; code?: string };
      setError(apiError.message || 'Could not change your password.');
      setErrorCode(apiError.code || '');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="px-4 py-3" onSubmit={submit} noValidate>
      <div className="mb-3 flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
          <KeyRound className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Change password</p>
          <p className="text-[13px] text-ink-500 dark:text-ink-400">
            Changing it signs you out everywhere else.
          </p>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          aria-live="polite"
          className="mb-3 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {error}
          {errorCode === 'PASSWORD_NOT_SET' ? (
            <span className="mt-1 block text-[13px]">
              Use &quot;Forgot password&quot; on the sign-in screen to set one.
            </span>
          ) : null}
        </p>
      ) : null}

      {success ? (
        <p
          role="status"
          aria-live="polite"
          className="mb-3 flex items-start gap-2 rounded-xl border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
        >
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{success}</span>
        </p>
      ) : null}

      <PasswordField
        id="current-password"
        label="Current password"
        value={currentPassword}
        onChange={setCurrentPassword}
        autoComplete="current-password"
        invalid={errorCode === 'CURRENT_PASSWORD_INVALID'}
        describedBy={errorCode === 'CURRENT_PASSWORD_INVALID' ? 'current-password-error' : undefined}
      />
      {errorCode === 'CURRENT_PASSWORD_INVALID' ? (
        <p id="current-password-error" className="mt-1 text-[13px] text-rose-600 dark:text-rose-400">
          Your current password is not correct.
        </p>
      ) : null}

      <div className="mt-3">
        <PasswordField
          id="new-password"
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          invalid={meter.strength === 'weak' && newPassword.length > 0}
          describedBy="new-password-help"
        />
      </div>

      <div id="new-password-help" className="mt-2">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2, 3].map((step) => (
            <span
              key={step}
              className={`h-1.5 flex-1 rounded-full ${step < meter.score ? style.bar : 'bg-ink-200 dark:bg-white/15'}`}
            />
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between text-[12px]">
          <span className={`font-semibold ${style.text}`}>{newPassword ? style.label : 'At least 8 characters'}</span>
          {meter.hints.length > 0 && newPassword ? (
            <span className="text-ink-500 dark:text-ink-400">Add: {meter.hints.slice(0, 2).join(', ')}</span>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        <PasswordField
          id="confirm-new-password"
          label="Confirm new password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          invalid={mismatch}
          describedBy={mismatch ? 'confirm-password-error' : undefined}
        />
      </div>
      {mismatch ? (
        <p id="confirm-password-error" className="mt-1 flex items-center gap-1 text-[13px] text-rose-600 dark:text-rose-400">
          <X className="h-3.5 w-3.5" /> Passwords do not match
        </p>
      ) : null}

      <button
        type="submit"
        className="btn-primary mt-4 w-full"
        disabled={saving || !currentPassword || !newPassword || !confirmPassword || mismatch}
      >
        {saving ? (
          'Changing…'
        ) : (
          <>
            <Lock className="h-4 w-4" /> Change password
          </>
        )}
      </button>

      <p className="mt-2 flex items-start gap-1.5 text-[12px] text-ink-500 dark:text-ink-400">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-300" />
        Your current password is checked, and every other signed-in device is logged out.
      </p>
    </form>
  );
}
