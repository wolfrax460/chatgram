import { useEffect, useRef, useState } from 'react';
import {
  Mail, Lock, User, Eye, EyeOff, ArrowLeft, AlertCircle, CheckCircle2,
  Globe, Loader2, ShieldAlert, ArrowRight,
} from 'lucide-react';
import { useSession } from '@chatgram/core';
import { api, APP_VERSION } from '../lib/api';
import { ApiError } from '@chatgram/api-client';
import { useI18n, LOCALES, LOCALE_LABELS, type Locale } from '../lib/i18n';
import {
  COUNTRIES, DEFAULT_COUNTRY, looksLikePhone, passwordStrength, resolveIdentifier,
  type Country,
} from '../lib/phone';

type Screen = 'signin' | 'signup' | 'forgot' | 'reset';

const WINDOWS_URL = (import.meta.env.VITE_WINDOWS_URL as string | undefined) ?? '';
const ANDROID_URL = (import.meta.env.VITE_ANDROID_URL as string | undefined) ?? '';

/* --------------------------------------------------------------- helpers */

/** Map an API failure to a safe, non-enumerating message key. */
function errorKey(error: unknown): { key: string; retryAfter?: number } {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return { key: error.message.toLowerCase().includes('reach') ? 'errServerUnreachable' : 'errNoInternet' };
    }
    if (error.status === 429) {
      const match = /(\d+)\s*s/i.exec(error.message);
      return { key: 'errTooManyAttempts', retryAfter: match ? Number(match[1]) : 30 };
    }
    if (error.status === 401 || error.status === 400 || error.status === 404) {
      return { key: 'errWrongCredentials' };
    }
    return { key: 'errGeneric' };
  }
  return { key: 'errGeneric' };
}

