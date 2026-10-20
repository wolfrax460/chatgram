import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { Icon, Logo, Spinner, ErrorNote } from '../components/ui.jsx';
import { useTheme } from '../lib/theme.js';

/**
 * Sign in / sign up.
 *
 * Mirrors the Flutter flow: email (or phone) + password, or a verified sign-up
 * with a 6-digit code. The backend enforces verification when configured.
 */
export default function Auth({ onSignedIn }) {
  const { mode, setMode } = useTheme();
  const [tab, setTab] = useState('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // login
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // register
  const [displayName, setDisplayName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [code, setCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

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

  async function sendCode() {
    setError('');
    setSendingCode(true);
    try {
      const res = await api.sendCode(signupEmail.trim());
      setCodeSent(true);
      // In development the backend may return the code directly.
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
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function doRegister(e) {
    e.preventDefault();
    setError('');
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

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      {/* animated brand backdrop */}
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
          {/* tabs */}
          <div className="mb-6 flex rounded-xl bg-ink-100 p-1 dark:bg-white/5">
            {['login', 'register'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setError('');
                }}
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

          <ErrorNote onDismiss={() => setError('')}>{error}</ErrorNote>

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
                <label className="label" htmlFor="password">Password</label>
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
          ) : (
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
              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? <Spinner /> : <Icon.user className="h-4 w-4" />}
                {busy ? 'Creating…' : 'Create account'}
              </button>
            </form>
          )}
        </div>

        {/* theme switch */}
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
