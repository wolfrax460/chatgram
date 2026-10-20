import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Image as ImageIcon, Send, CircleDashed, Trash2 } from 'lucide-react';
import { useSession, type StatusItem, type User } from '@chatgram/core';
import { api } from '../lib/api';

const AUTO_ADVANCE_MS = 5200;

/* --------------------------------------------------------------- helpers */

interface Group {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  items: StatusItem[];
  latest: string;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

/** One bucket per author, newest bucket first. */
function groupByUser(statuses: StatusItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const status of statuses) {
    const author: User = status.userId;
    const existing = map.get(author.id);
    if (existing) {
      existing.items.push(status);
    } else {
      map.set(author.id, {
        userId: author.id,
        displayName: author.displayName || 'Unknown',
        avatarUrl: author.avatarUrl,
        items: [status],
        latest: status.createdAt,
      });
    }
  }
  const groups = [...map.values()];
  for (const group of groups) {
    group.items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    group.latest = group.items[group.items.length - 1]?.createdAt ?? group.latest;
  }
  return groups.sort((a, b) => new Date(b.latest).getTime() - new Date(a.latest).getTime());
}

function Avatar({ name, src, size = 44 }: { name: string; src?: string; size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}
    </div>
  );
}

/* -------------------------------------------------------------- composer */