function StrengthMeter({ password }: { password: string }) {
  const { t } = useI18n();
  const { score, key } = passwordStrength(password);
  if (!password) return null;
  const colors = ['bg-rose-500', 'bg-rose-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500'];
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-1 flex-1 rounded-full ${step <= score ? colors[score] : 'bg-ink-200 dark:bg-white/10'}`}
          />
        ))}
      </div>
      <p className="mt-1 text-[11.5px] text-ink-600 dark:text-ink-300">{t(key)}</p>
    </div>
  );
}

function Field({
  id, label, error, children, hint,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="label text-ink-700 dark:text-ink-200">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11.5px] text-ink-600 dark:text-ink-300">{hint}</p> : null}
      <p role="alert" aria-live="polite" className="mt-1 min-h-[16px] text-[12px] font-medium text-rose-600 dark:text-rose-400">
        {error ?? ''}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

function AuthShell({ children }: { children: React.ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const [langOpen, setLangOpen] = useState(false);

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden px-4 py-4">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-4 flex flex-col items-center gap-1.5 text-center">
          <img
            src="/web/chatgram-icon.svg"
            alt="Chatgram"
            width={96}
            height={96}
            className="h-16 w-16 drop-shadow-lg sm:h-20 sm:w-20"
          />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Chatgram</h1>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{t('tagline')}</p>
          </div>
        </div>

        {children}

        <footer className="mt-4 space-y-1.5 text-center text-[11.5px] text-ink-600 dark:text-ink-300">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <a href="/docs#privacy" className="hover:underline">{t('privacy')}</a>
            <span aria-hidden>·</span>
            <a href="/docs#terms" className="hover:underline">{t('terms')}</a>
            <span aria-hidden>·</span>
            <a href="mailto:support@chatgram.local" className="hover:underline">{t('help')}</a>
          </div>

          {WINDOWS_URL || ANDROID_URL ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              {WINDOWS_URL ? (
                <a href={WINDOWS_URL} className="hover:underline">{t('downloadWindows')}</a>
              ) : null}
              {ANDROID_URL ? (
                <a href={ANDROID_URL} className="hover:underline">{t('downloadAndroid')}</a>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setLangOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold hover:bg-ink-200/60 dark:hover:bg-white/5"
                aria-haspopup="listbox"
                aria-expanded={langOpen}
                aria-label={t('language')}
              >
                <Globe className="h-3.5 w-3.5" />
                {LOCALE_LABELS[locale]}
              </button>
              {langOpen ? (
                <div className="absolute bottom-full left-1/2 z-30 mb-1 w-40 -translate-x-1/2 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-ink-700">
                  {LOCALES.map((code: Locale) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => { setLocale(code); setLangOpen(false); }}
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10 ${
                        code === locale ? 'font-bold text-brand-700 dark:text-brand-300' : ''
                      }`}
                    >
                      {LOCALE_LABELS[code]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <span aria-hidden>·</span>
            <span>{t('version')} {APP_VERSION}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- sign in */

function SignIn({ onGo }: { onGo: (screen: Screen) => void }) {
  const setUser = useSession((s) => s.setUser);
  const { t } = useI18n();

  const [identifier, setIdentifier] = useState('');
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);

  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);

  const identifierRef = useRef<HTMLInputElement>(null);
  const showPhone = looksLikePhone(identifier);

  useEffect(() => {
    identifierRef.current?.focus();
  }, []);

  // Countdown for rate-limit retry-after.
  useEffect(() => {
    if (retryAfter === null) return undefined;
    if (retryAfter <= 0) { setRetryAfter(null); return undefined; }
    const timer = window.setTimeout(() => setRetryAfter((s) => (s === null ? null : s - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfter]);

  // Cold-start hint after 4 seconds.
  useEffect(() => {
    if (!busy) { setSlow(false); return undefined; }
    const timer = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(timer);
  }, [busy]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const errors: typeof fieldErrors = {};
    const resolved = resolveIdentifier(identifier, country);
    if (!resolved.ok) {
      errors.identifier =
        resolved.error === 'phone' ? t('errInvalidPhone') : resolved.error === 'required' ? t('errRequired') : t('errInvalidEmail');
    }
    if (!password) errors.password = t('errRequired');
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    api.setPersistent(keepSignedIn);
    try {
      const result = await api.login(resolved.value, password);
      setUser(result.user);
    } catch (error) {
      const mapped = errorKey(error);
      setFormError(t(mapped.key, mapped.retryAfter ? { seconds: mapped.retryAfter } : undefined));
      if (mapped.retryAfter) setRetryAfter(mapped.retryAfter);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-1 p-5" noValidate>
      <h2 className="mb-4 text-lg font-bold">{t('welcomeBack')}</h2>

      {formError ? (
        <div role="alert" className="mb-2 flex items-start gap-2 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span aria-live="assertive">{formError}</span>
        </div>
      ) : null}

      <Field id="signin-identifier" label={t('emailOrPhone')} error={fieldErrors.identifier} hint={t('emailOrPhoneHint')}>
        <div className="flex gap-2">
          {showPhone ? (
            <select
              aria-label={t('countryCode')}
              value={country.code}
              onChange={(e) => setCountry(COUNTRIES.find((c) => c.code === e.target.value) ?? DEFAULT_COUNTRY)}
              className="field h-11 w-[92px] shrink-0 px-2"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.dial} {c.code}</option>
              ))}
            </select>
          ) : null}
          <input
            ref={identifierRef}
            id="signin-identifier"
            type="text"
            inputMode={showPhone ? 'tel' : 'email'}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            className="field h-11 flex-1"
            placeholder={t('emailOrPhoneHint')}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            aria-invalid={Boolean(fieldErrors.identifier)}
            aria-describedby="signin-identifier-error"
          />
        </div>
      </Field>

      <Field id="signin-password" label={t('password')} error={fieldErrors.password}>
        <div className="relative">
          <input
            id="signin-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className="field h-11 pr-11"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
            onKeyDown={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
            aria-invalid={Boolean(fieldErrors.password)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t('hidePassword') : t('showPassword')}
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-500 hover:bg-ink-200/60 dark:hover:bg-white/10"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {capsLock ? (
          <p className="mt-1 flex items-center gap-1 text-[11.5px] font-semibold text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-3.5 w-3.5" /> {t('capsLockOn')}
          </p>
        ) : null}
      </Field>

      <div className="flex items-center justify-between pb-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-700 dark:text-ink-200">
          <input
            type="checkbox"
            checked={keepSignedIn}
            onChange={(e) => setKeepSignedIn(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
          />
          {t('keepSignedIn')}
        </label>
        <button type="button" onClick={() => onGo('forgot')} className="text-[13px] font-semibold text-brand-700 hover:underline dark:text-brand-300">
          {t('forgotPassword')}
        </button>
      </div>

      <button type="submit" className="btn-primary h-11 w-full" disabled={busy || retryAfter !== null}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        {busy ? t('signIn') + '…' : t('signIn')}
      </button>

      {slow ? (
        <p className="pt-1 text-center text-[12px] text-ink-600 dark:text-ink-300" aria-live="polite">{t('wakingUp')}</p>
      ) : null}

      <p className="pt-3 text-center text-[13px] text-ink-600 dark:text-ink-300">
        {t('newToChatgram')}{' '}
        <button type="button" onClick={() => onGo('signup')} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
          {t('createAccountLink')}
        </button>
      </p>
    </form>
  );
}

