import { useEffect, useState } from 'react';
import { Bot, Lightbulb, MessageSquareWarning, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { ReportProblemDialog } from './ReportProblemDialog';
import type { SettingsPageProps } from './types';
import { SettingsDialog, SettingsGroup, SettingsNotice, SettingsPage, SettingsRow, SettingsCross, SettingsToggle, focusRing } from './ui';
import { hydrateSuggestedReplies, saveSuggestedReplies, useSuggestedRepliesPref } from '../../lib/settingsPrefs';

interface AiConversation {
  id?: string;
  _id?: string;
  title?: string;
}

/**
 * Chatgram AI: the honest state of each knob.
 *
 * - Suggested replies: real opt-in toggle, persisted on the account via
 *   GET/PUT /api/users/me/ai-settings (local fallback if that route is missing).
 * - Clear AI memory/history: real — deletes the user's AI conversations
 *   through the existing /api/ai/conversations endpoints.
 * - Report a bad answer: reuses the Help report flow (same endpoint + local
 *   fallback prompt).
 */
export default function AiPage({ onBack }: SettingsPageProps) {
  const [suggestedReplies] = useSuggestedRepliesPref();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Mirror the account setting once when the page opens.
  useEffect(() => {
    void hydrateSuggestedReplies();
  }, []);

  async function toggleSuggestedReplies(next: boolean) {
    setError('');
    setNotice('');
    const outcome = await saveSuggestedReplies(next);
    if (outcome === 'fallback') {
      setNotice('Saved on this device only — the server setting is not available yet.');
    } else if (outcome === 'error') {
      setError('Could not save the suggested-replies setting. Try again.');
    }
  }

  async function clearHistory() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await api.request<{ conversations?: AiConversation[] }>('/api/ai/conversations');
      const conversations = data?.conversations ?? [];
      let removed = 0;
      for (const conversation of conversations) {
        const id = conversation.id ?? conversation._id;
        if (!id) continue;
        await api.request(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        removed += 1;
      }
      setCount(removed);
      setConfirmOpen(false);
      setNotice(
        removed === 0
          ? 'There was no Chatgram AI history to clear.'
          : `Cleared ${removed} Chatgram AI conversation${removed === 1 ? '' : 's'} from your account.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear the AI history');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage title="Chatgram AI" description="History, suggestions and feedback" onBack={onBack} testId="settings-page-ai">
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
      {notice ? <div className="mb-2"><SettingsNotice tone="success">{notice}</SettingsNotice></div> : null}

      <SettingsGroup title="Assistance">
        <SettingsToggle
          icon={Sparkles}
          title="Suggested replies"
          subtitle="Opt-in. When on, the last 5 messages are sent to the AI provider (redacted, never stored) and up to three quick replies appear above the composer."
          checked={suggestedReplies}
          onChange={(next) => void toggleSuggestedReplies(next)}
          testId="settings-suggested-replies"
        />
        <div className="px-4 pb-3">
          <SettingsCross>
            Off by default. Replies are generated for the open conversation only and are discarded when you type or
            send. The provider receives no names, phone numbers or email addresses from this app.
          </SettingsCross>
        </div>
      </SettingsGroup>

      <SettingsGroup title="History">
        <SettingsRow
          icon={Trash2}
          title="Clear AI memory and history"
          subtitle="Deletes your Chatgram AI conversations from this account"
          destructive
          testId="settings-ai-clear"
          onClick={() => setConfirmOpen(true)}
          trailing={busy ? <span className="text-[11px] text-ink-500">Clearing…</span> : undefined}
        />
        <div className="px-4 pb-3">
          <SettingsCross>
            {count === null
              ? 'This removes the conversation list the AI uses as context. Group support chats are separate.'
              : `Last clear removed ${count} conversation${count === 1 ? '' : 's'}.`}
          </SettingsCross>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Feedback">
        <SettingsRow
          icon={MessageSquareWarning}
          title="Report a bad answer"
          subtitle="Send the answer to the team as a debugging prompt"
          testId="settings-ai-report"
          onClick={() => setReportOpen(true)}
        />
        <div className="px-4 pb-3">
          <SettingsCross>
            <Bot className="mr-1 inline h-3 w-3" aria-hidden="true" />
            Chatgram AI can make mistakes. In Chatgram AI chats, a thumbs-down on a reply also sends feedback.
          </SettingsCross>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="px-4 py-3 text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400" data-testid="ai-privacy-note">
          <Lightbulb className="mr-1 inline h-3 w-3" aria-hidden="true" />
          Your AI questions leave this app for a third-party AI provider. They are not end-to-end encrypted and are
          not shown to other people.
        </div>
      </SettingsGroup>

      {confirmOpen ? (
        <SettingsDialog
          title="Clear Chatgram AI history?"
          description="This deletes your Chatgram AI conversations from your account. It cannot be undone."
          destructive
          onClose={() => setConfirmOpen(false)}
          testId="settings-ai-clear-dialog"
          footer={
            <>
              <button type="button" className={`btn-ghost flex-1 ${focusRing}`} onClick={() => setConfirmOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={`btn flex-1 bg-rose-600 text-white hover:bg-rose-700 ${focusRing}`} onClick={() => void clearHistory()} disabled={busy}>
                {busy ? 'Clearing…' : 'Clear history'}
              </button>
            </>
          }
        />
      ) : null}

      {reportOpen ? (
        <ReportProblemDialog
          title="Report a bad Chatgram AI answer"
          initialMessage="Chatgram AI gave a wrong or unhelpful answer: "
          lastAction="Reported a Chatgram AI answer from Settings"
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </SettingsPage>
  );
}



