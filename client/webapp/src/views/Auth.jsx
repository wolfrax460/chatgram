import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { Icon, Logo, Spinner, ErrorNote } from '../components/ui.jsx';
import { useTheme } from '../lib/theme.js';

/**
 * Sign in / sign up / reset password.
 *
 * Mirrors the Flutter flow: identifier + password, optional email or SMS
 * verification on sign-up, and a 6-digit code to reset a forgotten password.
 */
export default function Auth({ onSignedIn }) {
  const { mode, setMode } = useTheme();
  const [tab, setTab] = useState('login'); // login | register | reset
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // login
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // register
  const [displayName, setDisplayName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  // reset
  const [resetId, setResetId] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword1, setResetPassword1] = useState('');
  const [resetPassword2, setResetPassword2] = useState('');
  const [resetSent, setResetSent] = useState(false);

  function switchTab(next) {
    setTab(next);
    setError('');
    setNotice('');
  }

  /* ------------------------------------------------------------- login */
  async function doLogin(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api.login(identifier.trim(), password);
      onSignedIn(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------- register */
  async function sendCode() {
    setError('');
    setSendingCode(true);
    try {
      const res = await api.sendCode(signupEmail.trim());
      setCodeSent(true);
      if (res?.devCode) setCode(String(res.devCode));
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingCode(false);
    }
  }

  async function verifyCode() {
    setError('');
    setBusy(true);
    try {
      const res = await api.checkCode(signupEmail.trim(), code.trim());
      if (!res?.verificationToken) throw new Error('That code was not accepted.');
      setVerificationToken(res.verificationToken);
      setNotice('Verified — choose a password to finish.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function doRegister(e) {
    e.preventDefault();
    setError('');
    if (signupPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (signupPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const data = await api.register({
        displayName: displayName.trim(),
        identifier: signupEmail.trim(),
        password: signupPassword,
        ...(verificationToken ? { verificationToken } : {}),
      });
      onSignedIn(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /* -------------------------------------------------------------- reset */
  async function sendResetCode() {
    setError('');
    setSendingCode(true);
    try {
      await api.forgotPassword(resetId.trim());
      setResetSent(true);
      setNotice('If that account exists, a 6-digit code is on its way.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingCode(false);
    }
  }

  async function doReset(e) {
    e.preventDefault();
    setError('');
    if (resetPassword1.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (resetPassword1 !== resetPassword2) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(resetId.trim(), resetCode.trim(), resetPassword1);
      setNotice('Password changed — sign in with your new password.');
      setIdentifier(resetId.trim());
      setTab('login');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const cardTitle =
    tab === 'login' ? 'Sign in' : tab === 'register' ? 'Create account' : 'Reset password';

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl animate-float" />
        <div className="absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl animate-float" />
      </div>

      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Welcome to Chatgram</h1>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              Simple, reliable messaging — now on the web.
            </p>
          </div>
        </div>

        <div className="card p-6">
          {tab !== 'reset' ? (
            <div className="mb-6 flex rounded-xl bg-ink-100 p-1 dark:bg-white/5">
              {['login', 'register'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => switchTab(t)}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                    tab === t
                      ? 'bg-white text-brand-700 shadow-sm dark:bg-white/10 dark:text-white'
                      : 'text-ink-500 hover:text-ink-700 dark:text-ink-400'
                  }`}
                >
                  {t === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost !px-2"
                onClick={() => switchTab('login')}
                title="Back to sign in"
              >
                <Icon.back className="h-5 w-5" />
              </button>
              <h2 className="text-base font-bold">{cardTitle}</h2>
            </div>
          )}

          <ErrorNote onDismiss={() => setError('')}>{error}</ErrorNote>
          {notice && !error ? (
            <div className="mt-3 rounded-xl border border-brand-600/30 bg-brand-600/10 px-3.5 py-2.5 text-sm text-brand-700 dark:text-brand-300">
              {notice}
            </div>
          ) : null}

          {/* -------------------------------------------------- sign in */}
          {tab === 'login' ? (
            <form onSubmit={doLogin} className="mt-4 space-y-4">
              <div>
                <label className="label" htmlFor="identifier">Email or phone</label>
                <input
                  id="identifier"
                  className="field"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label className="label !mb-0" htmlFor="password">Password</label>
                  <button
                    type="button"
                    onClick={() => switchTab('reset')}
                    className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="password"
                  type="password"
                  className="field"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? <Spinner /> : <Icon.lock className="h-4 w-4" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : null}

          {/* ----------------------------------------------- create account */}
          {tab === 'register' ? (
            <form onSubmit={doRegister} className="mt-4 space-y-4">
              <div>
                <label className="label" htmlFor="name">Display name</label>
                <input
                  id="name"
                  className="field"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="email">Email or phone</label>
                <div className="flex gap-2">
                  <input
                    id="email"
                    className="field"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                  <button
                    type="button"
                    className="btn-soft shrink-0"
                    onClick={sendCode}
                    disabled={sendingCode || !signupEmail.trim()}
                  >
                    {sendingCode ? <Spinner className="h-4 w-4" /> : null}
                    {codeSent ? 'Resend' : 'Send code'}
                  </button>
                </div>
              </div>
              {codeSent ? (
                <div>
                  <label className="label" htmlFor="code">Verification code</label>
                  <div className="flex gap-2">
                    <input
                      id="code"
                      className="field tracking-[.4em]"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      inputMode="numeric"
                    />
                    <button
                      type="button"
                      className={verificationToken ? 'btn-ghost shrink-0' : 'btn-soft shrink-0'}
                      onClick={verifyCode}
                      disabled={code.trim().length < 4 || Boolean(verificationToken)}
                    >
                      {verificationToken ? <Icon.check className="h-4 w-4" /> : null}
                      {verificationToken ? 'Verified' : 'Verify'}
                    </button>
                  </div>
                </div>
              ) : null}
              <div>
                <label className="label" htmlFor="signup-password">Password</label>
                <input
                  id="signup-password"
                  type="password"
                  className="field"
                  autoComplete="new-password"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="confirm-password">Confirm password</label>
                <input
                  id="confirm-password"
                  type="password"
                  className="field"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  required
                />
                {confirmPassword && signupPassword !== confirmPassword ? (
                  <p className="mt-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                    Passwords do not match
                  </p>
                ) : null}
              </div>
              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? <Spinner /> : <Icon.user className="h-4 w-4" />}
                {busy ? 'Creating…' : 'Create account'}
              </button>
            </form>
          ) : null}

          {/* ------------------------------------------------ reset password */}
          {tab === 'reset' ? (
            <form onSubmit={doReset} className="mt-2 space-y-4">
              <div>
                <label className="label" htmlFor="reset-id">Email or phone</label>
                <div className="flex gap-2">
                  <input
                    id="reset-id"
                    className="field"
                    value={resetId}
                    onChange={(e) => setResetId(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                  <button
                    type="button"
                    className="btn-soft shrink-0"
                    onClick={sendResetCode}
                    disabled={sendingCode || !resetId.trim()}
                  >
                    {sendingCode ? <Spinner className="h-4 w-4" /> : null}
                    {resetSent ? 'Resend' : 'Send code'}
                  </button>
                </div>
              </div>
              {resetSent ? (
                <>
                  <div>
                    <label className="label" htmlFor="reset-code">6-digit code</label>
                    <input
                      id="reset-code"
                      className="field tracking-[.4em]"
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      inputMode="numeric"
                      required
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="reset-p1">New password</label>
                    <input
                      id="reset-p1"
                      type="password"
                      className="field"
                      autoComplete="new-password"
                      value={resetPassword1}
                      onChange={(e) => setResetPassword1(e.target.value)}
                      placeholder="At least 6 characters"
                      required
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="reset-p2">Confirm new password</label>
                    <input
                      id="reset-p2"
                      type="password"
                      className="field"
                      autoComplete="new-password"
                      value={resetPassword2}
                      onChange={(e) => setResetPassword2(e.target.value)}
                      placeholder="Repeat your password"
                      required
                    />
                    {resetPassword2 && resetPassword1 !== resetPassword2 ? (
                      <p className="mt-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                        Passwords do not match
                      </p>
                    ) : null}
                  </div>
                  <button type="submit" className="btn-primary w-full" disabled={busy}>
                    {busy ? <Spinner /> : <Icon.lock className="h-4 w-4" />}
                    {busy ? 'Updating…' : 'Set new password'}
                  </button>
                </>
              ) : (
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  Enter the email or phone on your account and we&apos;ll send a 6-digit code
                  to reset your password.
                </p>
              )}
            </form>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-center gap-1">
          {[
            ['light', Icon.sun],
            ['dark', Icon.moon],
            ['system', Icon.monitor],
          ].map(([key, I]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              title={`${key} theme`}
              className={`grid h-9 w-9 place-items-center rounded-full transition ${
                mode === key
                  ? 'bg-brand-600 text-white'
                  : 'text-ink-500 hover:bg-ink-200/60 dark:hover:bg-white/5'
              }`}
            >
              <I className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
