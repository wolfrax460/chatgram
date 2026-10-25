import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Ban, Clock, KeyRound, Lock, MessageSquare, ShieldCheck, UserRound } from 'lucide-react';
import {
  adminFetch, formatNumber, initials, relativeTime, shortDate, type AdminSessionInfo, type AdminUserDetailPayload,
} from './api';
import { Chip, ConfirmDialog, PageHead, Skeleton, Toast, useToast } from './ui';
import ReviewConversationsTab from './ReviewConversationsTab';

type Tab = 'profile' | 'activity' | 'conversations' | 'actions';

/** User detail: read-only profile, activity counters and the safe account actions. */
export default function UserDetailPage({ session, id }: { session: AdminSessionInfo; id: string }) {
  const toast = useToast();
  const [data, setData] = useState<AdminUserDetailPayload | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'logout' | 'reset2fa' | 'suspend' | 'ban' | 'unban' | null>(null);
  const [moderationReason, setModerationReason] = useState('');
  const [suspendDays, setSuspendDays] = useState('7');

  const load = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      setData(await adminFetch<AdminUserDetailPayload>(`/api/admin/users/${id}`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the user.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction() {
    if (!confirmAction || !id) return;
    setBusy(true);
    setError('');
    try {
      const paths = { logout: 'force-logout', reset2fa: 'reset-2fa', suspend: 'suspend', ban: 'ban', unban: 'unban' } as const;
      const body =
        confirmAction === 'suspend'
          ? { days: Number(suspendDays) || 7, reason: moderationReason }
          : confirmAction === 'ban'
            ? { reason: moderationReason }
            : {};
      const result = await adminFetch<{ message: string }>(`/api/admin/users/${id}/${paths[confirmAction]}`, {
        method: 'POST',
        csrf: session.csrfToken,
        body,
      });
      toast.show(result.message);
      setConfirmAction(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="admin-card admin-card-pad">
        <Skeleton lines={5} />
        {error ? <p className="mt-3 admin-chip admin-chip-danger">{error}</p> : null}
      </div>
    );
  }

  const { user, counts } = data;
  return (
    <div>
      <Link to="/admin/users" className="admin-btn admin-btn-sm mb-3 no-underline">
        <ArrowLeft className="h-3.5 w-3.5" /> All users
      </Link>
      <PageHead
        title={user.displayName}
        subtitle={`${user.email || user.phone || 'no contact'} · joined ${shortDate(user.createdAt)}`}
        actions={
          <>
            {user.online ? <Chip tone="success">online</Chip> : <Chip>offline · {relativeTime(user.lastSeen)}</Chip>}
            {user.twoFactorEnabled ? <Chip tone="accent">2FA on</Chip> : <Chip>2FA off</Chip>}
            {user.status === 'suspended' ? <Chip tone="warning">suspended</Chip> : null}
            {user.status === 'banned' ? <Chip tone="danger">banned</Chip> : null}
            {user.isSupportAccount ? <Chip tone="accent">official support</Chip> : null}
            {user.isAiAccount ? <Chip tone="accent">Chatgram AI</Chip> : null}
          </>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ad-border)] px-3 py-2">
          {([
            ['profile', 'Profile', UserRound],
            ['activity', 'Activity', Clock],
            ['conversations', 'Conversations', MessageSquare],
            ['actions', 'Actions', ShieldCheck],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              className={`admin-btn admin-btn-sm ${tab === key ? 'admin-btn-primary' : ''}`}
              onClick={() => setTab(key)}
              aria-current={tab === key ? 'page' : undefined}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === 'profile' ? (
            <div className="grid gap-4 md:grid-cols-[200px_1fr]">
              <div className="flex flex-col items-center gap-2">
                <span className="grid h-24 w-24 place-items-center overflow-hidden rounded-2xl bg-[var(--ad-sunken)] text-2xl font-bold text-[var(--ad-muted)]">
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(user.displayName)}
                </span>
                <p className="text-[12px] text-[var(--ad-muted)]">User ID</p>
                <p className="break-all text-center font-mono text-[11px] text-[var(--ad-faint)]">{user.id}</p>
              </div>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {[
                  ['Display name', user.displayName],
                  ['Email', user.email || '—'],
                  ['Phone', user.phone || '—'],
                  ['About', user.about || '—'],
                  ['Created', shortDate(user.createdAt)],
                  ['Last seen', user.online ? 'online now' : relativeTime(user.lastSeen)],
                  ['Two-step verification', user.twoFactorEnabled ? 'enabled' : 'disabled'],
                  ['Account status', user.status],
                  ['Moderation reason', user.moderationReason || '—'],
                  ['Must change password', user.mustChangePassword ? 'yes' : 'no'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="admin-section-label">{label}</dt>
                    <dd className="mt-0.5 text-[13px]">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {tab === 'activity' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['Messages sent', counts.messages, MessageSquare] as const,
                ['Conversations', counts.chats, MessageSquare] as const,
                ['Groups', counts.groups, UserRound] as const,
                ['Statuses', counts.statuses, Clock] as const,
                ['Reports against', counts.reportsAgainst, Ban] as const,
                ['Reports made', counts.reportsMade, ShieldCheck] as const,
              ].map(([label, value, Icon]) => (
                <div key={String(label)} className="rounded-xl border border-[var(--ad-border)] p-3">
                  <p className="admin-section-label flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </p>
                  <p className="mt-1 text-[20px] font-bold tabular-nums">{formatNumber(Number(value))}</p>
                </div>
              ))}
              <div className="sm:col-span-3 rounded-xl border border-[var(--ad-border)] p-3">
                <p className="admin-section-label">Last message</p>
                <p className="mt-1 text-[13px]">{data.lastMessageAt ? relativeTime(data.lastMessageAt) : 'No messages yet'}</p>
                <p className="mt-3 flex items-center gap-2 text-[11.5px] text-[var(--ad-muted)]">
                  <Lock className="h-3.5 w-3.5" />
                  Message content requires the Security review flow (9d): a written reason is recorded in the audit log.
                </p>
              </div>
            </div>
          ) : null}

          {tab === 'conversations' ? (
            <ReviewConversationsTab session={session} userId={id} userName={user.displayName} />
          ) : null}

          {tab === 'actions' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--ad-border)] p-3">
                <p className="admin-card-title">Sign out every device</p>
                <p className="mt-1 text-[12px] text-[var(--ad-muted)]">
                  Bumps the session generation so every existing access and refresh token stops working. The user signs in again normally.
                </p>
                <button type="button" className="admin-btn mt-2" onClick={() => setConfirmAction('logout')} disabled={busy || user.isSupportAccount}>
                  <KeyRound className="h-3.5 w-3.5" /> Force logout
                </button>
              </div>
              <div className="rounded-xl border border-[var(--ad-border)] p-3">
                <p className="admin-card-title">Reset two-step verification</p>
                <p className="mt-1 text-[12px] text-[var(--ad-muted)]">
                  Disables 2FA and deletes the secret and recovery codes. Only do this after verifying the person's identity.
                </p>
                <button type="button" className="admin-btn admin-btn-danger mt-2" onClick={() => setConfirmAction('reset2fa')} disabled={busy || user.isSupportAccount}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Reset 2FA
                </button>
              </div>
              <div className="rounded-xl border border-[var(--ad-border)] p-3 sm:col-span-2">
                <p className="admin-card-title">Suspend or ban this account</p>
                <p className="mt-1 text-[12px] text-[var(--ad-muted)]">
                  A suspension blocks sign-in and every API call until it expires; a ban blocks the account until an admin
                  unbans it. Both bump the session generation. Every action is audited.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr]">
                  <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                    Suspension days
                    <input className="admin-input mt-1" type="number" min={1} max={3650} value={suspendDays} onChange={(event) => setSuspendDays(event.target.value)} />
                  </label>
                  <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                    Reason (recorded in the audit log)
                    <input className="admin-input mt-1" value={moderationReason} onChange={(event) => setModerationReason(event.target.value)} placeholder="e.g. abusive messages" />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="admin-btn admin-btn-danger" onClick={() => setConfirmAction('suspend')} disabled={busy || user.isSupportAccount || user.isAiAccount}>
                    <Clock className="h-3.5 w-3.5" /> Suspend
                  </button>
                  <button type="button" className="admin-btn admin-btn-danger" onClick={() => setConfirmAction('ban')} disabled={busy || user.isSupportAccount || user.isAiAccount}>
                    <Ban className="h-3.5 w-3.5" /> Ban
                  </button>
                  <button type="button" className="admin-btn" onClick={() => setConfirmAction('unban')} disabled={busy || user.isSupportAccount || user.status === 'active'}>
                    <ShieldCheck className="h-3.5 w-3.5" /> Restore access
                  </button>
                </div>
                <ul className="mt-3 space-y-1 text-[11.5px] text-[var(--ad-muted)]">
                  <li>Delete account with a 30-day grace and email verification are still to build (crossed in the report).</li>
                  <li>Conversation review (the Conversations tab) requires a written reason and is audited.</li>
                  <li>Admins can never send messages as a user or edit their messages.</li>
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {confirmAction ? (
        <ConfirmDialog
          title={
            confirmAction === 'logout'
              ? 'Sign out every device?'
              : confirmAction === 'reset2fa'
                ? 'Reset two-step verification?'
                : confirmAction === 'suspend'
                  ? `Suspend ${user.displayName}?`
                  : confirmAction === 'ban'
                    ? `Ban ${user.displayName}?`
                    : `Restore ${user.displayName}?`
          }
          body={
            confirmAction === 'logout'
              ? `Every token for ${user.displayName} will be invalidated.`
              : confirmAction === 'reset2fa'
                ? `2FA will be disabled for ${user.displayName} and the recovery codes deleted. This is audited.`
                : confirmAction === 'suspend'
                  ? `${user.displayName} cannot sign in or use the API for ${suspendDays} day(s). Reason: ${moderationReason || 'none given'}. Audited.`
                  : confirmAction === 'ban'
                    ? `${user.displayName} is blocked until an admin restores the account. Reason: ${moderationReason || 'none given'}. Audited.`
                    : `${user.displayName} will be active again and can sign in normally. Audited.`
          }
          confirmLabel={
            confirmAction === 'logout'
              ? 'Sign out'
              : confirmAction === 'reset2fa'
                ? 'Reset 2FA'
                : confirmAction === 'suspend'
                  ? 'Suspend account'
                  : confirmAction === 'ban'
                    ? 'Ban account'
                    : 'Restore access'
          }
          danger={confirmAction !== 'unban'}
          busy={busy}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void runAction()}
        />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