/* --------------------------------------------------------------- sign up */

function SignUp({ onGo }: { onGo: (screen: Screen) => void }) {
  const setUser = useSession((s) => s.setUser);
  const { t } = useI18n();

  const [step, setStep] = useState<'details' | 'verify'>('details');
  const [fullName, setFullName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agree, setAgree] = useState(false);
  const [code, setCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const showPhone = looksLikePhone(identifier);

  /** Step 1: validate, then ask the server to email a verification code. */
  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const next: Record<string, string> = {};
    if (!fullName.trim()) next.fullName = t('errRequired');

    const resolved = resolveIdentifier(identifier, country);
    if (!resolved.ok) {
      next.identifier =
        resolved.error === 'phone' ? t('errInvalidPhone') : resolved.error === 'required' ? t('errRequired') : t('errInvalidEmail');
    }
    if (resolved.kind === 'phone') setFormError(t('errPhoneSignupSoon'));
    else setFormError('');

    if (password.length < 8) next.password = t('errPasswordShort');
    if (password !== confirm) next.confirm = t('errPasswordMismatch');
    if (!agree) next.agree = t('errAgreeTerms');

    setErrors(next);
    if (Object.keys(next).length > 0 || resolved.kind === 'phone') return;

    setBusy(true);
    try {
      await api.sendCode(resolved.value);
      setInfo(t('infoCodeSent'));
      setStep('verify');
    } catch (error) {
      const mapped = errorKey(error);
      setFormError(t(mapped.key, mapped.retryAfter ? { seconds: mapped.retryAfter } : undefined));
    } finally {
      setBusy(false);
    }
  }

  /** Step 2: verify the code, then create the account. */
  async function finish(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setErrors({ code: t('errRequired') });
      return;
    }
    setErrors({});
    setFormError('');
    setBusy(true);
    try {
      let token = verificationToken;
      if (!token) {
        const checked = await api.checkCode(identifier.trim(), code.trim());
        token = checked.verificationToken ?? '';
        if (!token) throw new Error('That code was not accepted.');
        setVerificationToken(token);
      }
      const result = await api.register({
        displayName: fullName.trim(),
        identifier: identifier.trim(),
        password,
        verificationToken: token,
      });
      setUser(result.user);
    } catch (error) {
      const mapped = errorKey(error);
      setFormError(t(mapped.key === 'errWrongCredentials' ? 'errInvalidCode' : mapped.key));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={step === 'details' ? requestCode : finish} className="card space-y-1 p-5" noValidate>
      <h2 className="mb-3 text-lg font-bold">{t('createYourAccount')}</h2>

      {formError ? (
        <div role="alert" className="mb-2 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {formError}
        </div>
      ) : null}
      {info && step === 'verify' ? (
        <div role="status" className="mb-2 rounded-xl border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          {info}
        </div>
      ) : null}

      {step === 'details' ? (
        <>
          <Field id="signup-name" label={t('fullName')} error={errors.fullName}>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-500" />
              <input id="signup-name" className="field h-11 pl-9" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
          </Field>

          <Field id="signup-identifier" label={t('emailOrPhone')} error={errors.identifier} hint={t('emailOrPhoneHint')}>
            <div className="flex gap-2">
              {showPhone ? (
                <select aria-label={t('countryCode')} value={country.code} onChange={(e) => setCountry(COUNTRIES.find((c) => c.code === e.target.value) ?? DEFAULT_COUNTRY)} className="field h-11 w-[92px] shrink-0 px-2">
                  {COUNTRIES.map((c) => (<option key={c.code} value={c.code}>{c.dial} {c.code}</option>))}
                </select>
              ) : null}
              <div className="relative flex-1">
                <Mail className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-500" />
                <input id="signup-identifier" type="text" inputMode={showPhone ? 'tel' : 'email'} autoComplete="username" className="field h-11 pl-9" value={identifier} onChange={(e) => setIdentifier(e.target.value)} aria-invalid={Boolean(errors.identifier)} />
              </div>
            </div>
          </Field>

          <Field id="signup-password" label={t('password')} error={errors.password}>
            <div className="relative">
              <input id="signup-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" className="field h-11 pr-11" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(errors.password)} />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? t('hidePassword') : t('showPassword')} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-500 hover:bg-ink-200/60 dark:hover:bg-white/10">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <StrengthMeter password={password} />
          </Field>

          <Field id="signup-confirm" label={t('confirmPassword')} error={errors.confirm}>
            <input id="signup-confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" className="field h-11" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={Boolean(errors.confirm)} />
          </Field>

          <label className="mb-1 flex cursor-pointer items-start gap-2 text-[12.5px] text-ink-700 dark:text-ink-200">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600" />
            <span>
              {t('agreeTerms')}{' '}
              <a href="/docs#terms" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">{t('terms')}</a>{' '}
              /{' '}
              <a href="/docs#privacy" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">{t('privacy')}</a>
            </span>
          </label>
          <p role="alert" aria-live="polite" className="min-h-[14px] text-[12px] font-medium text-rose-600 dark:text-rose-400">{errors.agree ?? ''}</p>

          <button type="submit" className="btn-primary h-11 w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {busy ? t('sendCode') + '…' : t('sendCode')}
          </button>
        </>
      ) : (
        <>
          <p className="mb-1 text-[13px] text-ink-600 dark:text-ink-300">
            {t('infoVerifyEmail')}
          </p>
          <Field id="signup-code" label={t('verificationCode')} error={errors.code}>
            <input id="signup-code" className="field h-11 text-center text-lg tracking-[.4em]" inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
          </Field>

          <button type="submit" className="btn-primary h-11 w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {busy ? t('signUp') + '…' : t('verifyAndCreate')}
          </button>

          <div className="flex items-center justify-between pt-1 text-[12.5px]">
            <button type="button" className="font-semibold text-ink-600 hover:underline dark:text-ink-300" onClick={() => { setStep('details'); setInfo(''); setFormError(''); }}>
              ← {t('backToSignIn')}
            </button>
            <button
              type="button"
              className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
              onClick={async () => {
                try { await api.sendCode(identifier.trim()); setInfo(t('infoCodeResent')); } catch { setInfo(''); }
              }}
            >
              {t('resendCode')}
            </button>
          </div>
        </>
      )}

      {step === 'details' ? (
        <p className="pt-2 text-center text-[12.5px] text-ink-600 dark:text-ink-300">
          {t('alreadyHaveAccount')}{' '}
          <button type="button" onClick={() => onGo('signin')} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {t('signIn')}
          </button>
        </p>
      ) : null}
    </form>
  );
}
/* ---------------------------------------------------------------- forgot */

