import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, MessageSquare, ShieldAlert, ShieldCheck, Timer, X } from 'lucide-react';
import {
  adminFetch,
  type AdminSessionInfo,
  type ReviewConversation,
  type ReviewMessage,
  type ReviewRow,
} from './api';
import { Chip, Skeleton, useToast } from './ui';

/**
 * 9d: read-only conversation review, behind a mandatory written reason.
 *
 * Nothing is fetched until POST /api/admin/reviews returns a review session.
 * Every page of messages the admin opens is audited server-side. The session
 * expires after 15 minutes of inactivity; the banner counts the time down and
 * the server refuses content once the session has ended.
 */
export default function ReviewConversationsTab({
  session,
  userId,
  userName,
}: {
  session: AdminSessionInfo;
  userId: string;
  userName: string;
}) {
  const toast = useToast();
  const [review, setReview] = useState<ReviewRow | null>(null);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [conversations, setConversations] = useState<ReviewConversation[]>([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [messages, setMessages] = useState<ReviewMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshConversations = useCallback(
    async (reviewId: string) => {
      setLoadingConversations(true);
      try {
        const payload = await adminFetch<{ conversations: ReviewConversation[]; review: ReviewRow }>(
          `/api/admin/reviews/${reviewId}/conversations`,
        );
        setConversations(payload.conversations);
        setReview(payload.review);
        setSecondsLeft(payload.review.secondsLeft);
        if (!activeChatId && payload.conversations[0]) setActiveChatId(payload.conversations[0].id);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load the conversations.');
      } finally {
        setLoadingConversations(false);
      }
    },
    [activeChatId],
  );

  const loadMessages = useCallback(
    async (reviewId: string, chatId: string) => {
      if (!chatId) return;
      setLoadingMessages(true);
      setError('');
      try {
        const payload = await adminFetch<{ messages: ReviewMessage[]; review: ReviewRow }>(
          `/api/admin/reviews/${reviewId}/messages?chatId=${encodeURIComponent(chatId)}&limit=100`,
        );
        setMessages(payload.messages);
        // Only the countdown changes here — setting the review object again would
        // retrigger the loading effect and loop forever.
        setSecondsLeft(payload.review.secondsLeft);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load the conversation.');
      } finally {
        setLoadingMessages(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!review) return;
    tick.current = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => {
      if (tick.current) clearInterval(tick.current);
      tick.current = null;
    };
  }, [review?.id]);

  useEffect(() => {
    if (!review?.id || !activeChatId) return;
    void loadMessages(review.id, activeChatId);
  }, [review?.id, activeChatId, loadMessages]);

  async function startReview() {
    setStarting(true);
    setError('');
    try {
      const payload = await adminFetch<{ review: ReviewRow }>('/api/admin/reviews', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { userId, reason: reason.trim(), reference: reference.trim() || undefined },
      });
      setReview(payload.review);
      setSecondsLeft(payload.review.secondsLeft);
      await refreshConversations(payload.review.id);
      toast.show('Security review started — read-only, expires after 15 minutes of inactivity.');
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the review.');
    } finally {
      setStarting(false);
    }
  }

  async function endReview() {
    if (!review) return;
    try {
      await adminFetch(`/api/admin/reviews/${review.id}/end`, { method: 'POST', csrf: session.csrfToken, body: {} });
      toast.show('Security review ended.');
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : 'Could not end the review.');
    }
    setReview(null);
    setConversations([]);
    setMessages([]);
    setActiveChatId('');
    setReason('');
    setReference('');
  }

  if (!review) {
    return (
      <div className="admin-card admin-card-pad review-gate">
        <div className="review-gate-head">
          <span className="review-lock"><Lock className="h-5 w-5" /></span>
          <div>
            <h2 className="text-[15px] font-semibold">Security review required</h2>
            <p className="text-[12.5px] text-[var(--ad-muted)]">
              Conversation content stays hidden until you record why you need it. Every view is written to the
              append-only audit log, the content is read-only, and the review ends after 15 minutes of inactivity.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
            Reason (required, minimum 10 characters)
            <textarea
              className="admin-input mt-1 h-24 w-full resize-y"
              value={reason}
              maxLength={500}
              placeholder="e.g. Report #1234: suspected harassment in a direct chat."
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
            Report or ticket reference (optional)
            <input
              className="admin-input mt-1 w-full"
              value={reference}
              maxLength={120}
              placeholder="REPORT-1234"
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={starting || reason.trim().length < 10}
            onClick={() => void startReview()}
          >
            <Eye className="h-3.5 w-3.5" /> {starting ? 'Starting…' : `Start review of ${userName}`}
          </button>
          <span className="text-[11.5px] text-[var(--ad-muted)]">
            <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
            Admins can never send, edit or delete messages, and never see passwords, tokens or 2FA secrets.
          </span>
        </div>
        {error ? <p className="admin-chip admin-chip-danger mt-3">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="review-active">
      <div className="admin-card review-banner">
        <span className="review-badge"><ShieldCheck className="h-4 w-4" /> Security review mode · read-only</span>
        <span className="review-timer">
          <Timer className="h-3.5 w-3.5" /> ends in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} of inactivity
        </span>
        <button type="button" className="admin-btn admin-btn-sm" onClick={() => void endReview()}>
          <X className="h-3.5 w-3.5" /> End review
        </button>
      </div>
      <p className="text-[11.5px] text-[var(--ad-muted)]">
        Reason: “{review.reason}”{review.reference ? ` · reference ${review.reference}` : ''} · this page and every
        message page you open are audited.
      </p>
      {error ? <p className="admin-chip admin-chip-danger mt-2">{error}</p> : null}

      <div className="review-split">
        <div className="admin-card review-chats">
          <p className="admin-section-label">Conversations</p>
          {loadingConversations ? (
            <Skeleton lines={4} />
          ) : conversations.length === 0 ? (
            <p className="text-[12.5px] text-[var(--ad-muted)]">This account has no conversations.</p>
          ) : (
            <ul className="review-chat-list">
              {conversations.map((chat) => (
                <li key={chat.id}>
                  <button
                    type="button"
                    className={`review-chat ${chat.id === activeChatId ? 'active' : ''}`}
                    onClick={() => setActiveChatId(chat.id)}
                  >
                    <span className="review-chat-icon">{chat.type === 'group' ? <MessageSquare className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}</span>
                    <span className="min-w-0">
                      <strong className="block truncate">{chat.title}</strong>
                      <span className="block truncate text-[11px] text-[var(--ad-muted)]">
                        {chat.lastMessage || 'No messages yet'}
                      </span>
                    </span>
                    {chat.frozen ? <Chip tone="warning">frozen</Chip> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="admin-card review-messages">
          <div className="flex items-center justify-between gap-2">
            <p className="admin-section-label">Read-only transcript</p>
            <span className="text-[11px] text-[var(--ad-muted)]">
              <EyeOff className="mr-1 inline h-3 w-3" /> cannot reply, edit or delete
            </span>
          </div>
          {loadingMessages ? (
            <Skeleton lines={6} />
          ) : messages.length === 0 ? (
            <p className="text-[12.5px] text-[var(--ad-muted)]">No messages in this conversation.</p>
          ) : (
            <ol className="review-transcript">
              {messages.map((message) => (
                <li key={message.id} className={message.isDeleted ? 'deleted' : ''}>
                  <div className="review-message-head">
                    <strong>{message.senderName}</strong>
                    <span>
                      {new Date(message.sentAt).toLocaleString()}
                      {message.editedAt ? ' · edited' : ''}
                      {message.isDeleted ? ' · deleted for everyone' : ''}
                    </span>
                  </div>
                  {message.type === 'text' || message.type === 'system' ? (
                    <p>{message.content}</p>
                  ) : (
                    <p>
                      [{message.type}] {message.mediaUrl ? <a href={message.mediaUrl} target="_blank" rel="noreferrer">{message.mediaUrl}</a> : 'media'}
                      {message.content ? ` — ${message.content}` : ''}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
