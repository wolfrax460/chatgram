import { useEffect, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Eye, ExternalLink, Flag, Info, Mail, Phone, ShieldCheck, UserRound, UserX,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { SettingsPageProps } from './types';
import {
  RowDivider,
  SettingsChoice,
  SettingsGroup,
  SettingsLinkRow,
  SettingsNotice,
  SettingsPage,
  SettingsRow,
  SettingsToggle,
  SettingsSpinner,
  focusRing,
} from './ui';

const CHECKUP_STEPS = [
  {
    title: 'Who can see you',
    body: 'Review your profile photo, about text and online status. Turning off "Show when I am online" hides both online status and last seen from everyone.',
  },
  {
    title: 'Who can reach you',
    body: 'Decide who may add you to groups and check the people you have hidden your last seen from.',
  },
  {
    title: 'What you share',
    body: 'Read receipts tell senders when you read their messages. Blocked people cannot message you or see your profile.',
  },
] as const;

/**
 * Privacy: the existing server-backed switches (unchanged endpoints) plus the
 * protected-messages notice (same wording as before) and a three-step checkup.
 */
export default function PrivacyPage({ onBack }: SettingsPageProps) {
  const queryClient = useQueryClient();
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: () => api.privacy() });
  const blocked = useQuery({ queryKey: ['blocked-users'], queryFn: () => api.blockedUsers() });
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts() });

  const [showOnline, setShowOnline] = useState(true);
  const [hidePicker, setHidePicker] = useState(false);
  const [error, setError] = useState('');
  const [checkupOpen, setCheckupOpen] = useState(false);
  const [checkupStep, setCheckupStep] = useState(0);

  useEffect(() => {
    if (privacy.data) setShowOnline(privacy.data.showOnlineStatus);
  }, [privacy.data]);

  async function savePrivacy(patch: Parameters<typeof api.updatePrivacy>[0]) {
    setError('');
    try {
      await api.updatePrivacy(patch);
      void queryClient.invalidateQueries({ queryKey: ['privacy'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update privacy');
      void queryClient.invalidateQueries({ queryKey: ['privacy'] });
    }
  }

  async function toggleOnline(next: boolean) {
    setShowOnline(next);
    try {
      await api.updatePrivacy({ showOnlineStatus: next });
      void queryClient.invalidateQueries({ queryKey: ['privacy'] });
    } catch (err) {
      setShowOnline(!next);
      setError(err instanceof Error ? err.message : 'Could not update privacy');
    }
  }

  async function unblock(userId: string) {
    setError('');
    try {
      await api.unblockUser(userId);
      void queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unblock the user');
    }
  }

  const data = privacy.data;
  const hiddenFrom = data?.hiddenFrom ?? [];

  return (
    <SettingsPage title="Privacy" description="Who can see your info and reach you" onBack={onBack} testId="settings-page-privacy">
      {error ? <div className="mb-2"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}

      <button
        type="button"
        onClick={() => {
          setCheckupOpen((value) => !value);
          setCheckupStep(0);
        }}
        aria-expanded={checkupOpen}
        className={`mx-1 mb-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-2xl border border-brand-600/30 bg-brand-600/5 p-3 text-left transition hover:bg-brand-600/10 dark:border-brand-400/25 dark:bg-brand-500/10 ${focusRing}`}
        data-testid="privacy-checkup"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/15 text-brand-700 dark:text-brand-300" aria-hidden="true">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Privacy checkup</span>
          <span className="block text-[12.5px] text-ink-600 dark:text-ink-300">
            Three quick steps to review what you share
          </span>
        </span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-ink-400 transition ${checkupOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
      </button>

      {checkupOpen ? (
        <div className="mx-1 mb-2 rounded-2xl border border-ink-200 p-4 dark:border-white/10" data-testid="privacy-checkup-body">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
            Step {checkupStep + 1} of {CHECKUP_STEPS.length}
          </p>
          <p className="mt-1 text-[14px] font-semibold">{CHECKUP_STEPS[checkupStep]?.title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
            {CHECKUP_STEPS[checkupStep]?.body}
          </p>
          <div className="mt-3 flex items-center gap-1" aria-hidden="true">
            {CHECKUP_STEPS.map((step, index) => (
              <span
                key={step.title}
                className={`h-1.5 flex-1 rounded-full ${index <= checkupStep ? 'bg-brand-600' : 'bg-ink-200 dark:bg-white/10'}`}
              />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={`btn-ghost flex-1 ${focusRing}`}
              disabled={checkupStep === 0}
              onClick={() => setCheckupStep((step) => Math.max(0, step - 1))}
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            {checkupStep < CHECKUP_STEPS.length - 1 ? (
              <button
                type="button"
                className={`btn-primary flex-1 ${focusRing}`}
                onClick={() => setCheckupStep((step) => Math.min(CHECKUP_STEPS.length - 1, step + 1))}
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                className={`btn-primary flex-1 ${focusRing}`}
                onClick={() => setCheckupOpen(false)}
                data-testid="privacy-checkup-done"
              >
                <Check className="h-4 w-4" /> Done
              </button>
            )}
          </div>
        </div>
      ) : null}

      {privacy.isLoading ? <SettingsSpinner label="Loading privacy settings…" /> : null}

      <SettingsGroup title="Who can see me">
        <SettingsToggle
          icon={Eye}
          title="Show when I am online"
          subtitle="Contacts can see your online status and last seen"
          checked={showOnline}
          onChange={(next) => void toggleOnline(next)}
          testId="privacy-online"
        />
        <RowDivider />
        <SettingsToggle
          icon={UserRound}
          title="Show my profile photo"
          subtitle="People who can open your profile see your photo"
          checked={data?.showProfilePhoto !== false}
          onChange={(next) => void savePrivacy({ showProfilePhoto: next })}
          testId="privacy-photo"
        />
        <RowDivider />
        <SettingsToggle
          icon={Info}
          title="Show my about"
          subtitle="The short line under your name in your profile"
          checked={data?.showAbout !== false}
          onChange={(next) => void savePrivacy({ showAbout: next })}
          testId="privacy-about"
        />
        <RowDivider />
        <SettingsToggle
          icon={Phone}
          title="Show my phone number"
          subtitle="Only contacts can ever see it"
          checked={data?.showPhone !== false}
          onChange={(next) => void savePrivacy({ showPhone: next })}
          testId="privacy-phone"
        />
        <RowDivider />
        <SettingsToggle
          icon={Mail}
          title="Show my email address"
          subtitle="Only contacts can ever see it"
          checked={data?.showEmail !== false}
          onChange={(next) => void savePrivacy({ showEmail: next })}
          testId="privacy-email"
        />
        <RowDivider />
        <SettingsToggle
          icon={Check}
          title="Read receipts"
          subtitle="When off, senders cannot see that you read their messages"
          checked={data?.readReceipts !== false}
          onChange={(next) => void savePrivacy({ readReceipts: next })}
          testId="privacy-receipts"
        />
      </SettingsGroup>

      <SettingsGroup title="Who can add me to groups">
        <SettingsChoice
          ariaLabel="Who can add me to groups"
          value={data?.whoCanAddToGroups ?? 'everyone'}
          onChange={(key) => void savePrivacy({ whoCanAddToGroups: key === 'contacts' ? 'contacts' : 'everyone' })}
          options={[
            { key: 'everyone', label: 'Everyone' },
            { key: 'contacts', label: 'My contacts' },
          ]}
          testId="privacy-groups-choice"
        />
      </SettingsGroup>

      <SettingsGroup
        title="Hide my last seen"
        description={`Currently hidden from ${hiddenFrom.length > 0 ? `${hiddenFrom.length} ${hiddenFrom.length === 1 ? 'person' : 'people'}` : 'nobody'}.`}
      >
        <SettingsRow
          icon={Eye}
          title="Manage hidden contacts"
          subtitle={hidePicker ? 'Tap Done to close the list' : 'Choose who cannot see your last seen'}
          value={hidePicker ? 'Done' : 'Manage'}
          onClick={() => setHidePicker((value) => !value)}
          testId="privacy-hidden-manage"
          trailing={<ChevronRight className={`h-4 w-4 text-ink-400 transition ${hidePicker ? 'rotate-90' : ''}`} aria-hidden="true" />}
        />
        {hidePicker ? (
          <div className="max-h-56 overflow-y-auto border-t border-ink-100 dark:border-white/[.06]">
            {contacts.isLoading ? <SettingsSpinner label="Loading contacts…" /> : null}
            {(contacts.data ?? []).length === 0 ? (
              <p className="px-4 py-3 text-[12.5px] text-ink-500 dark:text-ink-400">No contacts yet.</p>
            ) : null}
            {(contacts.data ?? []).map((person) => {
              const checked = hiddenFrom.some((hidden) => hidden.id === person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => {
                    const ids = checked
                      ? hiddenFrom.filter((hidden) => hidden.id !== person.id).map((hidden) => hidden.id)
                      : [...hiddenFrom.map((hidden) => hidden.id), person.id];
                    void savePrivacy({ hiddenFrom: ids });
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] hover:bg-ink-100 dark:hover:bg-white/5 ${focusRing}`}
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                      checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 dark:border-white/20'
                    }`}
                    aria-hidden="true"
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="truncate">{person.displayName}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Blocked users">
        {blocked.isLoading ? <SettingsSpinner label="Loading blocked users…" /> : null}
        {(blocked.data ?? []).length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-3 text-[12.5px] text-ink-500 dark:text-ink-400">
            <UserX className="h-4 w-4" aria-hidden="true" /> You have not blocked anyone.
          </p>
        ) : (
          (blocked.data ?? []).map((person) => {
            const id = person._id ?? person.id ?? '';
            return (
              <div key={id}>
                <div className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13.5px]" data-testid="blocked-user">{person.displayName}</span>
                  <button type="button" className={`btn-ghost !py-1 text-[12px] ${focusRing}`} onClick={() => void unblock(id)}>
                    Unblock
                  </button>
                </div>
                <RowDivider />
              </div>
            );
          })
        )}
      </SettingsGroup>

      <SettingsGroup title="How your messages are protected">
        <div className="px-4 py-3 text-[12px] leading-relaxed text-ink-700 dark:text-ink-200" data-testid="privacy-admin-review-notice">
          <strong>How your messages are protected:</strong> chats are encrypted in transit, but they are
          <strong> not end-to-end encrypted</strong>. Authorised Chatgram administrators can review conversation
          content for security, abuse and legal reasons; every review needs a written reason, is read-only and is
          written to an audit log.
        </div>
        <RowDivider />
        <SettingsLinkRow
          icon={ExternalLink}
          title="Privacy Policy"
          subtitle="What we collect and why"
          href="/docs/#privacy"
          testId="privacy-policy-link"
        />
        <RowDivider />
        <SettingsLinkRow
          icon={Flag}
          title="Report a privacy concern"
          subtitle="Send it to the team from Help"
          href="/docs/#privacy"
          testId="privacy-report-link"
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