function Forgot({ onGo, onSent }: { onGo: (s: Screen) => void; onSent: (identifier: string) => void }) {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState('');
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const showPhone = looksLikePhone(identifier);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const resolved = resolveIdentifier(identifier, country);
    if (!resolved.ok) {
      setError(resolved.error === 'phone' ? t('errInvalidPhone') : resolved.error === 'required' ? t('errRequired') : t('errInvalidEmail'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.forgotPassword(resolved.value);
    } catch {
      // Never reveal whether the account exists.
    } finally {
      setBusy(false);
      setSent(true);
      onSent(resolved.value);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-2 p-6" noValidate>
      <button type="button" onClick={() => onGo('signin')} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-600 hover:underline dark:text-ink-300">
        <ArrowLeft className="h-3.5 w-3.5" /> {t('backToSignIn')}
      </button>
      <h2 className="text-lg font-bold">{t('forgotTitle')}</h2>

      {sent ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('infoResetSent')}</span>
        </div>
      ) : null}

      <Field id="forgot-identifier" label={t('emailOrPhone')} error={error} hint={t('emailOrPhoneHint')}>
        <div className="flex gap-2">
          {showPhone ? (
            <select aria-label={t('countryCode')} value={country.code} onChange={(e) => setCountry(COUNTRIES.find((c) => c.code === e.target.value) ?? DEFAULT_COUNTRY)} className="field h-11 w-[92px] shrink-0 px-2">
              {COUNTRIES.map((c) => (<option key={c.code} value={c.code}>{c.dial} {c.code}</option>))}
            </select>
          ) : null}
          <input id="forgot-identifier" className="field h-11 flex-1" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        </div>
      </Field>

      <button type="submit" className="btn-primary h-11 w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        {busy ? t('sendCode') + '…' : t('sendCode')}
      </button>

      {sent ? (
        <button type="button" onClick={() => onGo('reset')} className="btn-ghost h-11 w-full">
          {t('resetPassword')} <ArrowRight className="h-4 w-4" />
        </button>
      ) : null}
    </form>
  );
}

