import { useState } from 'react';
import { BookOpen, Download, ExternalLink, LifeBuoy, MessageCircle, Send } from 'lucide-react';
import { api, APP_VERSION } from '../../lib/api';
import { DesktopUpdateCard } from '../../components/DesktopUpdateCard';
import { AndroidUpdateCard } from '../../components/AndroidUpdateCard';
import { ReportProblemDialog } from './ReportProblemDialog';
import type { SettingsPageProps } from './types';
import { RowDivider, SettingsGroup, SettingsLinkRow, SettingsNotice, SettingsPage, SettingsRow, SettingsCross } from './ui';

/** Help: the existing help centre/assistant, support chat, report flow and legal links. */
export default function HelpPage({
  onBack,
  onOpenSupport,
}: SettingsPageProps & { onOpenSupport: (chatId: string) => void }) {
  const [error, setError] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function openHelpCentre() {
    window.dispatchEvent(new CustomEvent('chatgram-open-help'));
  }

  async function contactSupport() {
    setError('');
    setBusy(true);
    try {
      const chat = await api.openSupportChat();
      onOpenSupport(chat.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the support chat');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage title="Help" description="Guides, support and legal" onBack={onBack} testId="settings-page-help">
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}

      <SettingsGroup title="Get help">
        <SettingsRow
          icon={BookOpen}
          title="Help centre and guide"
          subtitle="Articles, search and the Chatgram assistant"
          testId="settings-help-centre"
          onClick={openHelpCentre}
        />
        <RowDivider />
        <SettingsRow
          icon={MessageCircle}
          title="Contact support"
          subtitle="Start a chat with the support team"
          testId="settings-contact-support"
          onClick={() => void contactSupport()}
          trailing={busy ? <span className="text-[11px] text-ink-500">Opening…</span> : undefined}
        />
        <RowDivider />
        <SettingsRow
          icon={Send}
          title="Report a problem"
          subtitle="Turn a bug or feature request into a debugging prompt"
          testId="settings-report-problem"
          onClick={() => setReportOpen(true)}
        />
      </SettingsGroup>

      <SettingsGroup title="Legal">
        <SettingsLinkRow
          icon={ExternalLink}
          title="Terms"
          subtitle="The rules for using Chatgram"
          href="/docs/#terms"
          testId="settings-terms"
        />
        <RowDivider />
        <SettingsLinkRow
          icon={ExternalLink}
          title="Privacy Policy"
          subtitle="What we collect and why"
          href="/docs/#privacy"
          testId="settings-privacy-policy"
        />
      </SettingsGroup>

      <SettingsGroup title="App">
        <SettingsRow icon={LifeBuoy} title="Chatgram" subtitle={`Version ${APP_VERSION}`} testId="settings-version" />
        <RowDivider />
        <SettingsLinkRow
          icon={Download}
          title="What's new"
          subtitle="Release notes and downloads"
          href="/docs/"
          testId="settings-whats-new"
        />
        <div className="px-4 pb-3">
          <SettingsCross>The server address is deliberately not shown here.</SettingsCross>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Updates">
        <DesktopUpdateCard />
        <AndroidUpdateCard />
      </SettingsGroup>

      {reportOpen ? (
        <ReportProblemDialog
          initialMessage=""
          lastAction="Opened Settings → Help → Report a problem"
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </SettingsPage>
  );
}
