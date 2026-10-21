import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, LogIn, Users, XCircle } from 'lucide-react';
import { useSession } from '@chatgram/core';
import { api } from '../lib/api';

/**
 * `/join/:token` — preview screen for a group invite link.
 *
 * A signed-in visitor sees the group (name, description, member count) and can
 * join; a signed-out visitor is told to sign in first (the link is kept in the
 * URL so they can come back to it).
 */
export default function JoinGroup({ token }: { token: string }) {
  const user = useSession((s) => s.user);
  const [joined, setJoined] = useState<string | null>(null);
  const [error, setError] = useState('');

  const invite = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => api.previewInvite(token),
    enabled: Boolean(user),
    retry: false,
  });

  const join = useMutation({
    mutationFn: () => api.joinViaInvite(token),
    onSuccess: (result) => {
      window.localStorage.setItem('chatgram.pendingChat', result.chat.id);
      setJoined(result.chat.id);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not join the group'),
  });

  function openChat() {
    window.location.href = import.meta.env.BASE_URL || '/';
  }

  return (
    <div className="grid min-h-full place-items-center bg-ink-50 p-4 dark:bg-ink-900">
      <div className="w-full max-w-sm rounded-2xl border border-ink-200 bg-white p-6 text-center shadow-xl dark:border-white/10 dark:bg-ink-800">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
          <Users className="h-8 w-8" />
        </div>

        {!user ? (
          <>
            <h1 className="mt-3 text-lg font-bold">You are invited to a Chatgram group</h1>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              Sign in or create an account first, then open this link again to join.
            </p>
            <a href={import.meta.env.BASE_URL || '/'} className="btn-primary mt-4 w-full">
              <LogIn className="h-4 w-4" /> Go to sign in
            </a>
          </>
        ) : invite.isLoading ? (
          <p className="mt-4 text-sm text-ink-500">Loading invite…</p>
        ) : invite.isError ? (
          <>
            <h1 className="mt-3 text-lg font-bold">Invite not valid</h1>
            <p role="alert" className="mt-1 text-sm text-rose-600 dark:text-rose-400">
              {invite.error instanceof Error ? invite.error.message : 'This invite link is not valid or was revoked.'}
            </p>
            <button type="button" className="btn-ghost mt-4 w-full" onClick={() => (window.location.href = import.meta.env.BASE_URL || '/')}>
              Back to Chatgram
            </button>
          </>
        ) : joined ? (
          <>
            <h1 className="mt-3 flex items-center justify-center gap-2 text-lg font-bold">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" /> You joined!
            </h1>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              {invite.data?.name} will now appear in your chat list.
            </p>
            <button type="button" className="btn-primary mt-4 w-full" onClick={openChat}>
              Open the group
            </button>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-lg font-bold">{invite.data?.name}</h1>
            {invite.data?.description ? (
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{invite.data.description}</p>
            ) : null}
            <p className="mt-1 text-[12px] text-ink-500 dark:text-ink-400">
              {invite.data?.memberCount} member{invite.data?.memberCount === 1 ? '' : 's'}
            </p>
            {error ? (
              <p role="alert" className="mt-2 flex items-center justify-center gap-1 text-sm text-rose-600 dark:text-rose-400">
                <XCircle className="h-4 w-4" /> {error}
              </p>
            ) : null}
            {invite.data?.alreadyMember ? (
              <button type="button" className="btn-primary mt-4 w-full" onClick={openChat}>
                Open the group
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary mt-4 w-full"
                disabled={join.isPending || invite.data?.full}
                onClick={() => join.mutate()}
              >
                {invite.data?.full ? 'This group is full' : join.isPending ? 'Joining…' : 'Join group'}
              </button>
            )}
            <button type="button" className="btn-ghost mt-2 w-full" onClick={() => (window.location.href = import.meta.env.BASE_URL || '/')}>
              Not now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