/* ----------------------------------------------------------------- reset */

function Reset({
  initialIdentifier,
  onGo,
}: {
  initialIdentifier: string;
  onGo: (s: Screen) => void;
}) {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!identifier.trim()) next.identifier = t('errRequired');
    if (!/^\d{6}$/.test(code.trim())) next.code = t('errRequired');
    if (password.length < 8) next.password = t('errPasswordShort');
    if (password !== confirm) next.confirm = t('errPasswordMismatch');
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      await api.resetPassword(identifier.trim(), code.trim(), password);
      setDone(true);
      setFormError('');
      window.setTimeout(() => onGo('signin'), 1800);
    } catch (error) {
      const mapped = errorKey(error);
      setFormError(t(mapped.key));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-1 p-5" noValidate>
      <button type="button" onClick={() => onGo('signin')} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-600 hover:underline dark:text-ink-300">
        <ArrowLeft className="h-3.5 w-3.5" /> {t('backToSignIn')}
      </button>
      <h2 className="mb-2 text-lg font-bold">{t('resetTitle')}</h2>

      {done ? (
        <div role="status" className="mb-2 flex items-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> {t('infoResetDone')}
        </div>
      ) : null}

      {formError ? (
        <div role="alert" className="mb-2 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {formError}
        </div>
      ) : null}

      <Field id="reset-identifier" label={t('emailOrPhone')} error={errors.identifier}>
        <input id="reset-identifier" className="field h-11" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
      </Field>

      <Field id="reset-code" label={t('verificationCode')} error={errors.code}>
        <input id="reset-code" className="field h-11 tracking-[.35em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </Field>

      <Field id="reset-password" label={t('newPassword')} error={errors.password}>
        <input id="reset-password" type="password" autoComplete="new-password" className="field h-11" value={password} onChange={(e) => setPassword(e.target.value)} />
        <StrengthMeter password={password} />
      </Field>

      <Field id="reset-confirm" label={t('confirmPassword')} error={errors.confirm}>
        <input id="reset-confirm" type="password" autoComplete="new-password" className="field h-11" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>

      <button type="submit" className="btn-primary h-11 w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        {busy ? t('resetPassword') + '…' : t('resetPassword')}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ main */

export default function Auth() {
  const [screen, setScreen] = useState<Screen>('signin');
  const [resetIdentifier, setResetIdentifier] = useState('');

  return (
    <AuthShell>
      {screen === 'signin' ? <SignIn onGo={setScreen} /> : null}
      {screen === 'signup' ? <SignUp onGo={setScreen} /> : null}
      {screen === 'forgot' ? <Forgot onGo={setScreen} onSent={(value) => setResetIdentifier(value)} /> : null}
      {screen === 'reset' ? <Reset initialIdentifier={resetIdentifier} onGo={setScreen} /> : null}
    </AuthShell>
  );
}
