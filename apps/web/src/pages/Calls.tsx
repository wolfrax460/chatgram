import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, Ban, ChevronLeft, MoreVertical, Phone, PhoneMissed,
  Search, Trash2, Users, Video, X,
} from 'lucide-react';
import type { CallHistoryItem } from '@chatgram/api-client';
import { useSession } from '@chatgram/core';
import { api } from '../lib/api';
import { startCall } from '../lib/calls';
import { READ_ONLY_CALL_HINT } from '../lib/readOnly';
import { avatarGradient, formatTime, initialsFor, type TimeFormat } from '../lib/ui';
import { usePrefs } from '@chatgram/core';

type PickerMode = null | 'single' | 'group';

function durationLabel(seconds: number): string {
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} min ${rest ? `${rest} s` : ''}`.trim() : `${rest} s`;
}

function statusLine(call: CallHistoryItem, timeFormat: TimeFormat): string {
  const when = formatTime(call.startedAt, timeFormat);
  if (call.status === 'missed') return `Missed · ${when}`;
  if (call.status === 'declined') return `Declined · ${when}`;
  if (call.status === 'cancelled') return `No answer · ${when}`;
  return `${when}${call.durationSeconds ? ` · ${durationLabel(call.durationSeconds)}` : ''}`;
}

function DirectionIcon({ call }: { call: CallHistoryItem }) {
  if (call.status === 'missed') return <PhoneMissed className="h-3.5 w-3.5 text-rose-500" aria-label="Missed call" />;
  if (call.direction === 'incoming') return <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" aria-label="Incoming call" />;
  return <ArrowUpRight className="h-3.5 w-3.5 text-brand-500" aria-label="Outgoing call" />;
}

/**
 * Calls tab: history on the left, call details on the right, and a picker for
 * starting a new voice/video call with one person or a group.
 */
export default function Calls({
  onOpenChat,
  readOnly = false,
}: {
  onOpenChat: (chatId: string) => void;
  /** Read-only mode: call history stays readable, starting a call is disabled. */
  readOnly?: boolean;
}) {
  const me = useSession((s) => s.user);
  const timeFormat = usePrefs((s) => s.timeFormat);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerMode>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [error, setError] = useState('');

  const history = useQuery({
    queryKey: ['call-history'],
    queryFn: () => api.callHistory(),
    refetchInterval: 30_000,
  });
  const missed = useQuery({
    queryKey: ['call-missed-count'],
    queryFn: () => api.callMissedCount(),
    refetchInterval: 30_000,
  });
  const contacts = useQuery({
    queryKey: ['call-contacts'],
    queryFn: () => api.callContacts(),
    enabled: picker === 'single',
  });
  const groups = useQuery({
    queryKey: ['call-groups'],
    queryFn: () => api.callGroups(),
    enabled: picker === 'group',
  });

  // Opening the tab clears the missed-call badge (a write, so skipped when the
  // server is in read-only maintenance mode).
  useEffect(() => {
    if (readOnly) return;
    if ((missed.data?.count ?? 0) === 0) return;
    void api
      .markCallsSeen()
      .then(() => queryClient.invalidateQueries({ queryKey: ['call-missed-count'] }))
      .catch(() => undefined);
  }, [missed.data?.count, queryClient, readOnly]);

  const calls = history.data?.calls ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return calls;
    return calls.filter((call) =>
      [...call.participants, call.caller].some((p) => p?.displayName?.toLowerCase().includes(needle)),
    );
  }, [calls, query]);

  const selected = calls.find((call) => call.id === selectedId) ?? null;
  const otherPerson = (call: CallHistoryItem) =>
    call.participants.find((p) => p.id !== me?.id) ?? call.participants[0] ?? call.caller;

  async function callPeer(peerId: string, displayName: string, video: boolean) {
    if (readOnly) {
      setPicker(null);
      setError(READ_ONLY_CALL_HINT);
      return;
    }
    setPicker(null);
    setError('');
    try {
      const chat = await api.createDirect(peerId);
      await startCall({ chatId: chat.id, title: displayName, isGroup: false }, { video });
    } catch {
      setError('Could not start the call.');
    }
  }

  async function callGroup(groupId: string, title: string, participantCount: number, video: boolean) {
    if (readOnly) {
      setPicker(null);
      setError(READ_ONLY_CALL_HINT);
      return;
    }
    setPicker(null);
    setError('');
    try {
      await startCall({ chatId: groupId, title, isGroup: true, participantCount }, { video });
    } catch {
      setError('Could not start the call.');
    }
  }

  const deleteCall = useMutation({
    mutationFn: (id: string) => api.deleteCall(id),
    onSuccess: () => {
      setMenuFor(null);
      void queryClient.invalidateQueries({ queryKey: ['call-history'] });
    },
    onError: () => setError('Could not delete that call.'),
  });

  const clearHistory = useMutation({
    mutationFn: () => api.clearCalls(),
    onSuccess: () => {
      setMenuFor(null);
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ['call-history'] });
    },
    onError: () => setError('Could not clear the history.'),
  });

  const block = useMutation({
    mutationFn: (userId: string) => api.blockUser(userId),
    onSuccess: () => {
      setMenuFor(null);
      void queryClient.invalidateQueries({ queryKey: ['call-history'] });
    },
    onError: () => setError('Could not block that person.'),
  });

  const contactList = (contacts.data?.contacts ?? []).filter((c) =>
    c.displayName.toLowerCase().includes(pickerQuery.trim().toLowerCase()),
  );

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* history column */}
      <aside
        className={`${selected ? 'hidden lg:flex' : 'flex'} w-full shrink-0 flex-col border-r border-ink-200 dark:border-white/10 sm:w-[360px]`}
      >
        <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3 dark:border-white/10">
          <h2 className="text-lg font-bold">Calls</h2>
          {calls.length > 0 ? (
            <button
              type="button"
              className="btn-ghost !px-2 text-[12px]"
              onClick={() => clearHistory.mutate()}
              disabled={clearHistory.isPending}
            >
              Clear
            </button>
          ) : null}
        </header>

        <div className="border-b border-ink-200 px-3 py-2 dark:border-white/10">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-500 dark:text-ink-400" />
            <input
              className="field pl-9"
              placeholder="Search calls"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search calls"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setPicker('single')}
          disabled={readOnly}
          title={readOnly ? READ_ONLY_CALL_HINT : undefined}
          className="flex w-full items-center gap-3 border-b border-ink-200 px-4 py-3 text-left hover:bg-ink-100/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:border-white/10 dark:hover:bg-white/[.04]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
            <Phone className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Start new call</span>
            <span className="block text-[12px] text-ink-500 dark:text-ink-300">Voice or video, one person or a group</span>
          </span>
        </button>

        {error ? <p className="px-4 py-2 text-[12.5px] text-rose-600 dark:text-rose-400">{error}</p> : null}

        <div className="flex-1 overflow-y-auto">
          {history.isLoading ? <p className="p-4 text-sm text-ink-500">Loading calls…</p> : null}
          {!history.isLoading && filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-500 dark:text-ink-300">
              <p className="font-semibold">{query ? 'No matching calls' : 'No calls yet'}</p>
              <p className="mt-1 text-[12.5px]">Start one with the button above.</p>
            </div>
          ) : null}

          {filtered.map((call) => {
            const person = otherPerson(call);
            const title = call.isGroup ? call.title || 'Group call' : person?.displayName ?? 'Unknown';
            const isMissed = call.status === 'missed';
            return (
              <div
                key={call.id}
                className={`relative flex items-center gap-3 px-3 py-2.5 transition ${
                  call.id === selectedId ? 'bg-brand-600/10 dark:bg-white/[.07]' : 'hover:bg-ink-100/70 dark:hover:bg-white/[.04]'
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => setSelectedId(call.id)}
                  aria-label={`Open details for the call with ${title}`}
                >
                  <span className={`relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br ${avatarGradient(person?.id ?? call.id)} text-xs font-bold text-white`}>
                    {person?.avatarUrl ? (
                      <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : call.isGroup ? (
                      <Users className="h-5 w-5" />
                    ) : (
                      initialsFor(title)
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium ${isMissed ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                      {title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-500 dark:text-ink-300">
                      <DirectionIcon call={call} />
                      {call.type === 'video' ? <Video className="h-3.5 w-3.5" aria-label="Video call" /> : null}
                      <span className="truncate">{statusLine(call, timeFormat)}</span>
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className={`btn-ghost !px-2 ${readOnly ? 'cursor-not-allowed opacity-40' : ''}`}
                  aria-label={readOnly ? READ_ONLY_CALL_HINT : `Call ${title} again`}
                  title={readOnly ? READ_ONLY_CALL_HINT : 'Call back'}
                  disabled={readOnly}
                  onClick={() => {
                    if (call.isGroup) void callGroup(call.chatId ?? '', title, call.participants.length, false);
                    else if (person) void callPeer(person.id, person.displayName, false);
                  }}
                >
                  <Phone className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={`btn-ghost !px-2 ${readOnly ? 'cursor-not-allowed opacity-40' : ''}`}
                  aria-label={readOnly ? READ_ONLY_CALL_HINT : `Video call ${title} again`}
                  title={readOnly ? READ_ONLY_CALL_HINT : 'Video call back'}
                  disabled={readOnly}
                  onClick={() => {
                    if (call.isGroup) void callGroup(call.chatId ?? '', title, call.participants.length, true);
                    else if (person) void callPeer(person.id, person.displayName, true);
                  }}
                >
                  <Video className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-ghost !px-2"
                  aria-label="Call options"
                  aria-expanded={menuFor === call.id}
                  onClick={() => setMenuFor(menuFor === call.id ? null : call.id)}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>

                {menuFor === call.id ? (
                  <div className="absolute right-2 top-12 z-30 w-44 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-ink-700">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10"
                      onClick={() => deleteCall.mutate(call.id)}
                    >
                      <Trash2 className="h-4 w-4" /> Delete from history
                    </button>
                    {person ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-ink-100 dark:hover:bg-white/10"
                        onClick={() => block.mutate(person.id)}
                      >
                        <Ban className="h-4 w-4" /> Block {person.displayName}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>

      {/* details pane */}
      <section className="hidden min-w-0 flex-1 flex-col lg:flex">
        {!selected ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div className="max-w-sm">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-600 text-white shadow-lg">
                <Phone className="h-8 w-8" />
              </span>
              <h2 className="mt-3 text-lg font-bold">Your calls</h2>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
                Pick a call to see who took part, when it happened and how long it lasted.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-ink-200 px-4 py-3 dark:border-white/10 lg:hidden">
              <button type="button" className="btn-ghost !px-2" onClick={() => setSelectedId(null)} aria-label="Back to calls">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="font-semibold">Call details</span>
            </header>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mx-auto max-w-lg">
                <div className="flex items-center gap-3">
                  <span className={`grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br ${avatarGradient(otherPerson(selected)?.id ?? selected.id)} text-sm font-bold text-white`}>
                    {otherPerson(selected)?.avatarUrl ? (
                      <img src={otherPerson(selected)?.avatarUrl ?? ''} alt="" className="h-full w-full object-cover" />
                    ) : selected.isGroup ? (
                      <Users className="h-6 w-6" />
                    ) : (
                      initialsFor(selected.isGroup ? selected.title : otherPerson(selected)?.displayName ?? '?')
                    )}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold">
                      {selected.isGroup ? selected.title || 'Group call' : otherPerson(selected)?.displayName ?? 'Unknown'}
                    </h2>
                    <p className="text-[12.5px] text-ink-500 dark:text-ink-300">
                      {selected.type === 'video' ? 'Video call' : 'Voice call'} · {statusLine(selected, timeFormat)}
                    </p>
                  </div>
                </div>

                <dl className="mt-5 space-y-2 rounded-xl border border-ink-200 p-4 text-sm dark:border-white/10">
                  {selected.isGroup ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-500 dark:text-ink-300">Participants</dt>
                      <dd className="text-right">{selected.participants.map((p) => p.displayName).join(', ')}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500 dark:text-ink-300">Started</dt>
                    <dd>{new Date(selected.startedAt).toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500 dark:text-ink-300">Status</dt>
                    <dd className="capitalize">{selected.status}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500 dark:text-ink-300">Duration</dt>
                    <dd>{selected.durationSeconds ? durationLabel(selected.durationSeconds) : '—'}</dd>
                  </div>
                </dl>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`btn-primary ${readOnly ? 'cursor-not-allowed opacity-50' : ''}`}
                    disabled={readOnly}
                    title={readOnly ? READ_ONLY_CALL_HINT : undefined}
                    onClick={() => {
                      const person = otherPerson(selected);
                      if (selected.isGroup) void callGroup(selected.chatId ?? '', selected.title, selected.participants.length, false);
                      else if (person) void callPeer(person.id, person.displayName, false);
                    }}
                  >
                    <Phone className="mr-1.5 inline h-4 w-4" /> Call back
                  </button>
                  <button
                    type="button"
                    className={`btn-ghost ${readOnly ? 'cursor-not-allowed opacity-50' : ''}`}
                    disabled={readOnly}
                    title={readOnly ? READ_ONLY_CALL_HINT : undefined}
                    onClick={() => {
                      const person = otherPerson(selected);
                      if (selected.isGroup) void callGroup(selected.chatId ?? '', selected.title, selected.participants.length, true);
                      else if (person) void callPeer(person.id, person.displayName, true);
                    }}
                  >
                    <Video className="mr-1.5 inline h-4 w-4" /> Video call
                  </button>
                  {selected.chatId ? (
                    <button type="button" className="btn-ghost" onClick={() => onOpenChat(selected.chatId!)}>
                      Message
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* start-call picker */}
      {picker ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setPicker(null)}>
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-ink-800"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Start a new call"
          >
            <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3 dark:border-white/10">
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost !px-2" onClick={() => setPicker(null)} aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
                <h3 className="font-bold">Start a new call</h3>
              </div>
              <div className="flex rounded-lg bg-ink-100 p-0.5 text-[12px] dark:bg-white/10">
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 font-semibold ${picker === 'single' ? 'bg-white shadow dark:bg-ink-700' : ''}`}
                  onClick={() => setPicker('single')}
                >
                  Person
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 font-semibold ${picker === 'group' ? 'bg-white shadow dark:bg-ink-700' : ''}`}
                  onClick={() => setPicker('group')}
                >
                  Group
                </button>
              </div>
            </div>

            <div className="border-b border-ink-200 px-3 py-2 dark:border-white/10">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-500" />
                <input
                  autoFocus
                  className="field pl-9"
                  placeholder={picker === 'single' ? 'Search contacts' : 'Search groups'}
                  value={pickerQuery}
                  onChange={(event) => setPickerQuery(event.target.value)}
                  aria-label="Search"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {picker === 'single' ? (
                contactList.length === 0 ? (
                  <p className="p-4 text-sm text-ink-500">
                    {contacts.isLoading ? 'Loading…' : 'No contacts yet. Add people from the New chat panel.'}
                  </p>
                ) : (
                  contactList.map((person) => (
                    <div key={person.id} className="flex items-center gap-3 px-3 py-2">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br ${avatarGradient(person.id)} text-[11px] font-bold text-white`}>
                        {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" /> : initialsFor(person.displayName)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{person.displayName}</span>
                      <button type="button" className="btn-ghost !px-2" title="Voice call" aria-label={`Voice call ${person.displayName}`} onClick={() => void callPeer(person.id, person.displayName, false)}>
                        <Phone className="h-4 w-4" />
                      </button>
                      <button type="button" className="btn-ghost !px-2" title="Video call" aria-label={`Video call ${person.displayName}`} onClick={() => void callPeer(person.id, person.displayName, true)}>
                        <Video className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )
              ) : (groups.data?.groups ?? []).filter((g) => g.title.toLowerCase().includes(pickerQuery.trim().toLowerCase())).length === 0 ? (
                <p className="p-4 text-sm text-ink-500">{groups.isLoading ? 'Loading…' : 'No groups yet.'}</p>
              ) : (
                (groups.data?.groups ?? [])
                  .filter((g) => g.title.toLowerCase().includes(pickerQuery.trim().toLowerCase()))
                  .map((group) => (
                    <div key={group.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
                        <Users className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{group.title}</span>
                        <span className="block text-[11.5px] text-ink-500">{group.participantCount} members · up to 6 on video, 12 audio</span>
                      </span>
                      <button type="button" className="btn-ghost !px-2" title="Voice call" aria-label={`Voice call ${group.title}`} onClick={() => void callGroup(group.id, group.title, group.participantCount, false)}>
                        <Phone className="h-4 w-4" />
                      </button>
                      <button type="button" className="btn-ghost !px-2" title="Video call" aria-label={`Video call ${group.title}`} onClick={() => void callGroup(group.id, group.title, group.participantCount, true)}>
                        <Video className="h-4 w-4" />
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
