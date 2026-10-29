import { useEffect, useState } from 'react';
import { Bell, BellOff, MessageCircle, PhoneCall, Smartphone, Volume2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePrefs } from '@chatgram/core';
import { api } from '../../lib/api';
import { NotificationSetup } from './NotificationSetup';
import type { SettingsPageProps } from './types';
import {
  RowDivider,
  SettingsGroup,
  SettingsNotice,
  SettingsPage,
  SettingsRow,
  SettingsSpinner,
  SettingsToggle,
  SettingsCross,
  focusRing,
} from './ui';

/**
 * Notifications: the shipped real-state setup card is rendered verbatim
 * (native Android/Windows behaviour must not regress), then the client prefs and
 * the server-backed do-not-disturb schedule and muted-chat overrides.
 */
export default function NotificationsPage({ onBack }: SettingsPageProps) {
  const prefs = usePrefs();
  const queryClient = useQueryClient();
  const notificationPrefs = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.notificationPrefs() });
  const muted = useQuery({ queryKey: ['muted-chats'], queryFn: () => api.mutedChats() });

  const [dndEnabled, setDndEnabled] = useState(false);
  const [dndStart, setDndStart] = useState('22:00');
  const [dndEnd, setDndEnd] = useState('07:00');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!notificationPrefs.data) return;
    setDndEnabled(notificationPrefs.data.dndEnabled);
    setDndStart(notificationPrefs.data.dndStart);
    setDndEnd(notificationPrefs.data.dndEnd);
  }, [notificationPrefs.data]);

  const saveDnd = useMutation({
    mutationFn: (patch: { dndEnabled?: boolean; dndStart?: string; dndEnd?: string }) => api.updateNotificationPrefs(patch),
    onSuccess: () => {
      setNotice('Notification settings saved.');
      void queryClient.invalidateQueries({ queryKey: ['notification-prefs'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not save notification settings');
      void queryClient.invalidateQueries({ queryKey: ['notification-prefs'] });
    },
  });

  const unmute = useMutation({
    mutationFn: (chatId: string) => api.unmuteChat(chatId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['muted-chats'] });
      setNotice('Chat unmuted.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not unmute the chat'),
  });

  return (
    <SettingsPage
      title="Notifications"
      description="Alerts, sounds, do-not-disturb and per-chat overrides"
      onBack={onBack}
      testId="settings-page-notifications"
    >
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
      {notice ? <div className="mb-2"><SettingsNotice tone="success">{notice}</SettingsNotice></div> : null}

      <SettingsGroup title="This device">
        <NotificationSetup />
      </SettingsGroup>

      <SettingsGroup title="Alerts">
        <SettingsToggle
          icon={Bell}
          title="New message alerts"
          subtitle="Notify me about new messages and calls"
          checked={prefs.notifications}
          onChange={(next) => prefs.setPref('notifications', next)}
          testId="notifications-desktop"
        />
        <RowDivider />
        <SettingsToggle
          icon={Volume2}
          title="Message sounds"
          subtitle="Play a short chime for new messages"
          checked={prefs.sounds}
          onChange={(next) => prefs.setPref('sounds', next)}
          testId="notifications-sounds"
        />
        <RowDivider />
        <SettingsRow
          icon={PhoneCall}
          title="Call alerts"
          subtitle="Ring for incoming voice and video calls"
          badge="Coming soon"
          disabled
          testId="notifications-call-alerts"
        />
        <RowDivider />
        <SettingsRow
          icon={Smartphone}
          title="Vibration"
          subtitle="Vibrate on new messages (phones only)"
          badge="Coming soon"
          disabled
          testId="notifications-vibration"
        />
        <RowDivider />
        <SettingsRow
          icon={MessageCircle}
          title="Show message preview"
          subtitle="Include the message text in notifications"
          badge="Coming soon"
          disabled
          testId="notifications-preview"
        />
      </SettingsGroup>

      <SettingsGroup title="Do not disturb">
        <SettingsToggle
          icon={BellOff}
          title="Do not disturb"
          subtitle="Silence notifications and sounds during the hours below"
          checked={dndEnabled}
          onChange={(next) => {
            setDndEnabled(next);
            saveDnd.mutate({ dndEnabled: next });
          }}
          testId="notifications-dnd"
        />
        {dndEnabled ? (
          <div className="flex items-center gap-3 px-4 pb-3 pt-1 text-[13px]">
            <label className="flex items-center gap-2">
              From
              <input
                type="time"
                className="field h-9 w-[110px]"
                value={dndStart}
                data-testid="dnd-start"
                aria-label="Do not disturb starts at"
                onChange={(event) => setDndStart(event.target.value)}
                onBlur={() => saveDnd.mutate({ dndStart })}
              />
            </label>
            <label className="flex items-center gap-2">
              To
              <input
                type="time"
                className="field h-9 w-[110px]"
                value={dndEnd}
                data-testid="dnd-end"
                aria-label="Do not disturb ends at"
                onChange={(event) => setDndEnd(event.target.value)}
                onBlur={() => saveDnd.mutate({ dndEnd })}
              />
            </label>
          </div>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title="Per-chat overrides"
        description="Mute or unmute a single conversation from its chat menu. Muted chats are listed here."
      >
        {(muted.data ?? []).length === 0 ? (
          <p className="px-4 py-3 text-[12.5px] text-ink-500 dark:text-ink-400">No muted chats.</p>
        ) : (
          (muted.data ?? []).map((entry) => (
            <div key={entry.chatId}>
              <div className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-500 dark:text-ink-400">{entry.chatId.slice(-8)}</span>
                <button type="button" className={`btn-ghost !py-1 text-[12px] ${focusRing}`} onClick={() => unmute.mutate(entry.chatId)}>
                  Unmute
                </button>
              </div>
              <RowDivider />
            </div>
          ))
        )}
        {muted.isLoading ? <SettingsSpinner label="Loading muted chats…" /> : null}
        <div className="px-4 py-3">
          <SettingsCross>Per-chat mute lives in the conversation menu (chat header → Mute).</SettingsCross>
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}

