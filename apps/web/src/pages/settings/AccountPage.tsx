import { useState } from 'react';
import { Clock, KeyRound, LogOut, ShieldOff, Smartphone, Trash2, UserRound } from 'lucide-react';
import { useSession } from '@chatgram/core';
import { api } from '../../lib/api';
import { unregisterPushToken } from '../../lib/nativeNotifications';
import ChangePassword from '../../components/ChangePassword';
import TwoFactorSettings from '../../components/TwoFactorSettings';
import { ChangeIdentifier } from './ChangeIdentifier';
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
 * Account: sign-in details, address/password changes, two-factor, sessions and
 * the two irreversible actions (log out here, delete on its own page).
 */
export default function AccountPage({ onBack, navigate }: SettingsPageProps) {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionPassword, setSessionPassword] = useState('');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  async function logOutOtherDevices() {
    setSessionBusy(true);
    setError('');
    try {
      const result = await api.logoutOtherSessions(sessionPassword || undefined);
      setSessionPassword('');
      setSessionsOpen(false);
      setNotice(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out the other devices');
    } finally {
      setSessionBusy(false);
    }
  }

  async function logOut() {
    setLogoutBusy(true);
    try {
      // Push tokens are per-session: drop this device's token before ending the
      // session (the shells cannot unregister it after the app signs out).
      await unregisterPushToken().catch(() => undefined);
      await api.logout().catch(() => undefined);
      setUser(null);
    } finally {
      setLogoutBusy(false);
    }
  }

  return (
    <SettingsPage title="Account" description="Sign-in details, security and your account" onBack={onBack} testId="settings-page-account">
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
      {notice ? <div className="mb-2"><SettingsNotice tone="success">{notice}</SettingsNotice></div> : null}

      <SettingsGroup title="Sign-in details">
        <SettingsRow
          icon={UserRound}
          title="Sign-in details"
          subtitle={user?.email ?? user?.phone ?? 'No email or phone on file'}
          testId="settings-identifier"
        />
        <RowDivider />
        <ChangeIdentifier onDone={(message) => { setError(''); setNotice(message); void api.me().then((fresh) => setUser(fresh)).catch(() => {}); }} />
        <RowDivider />
        <ChangePassword onDone={(message) => { setError(''); setNotice(message); }} />
      </SettingsGroup>

      <SettingsGroup
        title="Security"
        description="Two-factor asks for a code from your authenticator app when you sign in."
      >
        <TwoFactorSettings />
        <RowDivider />
        <SettingsRow
          icon={Smartphone}
          title="Active sessions"
          subtitle="This device is signed in. Sign out every other session."
          testId="settings-active-sessions"
          onClick={() => setSessionsOpen(true)}
        />
      </SettingsGroup>

      <SettingsGroup title="Automation">
        <SettingsRow
          icon={Clock}
          title="Auto-reply"
          subtitle="Send an automatic reply when you are away"
          testId="settings-row-auto-reply"
          onClick={() => navigate('auto-reply')}
        />
      </SettingsGroup>

      <SettingsGroup title="Account">
        <SettingsRow
          icon={Trash2}
          title="Delete account"
          subtitle="Permanently delete your account and data, with a 14-day grace period"
          testId="settings-delete-account"
          destructive
          onClick={() => navigate('delete-account')}
        />
        <RowDivider />
        <SettingsRow
          icon={LogOut}
          title="Log out"
          subtitle="Sign out of Chatgram on this device"
          testId="settings-logout"
          onClick={() => setLogoutOpen(true)}
        />
      </SettingsGroup>

      <SettingsGroup>
        <p className="px-4 py-3 text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">
          Statuses disappear after 24 hours; their media is deleted with them.
        </p>
      </SettingsGroup>

      {sessionsOpen ? (
        <SettingsDialog
          title="Log out other devices"
          description="Every other session is signed out immediately. Confirm with your current password (not needed for Google-only accounts)."
          onClose={() => setSessionsOpen(false)}
          testId="settings-sessions-dialog"
          footer={
            <>
              <button
                type="button"
                className={`btn-primary flex-1 ${focusRing}`}
                disabled={sessionBusy}
                onClick={() => void logOutOtherDevices()}
              >
                <ShieldOff className="h-4 w-4" /> {sessionBusy ? 'Signing out…' : 'Log out other devices'}
              </button>
              <button type="button" className={`btn-ghost ${focusRing}`} onClick={() => setSessionsOpen(false)}>
                Cancel
              </button>
            </>
          }
        >
          <label className="label" htmlFor="sessions-password">Current password</label>
          <input
            id="sessions-password"
            className="field"
            type="password"
            autoComplete="current-password"
            value={sessionPassword}
            onChange={(event) => setSessionPassword(event.target.value)}
            placeholder="Only needed if you set a password"
          />
        </SettingsDialog>
      ) : null}

      {logoutOpen ? (
        <SettingsDialog
          title="Log out of Chatgram?"
          description="You will need to sign in again to use your chats."
          onClose={() => setLogoutOpen(false)}
          testId="settings-logout-dialog"
          footer={
            <>
              <button
                type="button"
                className={`btn-ghost flex-1 ${focusRing}`}
                onClick={() => setLogoutOpen(false)}
                disabled={logoutBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn flex-1 border border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10 ${focusRing}`}
                onClick={() => void logOut()}
                disabled={logoutBusy}
              >
                {logoutBusy ? 'Signing out…' : 'Log out'}
              </button>
            </>
          }
        />
      ) : null}

      <p className="mt-3 flex items-center gap-1.5 px-1 text-[11px] text-ink-400 dark:text-ink-500">
        <KeyRound className="h-3 w-3" aria-hidden="true" /> Sessions are invalidated by signing out other devices or changing your password.
      </p>
    </SettingsPage>
  );
}

