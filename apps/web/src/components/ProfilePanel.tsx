import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Ban, BellOff, Bell, Check, Copy, Flag, Mail, MessageCircle, MoreVertical,
  Phone, ShieldAlert, UserX, UserRoundPlus, Video, X, FileText, Music, Film,
} from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '@chatgram/core';
import { avatarGradient, initialsFor, lastSeenLabel } from '../lib/ui';
import { useIsOnline } from '../lib/presence';

const REPORT_REASONS: { key: string; label: string }[] = [
  { key: 'spam', label: 'Spam or unwanted messages' },
  { key: 'abuse', label: 'Abusive content' },
  { key: 'harassment', label: 'Harassment' },
  { key: 'impersonation', label: 'Pretending to be someone else' },
  { key: 'scam', label: 'Scam or fraud' },
  { key: 'other', label: 'Something else' },
];

/**
 * Profile panel: opens from anywhere a person is shown.
 *
 * The server decides what is visible (`GET /api/users/:id/profile` only returns
 * allowed fields), so this component renders what it receives and never
 * assumes a phone number or last-seen exists.
 */
export function ProfilePanel({
  userId,
  chatId,
  onClose,
  onOpenChat,
  onBack,
  openReport = false,
}: {
  userId: string;
  chatId?: string;
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
  /** Show a back button returning to the group info panel behind this one. */
  onBack?: () => void;
  /** Open the report dialog immediately. */
  openReport?: boolean;
}) {
  const me = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [copied, setCopied] = useState('');
  const [contactOpen, setContactOpen] = useState(false);
  const [contactName, setContactName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [alias, setAlias] = useState('');

  const ALIAS_KEY = 'chatgram.contactAliases';
  function readAlias(id: string): string {
    try {
      const raw = localStorage.getItem(ALIAS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>)[id] || '' : '';
    } catch {
      return '';
    }
  }
  function writeAlias(id: string, name: string): void {
    try {
      const raw = localStorage.getItem(ALIAS_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      if (name.trim()) map[id] = name.trim();
      else delete map[id];
      localStorage.setItem(ALIAS_KEY, JSON.stringify(map));
    } catch {
      /* aliases are a convenience, never required */
    }
  }

  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => api.getProfile(userId),
    retry: false,
  });

  const data = profileQuery.data;
  const profile = data?.profile;
  const isSelf = data?.isSelf || userId === me?.id;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (openReport) setReportOpen(true);
  }, [openReport]);

  useEffect(() => {
    setAlias(readAlias(userId));
    setContactName('');
    setContactOpen(false);
    setMenuOpen(false);
  }, [userId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (lightbox) setLightbox(null);
        else onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, onClose]);

  const title = alias || profile?.displayName || 'Contact info';

  // Live socket presence wins over the REST snapshot in profile.
  const isOnline = useIsOnline(profile?.id, profile?.isOnline);
  const presence = useMemo(() => {
    if (!profile) return '';
    if (profile.presenceHidden) return 'Last seen hidden';
    if (isOnline) return 'online';
    return lastSeenLabel(profile.lastSeen ?? undefined, '24h');
  }, [profile, isOnline]);

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  }

  async function startChat() {
    setBusy('message');
    setError('');
    try {
      const chat = await api.createDirect(userId);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      onOpenChat(chat.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the chat');
    } finally {
      setBusy('');
    }
  }

  async function addToContacts() {
    setBusy('contact');
    setError('');
    try {
      const name = contactName.trim();
      await api.addContact(userId);
      if (name && name !== (profile?.displayName ?? '')) writeAlias(userId, name);
      setAlias(readAlias(userId));
      setContactOpen(false);
      setContactName('');
      setNotice(`${name || profile?.displayName || 'This person'} added to your contacts.`);
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      void queryClient.invalidateQueries({ queryKey: ['group-member-contacts'] });
      await profileQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this contact');
    } finally {
      setBusy('');
    }
  }

  async function removeFromContacts() {
    setBusy('contact');
    setError('');
    setMenuOpen(false);
    try {
      await api.removeContact(userId);
      writeAlias(userId, '');
      setAlias('');
      setNotice('Contact removed.');
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      void queryClient.invalidateQueries({ queryKey: ['group-member-contacts'] });
      await profileQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this contact');
    } finally {
      setBusy('');
    }
  }

  async function toggleMute() {
    setBusy('mute');
    setError('');
    try {
      // The profile endpoint only knows about an existing direct chat. If the
      // chat does not exist yet, create it (that is what muting a contact
      // means) and mute it.
      const mutedChatId = data?.mutedChatId || chatId || (await api.createDirect(userId)).id;
      if (data?.mutedChatId) {
        await api.unmuteChat(data.mutedChatId);
        setNotice('Notifications unmuted.');
      } else {
        await api.muteChat(mutedChatId);
        setNotice('Notifications muted for this chat.');
      }
      await profileQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ['muted-chats'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the mute setting');
    } finally {
      setBusy('');
    }
  }

  async function toggleBlock() {
    setBusy('block');
    setError('');
    try {
      if (data?.iBlocked) {
        await api.unblockUser(userId);
        setNotice(`${title} is unblocked.`);
      } else {
        await api.blockUser(userId);
        setNotice(`${title} is blocked. They can no longer message you.`);
      }
      setConfirmBlock(false);
      await profileQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the block');
    } finally {
      setBusy('');
    }
  }

  async function submitReport() {
    setBusy('report');
    setError('');
    try {
      const result = await api.reportUser(userId, reportReason, reportDetails.trim() || undefined, chatId);
      setNotice(`Report sent (${result.reportId}). Our team will review it.`);
      setReportOpen(false);
      setReportDetails('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the report');
    } finally {
      setBusy('');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={`Profile of ${title}`}
      data-testid="profile-panel"
      onClick={onClose}
    >
      <aside
        className="no-scrollbar flex h-full w-full max-w-sm flex-col overflow-y-auto bg-white shadow-2xl dark:bg-ink-800"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-ink-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-ink-800/95">
          {onBack ? (
            <button type="button" className="btn-ghost !px-1.5" onClick={onBack} aria-label="Back to group info">
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : null}
          <h2 className="flex-1 truncate font-bold">Contact info</h2>
          {!isSelf && data?.isContact ? (
            <div className="relative">
              <button
                type="button"
                className="btn-ghost !px-2"
                aria-label="Contact options"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreVertical className="h-5 w-5" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 text-sm shadow-xl dark:border-white/10 dark:bg-ink-800">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                    onClick={() => void removeFromContacts()}
                  >
                    <UserX className="h-4 w-4" /> Remove contact
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <button ref={closeRef} type="button" className="btn-ghost !px-2" onClick={onClose} aria-label="Close profile">
            <X className="h-5 w-5" />
          </button>
        </header>

        {profileQuery.isLoading ? <p className="p-6 text-sm text-ink-500">Loading profile…</p> : null}
        {profileQuery.isError ? (
          <p role="alert" className="m-4 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            {profileQuery.error instanceof Error ? profileQuery.error.message : 'Could not load this profile.'}
          </p>
        ) : null}

        {profile ? (
          <>
            {error ? (
              <p role="alert" className="mx-4 mt-3 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="mx-4 mt-3 rounded-xl border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                {notice}
              </p>
            ) : null}

            <div className="flex flex-col items-center px-4 py-6 text-center">
              <button
                type="button"
                onClick={() => (profile.avatarUrl ? setLightbox(profile.avatarUrl) : undefined)}
                className="grid h-28 w-28 place-items-center overflow-hidden rounded-full"
                aria-label={profile.avatarUrl ? 'Enlarge profile photo' : 'No profile photo'}
              >
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt={title} className="h-full w-full object-cover" />
                ) : (
                  <span
                    className={`grid h-full w-full place-items-center bg-gradient-to-br ${avatarGradient(
                      profile.id,
                    )} text-3xl font-bold text-white`}
                  >
                    {initialsFor(title)}
                  </span>
                )}
              </button>
              <h3 className="mt-3 text-xl font-bold" data-testid="profile-name">
                {title}
              </h3>
              <p className="text-sm text-ink-500 dark:text-ink-400">
                {isSelf ? 'This is you' : optionsSuffix(data)}
              </p>
              <p
                className={`mt-0.5 text-sm ${isOnline ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-ink-500 dark:text-ink-400'}`}
                data-testid="profile-presence"
              >
                {presence}
              </p>

              {data?.blockedMe ? (
                <p className="mt-2 flex items-center gap-1 text-[12px] text-ink-500 dark:text-ink-400">
                  <ShieldAlert className="h-3.5 w-3.5" /> This person cannot message you.
                </p>
              ) : null}

              {!isSelf && data ? (
                <div className="mt-3 w-full" data-testid="profile-contact-state">
                  {data.isContact ? (
                    <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <Check className="h-3.5 w-3.5" /> In your contacts
                    </p>
                  ) : (
                    <p className="text-[12px] text-ink-500 dark:text-ink-400">Not in your contacts</p>
                  )}
                  {!data.isContact ? (
                    contactOpen ? (
                      <div className="mt-2 rounded-xl border border-ink-200 p-3 text-left dark:border-white/10">
                        <label className="label" htmlFor="new-contact-name">Name for this contact</label>
                        <input
                          id="new-contact-name"
                          className="field mt-1"
                          value={contactName}
                          maxLength={80}
                          placeholder={profile.displayName}
                          onChange={(event) => setContactName(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Enter') void addToContacts(); }}
                        />
                        <p className="mt-1 text-[11px] text-ink-500 dark:text-ink-400">
                          Shown on this device; their Chatgram name is unchanged for everyone else.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button type="button" className="btn-primary !px-3 !py-1.5 text-[12px]" disabled={busy === 'contact'} onClick={() => void addToContacts()}>
                            <UserRoundPlus className="h-3.5 w-3.5" /> {busy === 'contact' ? 'Adding…' : 'Add contact'}
                          </button>
                          <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => setContactOpen(false)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-brand-600/40 px-3 py-1.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-600/10 dark:border-brand-400/40 dark:text-brand-300"
                        data-testid="add-to-contacts"
                        onClick={() => { setContactName(profile.displayName ?? ''); setContactOpen(true); }}
                      >
                        <UserRoundPlus className="h-3.5 w-3.5" /> Add to contacts
                      </button>
                    )
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* about */}
            {profile.about && !profile.aboutHidden ? (
              <section className="border-t border-ink-200 px-4 py-3 dark:border-white/10">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">About</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{profile.about}</p>
              </section>
            ) : null}

            {/* contact details, only when the server allowed them */}
            {!isSelf && (profile.phone || profile.email) ? (
              <section className="border-t border-ink-200 px-4 py-2 dark:border-white/10">
                {profile.phone ? (
                  <div className="flex items-center gap-3 py-2">
                    <Phone className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
                    <span className="min-w-0 flex-1 truncate" data-testid="profile-phone">{profile.phone}</span>
                    <button
                      type="button"
                      className="btn-ghost !px-2"
                      onClick={() => void copyValue('phone', profile.phone || '')}
                      aria-label="Copy phone number"
                    >
                      {copied === 'phone' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                ) : null}
                {profile.email ? (
                  <div className="flex items-center gap-3 py-2">
                    <Mail className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
                    <span className="min-w-0 flex-1 truncate" data-testid="profile-email">{profile.email}</span>
                    <button
                      type="button"
                      className="btn-ghost !px-2"
                      onClick={() => void copyValue('email', profile.email || '')}
                      aria-label="Copy email address"
                    >
                      {copied === 'email' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
            {!isSelf && profile.phoneHidden ? (
              <p className="border-t border-ink-200 px-4 py-3 text-[12px] text-ink-500 dark:border-white/10 dark:text-ink-400">
                Phone number hidden by their privacy settings.
              </p>
            ) : null}

            {/* actions */}
            {!isSelf ? (
              <section className="grid grid-cols-4 gap-1 border-t border-ink-200 px-2 py-3 dark:border-white/10">
                <Action
                  Icon={MessageCircle}
                  label="Message"
                  disabled={!data?.canMessage || Boolean(busy)}
                  onClick={() => void startChat()}
                />
                <Action Icon={Phone} label="Voice call" onClick={() => setNotice('Voice and video calls are not available yet.')} />
                <Action Icon={Video} label="Video call" onClick={() => setNotice('Voice and video calls are not available yet.')} />
                <Action
                  Icon={data?.mutedChatId ? Bell : BellOff}
                  label={data?.mutedChatId ? 'Unmute' : 'Mute'}
                  disabled={Boolean(busy)}
                  onClick={() => void toggleMute()}
                />
                <Action
                  Icon={Ban}
                  label={data?.iBlocked ? 'Unblock' : 'Block'}
                  danger={!data?.iBlocked}
                  disabled={Boolean(busy)}
                  onClick={() => (data?.iBlocked ? void toggleBlock() : setConfirmBlock(true))}
                />
                <Action Icon={Flag} label="Report" danger onClick={() => setReportOpen(true)} />
              </section>
            ) : null}

            {/* common groups */}
            {data && data.commonGroups.length > 0 ? (
              <section className="border-t border-ink-200 px-4 py-3 dark:border-white/10">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                  {data.commonGroups.length} group{data.commonGroups.length === 1 ? '' : 's'} in common
                </p>
                <div className="mt-1">
                  {data.commonGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => {
                        onOpenChat(group.id);
                        onClose();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left hover:bg-ink-100 dark:hover:bg-white/5"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600/10 text-brand-600 dark:text-brand-300">
                        <MessageCircle className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{group.name}</span>
                        <span className="block text-[11px] text-ink-500 dark:text-ink-400">
                          {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {/* shared media */}
            {data && data.sharedMedia.length > 0 ? (
              <section className="border-t border-ink-200 px-4 py-3 dark:border-white/10">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                  Media, links and docs
                </p>
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {data.sharedMedia.map((item) => (
                    <button
                      key={item.messageId}
                      type="button"
                      className="relative aspect-square overflow-hidden rounded-lg bg-ink-100 dark:bg-white/10"
                      onClick={() =>
                        item.type === 'image' ? setLightbox(item.url) : setNotice('Only photos can be previewed here.')
                      }
                      aria-label={`Shared ${item.type}`}
                    >
                      {item.type === 'image' ? (
                        <img src={item.url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-ink-500 dark:text-ink-300">
                          {item.type === 'video' ? <Film className="h-5 w-5" /> : item.type === 'audio' ? <Music className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {/* shared links */}
            {data && data.sharedLinks.length > 0 ? (
              <section className="border-t border-ink-200 px-4 py-3 dark:border-white/10">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">Links</p>
                {data.sharedLinks.map((link) => (
                  <a
                    key={`${link.messageId}-${link.url}`}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block truncate py-1.5 text-sm text-brand-600 hover:underline dark:text-brand-300"
                  >
                    {link.url}
                  </a>
                ))}
              </section>
            ) : null}

            {isSelf ? (
              <p className="border-t border-ink-200 px-4 py-3 text-[12px] text-ink-500 dark:border-white/10 dark:text-ink-400">
                Edit your name, photo and about in Settings → Edit profile.
              </p>
            ) : null}

            <div className="mt-auto p-4">
              {confirmBlock ? (
                <div className="rounded-xl border border-rose-300/60 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
                  <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                    Block {title}? They will not be able to message you or see your profile.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="btn-primary !bg-rose-600" onClick={() => void toggleBlock()} disabled={busy === 'block'}>
                      <UserX className="h-4 w-4" /> {busy === 'block' ? 'Blocking…' : 'Yes, block'}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setConfirmBlock(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </aside>

      {reportOpen ? (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Report user"
          onClick={(event) => {
            event.stopPropagation();
            setReportOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-ink-800" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-bold">Report {title}</h3>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              Only Chatgram&apos;s moderation team sees your report.
            </p>
            <div className="mt-3 space-y-1">
              {REPORT_REASONS.map((reason) => (
                <label key={reason.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-ink-100 dark:hover:bg-white/5">
                  <input
                    type="radio"
                    name="report-reason"
                    value={reason.key}
                    checked={reportReason === reason.key}
                    onChange={() => setReportReason(reason.key)}
                  />
                  {reason.label}
                </label>
              ))}
            </div>
            <textarea
              className="field mt-2 resize-none"
              rows={2}
              maxLength={500}
              placeholder="Anything else we should know? (optional)"
              value={reportDetails}
              onChange={(event) => setReportDetails(event.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setReportOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => void submitReport()} disabled={busy === 'report'}>
                {busy === 'report' ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/95 p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Profile photo"
          data-testid="profile-lightbox"
          onClick={(event) => {
            event.stopPropagation();
            setLightbox(null);
          }}
        >
          <img src={lightbox} alt={title} className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white"
            onClick={(event) => {
              event.stopPropagation();
              setLightbox(null);
            }}
            aria-label="Close photo"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function optionsSuffix(data: { isContact: boolean } | undefined): string {
  if (!data) return '';
  return data.isContact ? 'in your contacts' : 'not in your contacts';
}

function Action({
  Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  Icon: typeof Phone;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition hover:bg-ink-100 disabled:opacity-40 dark:hover:bg-white/5 ${
        danger ? 'text-rose-600 dark:text-rose-400' : 'text-ink-700 dark:text-ink-200'
      }`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}
