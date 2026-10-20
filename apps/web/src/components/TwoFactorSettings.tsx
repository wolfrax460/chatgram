import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Security section — TOTP two-factor authentication.
 *
 * Enroll: fetch a secret + QR, scan it, confirm with a 6-digit code.
 * Disable: requires a current code, so a stolen session alone cannot turn it off.
 */
export default function TwoFactorSettings() {
  const qc = useQueryClient();
  const [step, setStep] = useState<'idle' | 'enrolling' | 'disabling'>('idle');
  const [enrollment, setEnrollment] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const statusQuery = useQuery({
    queryKey: ['2fa-status'],
    queryFn: () => api.twoFactorStatus(),
    retry: false,
  });
  const enabled = Boolean(statusQuery.data?.twoFactorEnabled);

  async function startEnroll() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await api.setupTwoFactor();
      setEnrollment({ secret: data.secret, qr: data.qr });
      setStep('enrolling');
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable() {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.enableTwoFactor(code);
      setBackupCodes((result as { recoveryCodes?: string[] }).recoveryCodes ?? []);
      setNotice('Two-factor authentication is on.');
      setStep('idle');
      setEnrollment(null);
      setCode('');
      await qc.invalidateQueries({ queryKey: ['2fa-status'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable() {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter a current 6-digit code to turn 2FA off.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.disableTwoFactor(code);
      setNotice('Two-factor authentication is off.');
      setStep('idle');
      setCode('');
      await qc.invalidateQueries({ queryKey: ['2fa-status'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[13px]">
        {enabled ? (
          <>
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">Two-factor authentication is on</span>
          </>
        ) : (
          <>
            <ShieldOff className="h-4 w-4 text-ink-500" />
            <span className="text-ink-600 dark:text-ink-300">Two-factor authentication is off</span>
          </>
        )}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      {step === 'idle' && !enabled ? (
        <>
          <p className="text-[12.5px] text-ink-600 dark:text-ink-300">
            Add a second step when signing in, using an authenticator app (Google Authenticator, Authy, 1Password…).
          </p>
          <button type="button" onClick={startEnroll} disabled={busy} className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-[13px]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
            Set up two-factor
          </button>
        </>
      ) : null}

      {backupCodes.length ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-[12.5px] font-bold text-amber-900 dark:text-amber-300">Save these backup codes now</p>
          <p className="mb-2 text-[11.5px] text-amber-800 dark:text-amber-200/90">
            Each code works once if you lose your authenticator. They will not be shown again.
          </p>
          <div className="grid grid-cols-2 gap-1 font-mono text-[12.5px] text-amber-900 dark:text-amber-200">
            {backupCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button type="button" onClick={() => setBackupCodes([])} className="btn-ghost mt-2 h-8 px-3 text-[11.5px]">I have saved them</button>
        </div>
      ) : null}

      {step === 'idle' && enabled ? (
        <button
          type="button"
          onClick={() => {
            setStep('disabling');
            setCode('');
            setError('');
            setNotice('');
          }}
          className="btn-ghost h-10 px-4 text-[13px] text-rose-600"
        >
          Turn off two-factor
        </button>
      ) : null}

      {step === 'enrolling' && enrollment ? (
        <>
          <p className="text-[12.5px] text-ink-600 dark:text-ink-300">
            1. Scan this QR code with your authenticator app.
          </p>
          <img src={enrollment.qr} alt="Two-factor QR code" className="h-[180px] w-[180px] rounded-xl border border-ink-200 bg-white p-1 dark:border-white/10" />
          <button type="button" onClick={() => setShowSecret((v) => !v)} className="text-left text-[11.5px] font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {showSecret ? 'Hide' : "Can't scan? Show the setup key"}
          </button>
          {showSecret ? (
            <p className="break-all rounded-lg bg-ink-100 px-2 py-1 font-mono text-[11.5px] dark:bg-white/10">{enrollment.secret}</p>
          ) : null}
          <p className="text-[12.5px] text-ink-600 dark:text-ink-300">2. Enter the 6-digit code it shows.</p>
          <input
            className="field h-11 max-w-[180px] text-center text-lg tracking-[.4em]"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            autoComplete="one-time-code"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmEnable} disabled={busy} className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-[13px]">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Turn on
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('idle');
                setEnrollment(null);
                setCode('');
                setError('');
              }}
              className="btn-ghost h-10 px-4 text-[13px]"
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}

      {step === 'disabling' ? (
        <>
          <p className="text-[12.5px] text-ink-600 dark:text-ink-300">Enter a current code from your authenticator app to turn 2FA off.</p>
          <input
            className="field h-11 max-w-[180px] text-center text-lg tracking-[.4em]"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            autoComplete="one-time-code"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmDisable} disabled={busy} className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-[13px]">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
              Turn off
            </button>
            <button type="button" onClick={() => { setStep('idle'); setCode(''); setError(''); }} className="btn-ghost h-10 px-4 text-[13px]">
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
