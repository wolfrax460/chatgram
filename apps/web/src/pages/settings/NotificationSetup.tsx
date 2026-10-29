import { useEffect, useState } from 'react';
import {
  appShell,
  batteryOptimization,
  openNotificationSettings,
  requestBatteryExemption,
  type BatteryOptimizationState,
} from '../../lib/nativeNotifications';
import {
  notificationPermission,
  refreshNotificationPermission,
  requestNotificationPermission,
  sendTestNotification,
  type PermissionState,
} from '../../lib/notify';

/**
 * Real notification state for the current platform (moved verbatim out of the
 * old Settings scroll; native Android/Windows behaviour must not regress).
 *
 * The old row was a toggle wired to `Notification.requestPermission()`, which is
 * a dead end in the two native shells: the Android WebView has no web
 * notification permission to grant and Electron's page permission never reaches
 * the OS. So the row reads the shell's own state, offers the action that can
 * actually change it (system prompt or the OS settings screen) and proves the
 * whole chain with a test notification.
 */
export function NotificationSetup() {
  const [shell] = useState(appShell);
  const [state, setState] = useState<PermissionState>(() => notificationPermission());
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [battery, setBattery] = useState<BatteryOptimizationState | null>(null);

  useEffect(() => {
    let alive = true;
    void refreshNotificationPermission().then((next) => {
      if (alive) setState(next);
    });
    void batteryOptimization().then((next) => {
      if (alive) setBattery(next);
    });
    // The OS setting can change while this page sits in the background.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshNotificationPermission().then((next) => alive && setState(next));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const granted = state === 'granted';
  const blocked = state === 'denied';
  const unsupported = state === 'unsupported';

  const stateLabel = granted
    ? 'Notifications are on'
    : blocked
      ? 'Notifications are blocked'
      : unsupported
        ? 'Notifications are not available here'
        : 'Notifications are off';

  const detail = granted
    ? shell === 'android'
      ? 'New messages and calls can notify you on this phone.'
      : shell === 'windows'
        ? 'Windows shows Chatgram toasts for new messages and calls.'
        : 'Your browser shows a popup for new messages.'
    : blocked
      ? shell === 'android'
        ? 'Turn on notifications for Chatgram in the Android settings.'
        : shell === 'windows'
          ? 'Turn on notifications for Chatgram in the Windows settings.'
          : 'Allow notifications for this site in your browser settings.'
      : unsupported
        ? 'This browser cannot show notifications.'
        : shell === 'android'
          ? 'Allow Chatgram to notify you about messages and calls.'
          : 'Turn notifications on so new messages are not missed.';

  async function allow() {
    setBusy(true);
    setHint('');
    try {
      const next = await requestNotificationPermission();
      setState(next);
      if (next === 'denied') setHint('Permission was refused. Allow notifications in the system settings.');
      else if (next === 'default') setHint('No prompt appeared. Open the system settings and allow notifications for Chatgram.');
    } finally {
      setBusy(false);
    }
  }

  async function openSettings() {
    const opened = await openNotificationSettings();
    setHint(
      opened
        ? 'Change the Chatgram notification setting, then come back to this page.'
        : shell === 'android'
          ? 'Open Settings → Apps → Chatgram → Notifications and allow them.'
          : 'Open Settings → System → Notifications and allow Chatgram.',
    );
  }

  async function test() {
    if (!granted) {
      await allow();
      return;
    }
    const result = sendTestNotification();
    setHint(
      result === 'blocked'
        ? 'The notification could not be shown. Check the system settings.'
        : 'A test notification was sent.',
    );
  }

  async function exemptBattery() {
    const opened = await requestBatteryExemption();
    setHint(
      opened
        ? 'Choose "Unrestricted" (or "Don\'t optimise") for Chatgram.'
        : 'Open Settings → Apps → Chatgram → Battery and choose Unrestricted.',
    );
  }

  return (
    <div className="px-4 pb-2 pt-2" data-testid="notification-setup">
      <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-3 dark:border-white/10 dark:bg-white/[.04]">
        <div className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
              granted ? 'bg-emerald-500' : blocked ? 'bg-rose-500' : 'bg-amber-400'
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold" data-testid="notification-state" data-state={state}>
              {stateLabel}
            </p>
            <p className="text-[12px] leading-snug text-ink-500 dark:text-ink-400">{detail}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {!granted && !unsupported ? (
            <button
              type="button"
              className="btn-primary !px-3 !py-1.5 text-[12px] disabled:opacity-60"
              onClick={() => void allow()}
              disabled={busy}
              data-testid="notification-allow"
            >
              {busy ? 'Asking…' : shell === 'android' ? 'Allow notifications' : 'Enable notifications'}
            </button>
          ) : null}
          {!unsupported && (blocked || shell !== 'browser') ? (
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 text-[12px]"
              onClick={() => void openSettings()}
              data-testid="notification-open-settings"
            >
              {shell === 'android' ? 'Android settings' : shell === 'windows' ? 'Windows settings' : 'System settings'}
            </button>
          ) : null}
          {granted ? (
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 text-[12px]"
              onClick={() => void test()}
              data-testid="notification-test"
            >
              Send test notification
            </button>
          ) : null}
        </div>
        {hint ? (
          <p className="mt-2 text-[12px] leading-snug text-ink-600 dark:text-ink-300" data-testid="notification-hint">
            {hint}
          </p>
        ) : null}
      </div>
      {battery && !battery.ignoring ? (
        <div className="mt-2 rounded-xl border border-amber-300/50 bg-amber-50 p-3 dark:border-amber-400/25 dark:bg-amber-400/10" data-testid="notification-battery">
          <p className="text-[12px] leading-snug text-amber-900 dark:text-amber-200">
            Android can pause background apps to save battery, which delays notifications. Allow background activity for
            Chatgram.
          </p>
          <button
            type="button"
            className="mt-2 text-[12px] font-semibold text-brand-700 underline dark:text-brand-300"
            onClick={() => void exemptBattery()}
            data-testid="notification-battery-action"
          >
            Allow background activity
          </button>
        </div>
      ) : null}
    </div>
  );
}
