import { Image as ImageIcon, Monitor, Moon, Sun, Type } from 'lucide-react';
import { usePrefs, useTheme, type TextSize } from '@chatgram/core';
import { LOCALES, LOCALE_LABELS, useI18n } from '../../lib/i18n';
import type { SettingsPageProps } from './types';
import { SettingsChoice, SettingsGroup, SettingsPage, SettingsRow, SettingsCross } from './ui';

/**
 * Chats: appearance and typing preferences. Everything here is live — the theme,
 * text size, time format and language hooks are the ones the whole app already
 * uses. Rows whose effect lives outside Settings (chat wallpaper, Enter-to-send
 * in the composer) are shown disabled with an explanation instead of pretend
 * switches.
 */
export default function ChatsPage({ onBack, navigate }: SettingsPageProps) {
  const { mode, setMode } = useTheme();
  const prefs = usePrefs();
  const { locale, setLocale } = useI18n();

  return (
    <SettingsPage title="Chats" description="Theme, text, wallpaper and typing" onBack={onBack} testId="settings-page-chats">
      <SettingsGroup title="Theme">
        <SettingsChoice
          ariaLabel="Theme"
          value={mode}
          onChange={(key) => setMode(key === 'light' ? 'light' : key === 'dark' ? 'dark' : 'system')}
          options={[
            { key: 'light', label: 'Light', icon: Sun },
            { key: 'dark', label: 'Dark', icon: Moon },
            { key: 'system', label: 'System', icon: Monitor },
          ]}
          testId="settings-theme"
        />
      </SettingsGroup>

      <SettingsGroup title="Text size" description="Applies to messages and lists across the app.">
        <SettingsChoice
          ariaLabel="Text size"
          value={prefs.textSize}
          onChange={(key) => prefs.setTextSize(key as TextSize)}
          options={[
            { key: 'small', label: 'Small' },
            { key: 'normal', label: 'Normal' },
            { key: 'large', label: 'Large' },
          ]}
          testId="settings-text-size"
        />
      </SettingsGroup>

      <SettingsGroup title="Time format">
        <SettingsChoice
          ariaLabel="Time format"
          value={prefs.timeFormat}
          onChange={(key) => prefs.setTimeFormat(key === '24h' ? '24h' : '12h')}
          options={[
            { key: '12h', label: '12-hour (9:19 AM)' },
            { key: '24h', label: '24-hour (09:19)' },
          ]}
          testId="settings-time-format"
        />
      </SettingsGroup>

      <SettingsGroup title="Language">
        <div className="px-4 py-3">
          <label className="label" htmlFor="settings-language">Language</label>
          <select
            id="settings-language"
            className="field"
            value={locale}
            onChange={(event) => setLocale(event.target.value as typeof locale)}
            data-testid="settings-language"
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABELS[code]}
              </option>
            ))}
          </select>
          <SettingsCross>
            English is complete; Kinyarwanda, French and Swahili are still being translated — some lines will stay in
            English for now.
          </SettingsCross>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Chat behaviour">
        <SettingsRow
          icon={ImageIcon}
          title="Wallpaper"
          subtitle="Choose a background for conversations (or this chat from its menu)"
          testId="settings-row-wallpaper"
          onClick={() => navigate('wallpaper')}
        />
        <SettingsRow
          icon={Type}
          title="Enter key sends the message"
          subtitle="Shift+Enter adds a new line"
          badge="Coming soon"
          disabled
          testId="settings-enter-key"
        />
      </SettingsGroup>
    </SettingsPage>
  );
}