function StatusComposer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const create = useMutation({
    mutationFn: async () => {
      let mediaUrl: string | undefined;
      if (file) {
        const uploaded = await api.uploadMedia(file);
        mediaUrl = uploaded.url;
      }
      return api.createStatus({ text: text.trim() || undefined, mediaUrl });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['statuses'] });
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not post status'),
  });

  const canPost = (text.trim().length > 0 || Boolean(file)) && !create.isPending;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 animate-fade-up" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">New status</h3>
          <button type="button" className="btn-ghost !px-2" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <p className="mb-3 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </p>
        ) : null}

        <textarea
          rows={3}
          className="field resize-none"
          maxLength={700}
          placeholder="What's on your mind? Disappears after 24 hours."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (!picked) return;
            if (picked.size > 10 * 1024 * 1024) {
              setError('Image is larger than 10 MB.');
              return;
            }
            setFile(picked);
          }}
        />

        {preview ? (
          <div className="relative mt-3">
            <img src={preview} alt="Status preview" className="max-h-56 w-full rounded-xl object-cover" />
            <button
              type="button"
              className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white"
              onClick={() => setFile(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button type="button" className="btn-ghost text-sm" onClick={() => inputRef.current?.click()}>
            <ImageIcon className="h-4 w-4" /> Photo
          </button>
          <span className="flex-1" />
          <button type="button" className="btn-primary" disabled={!canPost} onClick={() => create.mutate()}>
            <Send className="h-4 w-4" /> {create.isPending ? 'Posting…' : 'Post status'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- viewer */

function StatusViewer({
  group,
  meId,
  onClose,
}: {
  group: Group;
  meId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const timer = useRef<number | null>(null);
  const item = group.items[index];
  const mine = group.userId === meId;

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 < group.items.length) return i + 1;
      onClose();
      return i;
    });
  }, [group.items.length, onClose]);

  const prev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : 0)), []);

  // Mark viewed + auto-advance.
  useEffect(() => {
    if (!item) return undefined;
    if (!mine) api.viewStatus(item.id).catch(() => {});
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(next, AUTO_ADVANCE_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [item, mine, next]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  async function remove() {
    if (!item) return;
    await api.deleteStatus(item.id).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ['statuses'] });
    next();
  }

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 animate-fade-up">
      <div className="flex gap-1 px-3 pt-3">
        {group.items.map((s, i) => (
          <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
            <div
              className={`h-full bg-white ${i < index ? 'w-full' : ''}`}
              style={
                i === index
                  ? { animation: `status-progress ${AUTO_ADVANCE_MS}ms linear forwards` }
                  : i > index
                    ? { width: 0 }
                    : undefined
              }
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-3 py-3">
        <Avatar name={group.displayName} src={group.avatarUrl} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{group.displayName}</p>
          <p className="text-[11px] text-white/60">{timeAgo(item.createdAt)}</p>
        </div>
        {mine ? (
          <button type="button" className="text-white/80 hover:text-white" onClick={remove} title="Delete">
            <Trash2 className="h-5 w-5" />
          </button>
        ) : null}
        <button type="button" className="text-white/80 hover:text-white" onClick={onClose} title="Close">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 pb-6">
        <button type="button" className="absolute left-0 top-0 h-full w-1/3" onClick={prev} aria-label="Previous" />
        <button type="button" className="absolute right-0 top-0 h-1/3 w-1/3" onClick={next} aria-label="Next" />
        <div className="max-h-full w-full max-w-lg text-center">
          {item.mediaUrl ? (
            <img src={item.mediaUrl} alt="" className="mx-auto max-h-[62vh] rounded-xl object-contain" />
          ) : null}
          {item.text ? (
            <p className="mt-4 whitespace-pre-wrap break-words text-lg font-medium text-white">{item.text}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function Status() {
  const me = useSession((s) => s.user);
  const [composing, setComposing] = useState(false);
  const [viewing, setViewing] = useState<Group | null>(null);

  const statuses = useQuery({ queryKey: ['statuses'], queryFn: () => api.statuses() });
  const meId = me?.id ?? '';

  const groups = useMemo(() => groupByUser(statuses.data ?? []), [statuses.data]);
  const mine = groups.find((g) => g.userId === meId);
  const others = groups.filter((g) => g.userId !== meId);

  const hasUnseen = (group: Group) =>
    group.items.some((s) => !s.viewedBy.some((v) => v.id === meId));

  return (
    <div className="mx-auto flex h-full w-full flex-col">
      <header className="flex items-center gap-2 border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <CircleDashed className="h-5 w-5 text-brand-600" />
        <h2 className="font-bold">Status</h2>
        <span className="flex-1" />
        <button type="button" className="btn-primary" onClick={() => setComposing(true)}>
          <Plus className="h-4 w-4" /> Add
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* my status */}
        <button
          type="button"
          onClick={() => (mine ? setViewing(mine) : setComposing(true))}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
        >
          <div className="relative">
            <Avatar name={me?.displayName ?? 'You'} src={me?.avatarUrl} size={48} />
            {!mine ? (
              <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-brand-600 text-white dark:border-ink-900">
                <Plus className="h-3 w-3" />
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">My status</p>
            <p className="truncate text-xs text-ink-500 dark:text-ink-400">
              {mine
                ? `${mine.items.length} update${mine.items.length === 1 ? '' : 's'} · ${timeAgo(mine.latest)}`
                : 'Tap to add a status update'}
            </p>
          </div>
        </button>

        <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
          Recent updates
        </p>

        {statuses.isLoading ? <p className="p-4 text-sm text-ink-500">Loading…</p> : null}

        {!statuses.isLoading && others.length === 0 ? (
          <div className="grid h-48 place-items-center px-6 text-center">
            <div>
              <CircleDashed className="mx-auto h-10 w-10 text-ink-300 dark:text-ink-600" />
              <p className="mt-3 font-semibold">No recent updates</p>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                Status updates from your contacts appear here and disappear after 24 hours.
              </p>
            </div>
          </div>
        ) : null}

        {others.map((group) => (
          <button
            key={group.userId}
            type="button"
            onClick={() => setViewing(group)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
          >
            <span
              className="rounded-full p-[2.5px]"
              style={{
                background: hasUnseen(group)
                  ? 'conic-gradient(#25d366 0 78%, #008069 78% 100%)'
                  : 'rgba(134,150,160,.45)',
              }}
            >
              <span className="block rounded-full bg-white p-[2px] dark:bg-ink-900">
                <Avatar name={group.displayName} src={group.avatarUrl} size={44} />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{group.displayName}</p>
              <p className="text-xs text-ink-500 dark:text-ink-400">
                {group.items.length} update{group.items.length === 1 ? '' : 's'} · {timeAgo(group.latest)}
              </p>
            </div>
          </button>
        ))}

        <p className="px-4 py-6 text-center text-xs text-ink-400">
          Status updates are deleted automatically after 24 hours.
        </p>
      </div>

      {composing ? <StatusComposer onClose={() => setComposing(false)} /> : null}
      {viewing ? (
        <StatusViewer
          group={viewing}
          meId={meId}
          onClose={() => {
            setViewing(null);
            void statuses.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
