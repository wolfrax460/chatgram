import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Avatar, Icon, Spinner, EmptyState, ErrorNote } from '../components/ui.jsx';

const AUTO_ADVANCE_MS = 5200;

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

/** Group a flat status list into one bucket per author, newest bucket first. */
function groupByUser(statuses) {
  const map = new Map();
  for (const s of statuses) {
    const author = s.userId || {};
    const id = author._id || author.id || 'unknown';
    if (!map.has(id)) {
      map.set(id, {
        userId: id,
        displayName: author.displayName || 'Unknown',
        avatarUrl: author.avatarUrl,
        items: [],
      });
    }
    map.get(id).items.push(s);
  }
  for (const g of map.values()) {
    g.items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    g.latest = g.items[g.items.length - 1]?.createdAt;
  }
  return [...map.values()].sort((a, b) => new Date(b.latest) - new Date(a.latest));
}

/* ------------------------------------------------------------- composer */
function StatusComposer({ me, onClose, onCreated }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit() {
    if (!text.trim() && !file) {
      setError('Add some text, a photo, or both.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let mediaUrl;
      if (file) {
        const uploaded = await api.uploadMedia(file);
        mediaUrl = uploaded?.file?.url;
        if (!mediaUrl) throw new Error('Upload did not return a URL.');
      }
      const created = await api.createStatus({
        text: text.trim() || undefined,
        mediaUrl,
      });
      onCreated(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800 animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">New status</h3>
          <button type="button" className="btn-ghost !px-2" onClick={onClose}>
            <Icon.close className="h-5 w-5" />
          </button>
        </div>

        <ErrorNote onDismiss={() => setError('')}>{error}</ErrorNote>

        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's on your mind? Disappears after 24 hours."
          className="field mt-3 resize-none"
          maxLength={700}
        />

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f && f.size > 10 * 1024 * 1024) {
              setError('Image is larger than 10 MB.');
              return;
            }
            setFile(f || null);
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
              <Icon.close className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button type="button" className="btn-soft !px-3" onClick={() => inputRef.current?.click()}>
            <Icon.image className="h-4 w-4" /> Photo
          </button>
          <span className="flex-1" />
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <Icon.send className="h-4 w-4" />}
            {busy ? 'Posting…' : 'Post status'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- viewer */
function StatusViewer({ group, meId, onClose, onDeleted }) {
  const [index, setIndex] = useState(0);
  const timer = useRef(null);
  const item = group.items[index];
  const mine = group.userId === meId;

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 < group.items.length) return i + 1;
      onClose();
      return i;
    });
  }, [group.items.length, onClose]);

  const prev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : 0));
  }, []);

  // Mark viewed + auto-advance.
  useEffect(() => {
    if (!item?._id) return undefined;
    if (!mine) api.viewStatus(item._id).catch(() => {});
    clearTimeout(timer.current);
    timer.current = setTimeout(next, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer.current);
  }, [item?._id, mine, next]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  async function remove() {
    try {
      await api.deleteStatus(item._id);
      onDeleted(item._id);
      next();
    } catch {
      /* ignore */
    }
  }

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 animate-fade-in">
      {/* progress bars */}
      <div className="flex gap-1 px-3 pt-3">
        {group.items.map((_, i) => (
          <div key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
            <div
              className={`h-full bg-white ${i < index ? 'w-full' : i === index ? 'pd-progress' : 'w-0'}`}
              style={
                i === index
                  ? { animation: `pd-progress ${AUTO_ADVANCE_MS}ms linear forwards` }
                  : undefined
              }
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-3 py-3">
        <Avatar name={group.displayName} src={group.avatarUrl} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{group.displayName}</div>
          <div className="text-[11px] text-white/60">{timeAgo(item.createdAt)}</div>
        </div>
        {mine ? (
          <button type="button" className="text-white/80 hover:text-white" onClick={remove} title="Delete">
            <Icon.close className="h-5 w-5" />
          </button>
        ) : null}
        <button type="button" className="text-white/80 hover:text-white" onClick={onClose} title="Close">
          <Icon.close className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 pb-6">
        <button
          type="button"
          className="absolute left-0 top-0 h-full w-1/3 cursor-pointer"
          onClick={prev}
          aria-label="Previous"
        />
        <button
          type="button"
          className="absolute right-0 top-0 h-full w-1/3 cursor-pointer"
          onClick={next}
          aria-label="Next"
        />
        <div className="max-h-full w-full max-w-lg text-center">
          {item.mediaUrl ? (
            <img
              src={item.mediaUrl}
              alt=""
              className="mx-auto max-h-[62vh] rounded-xl object-contain"
            />
          ) : null}
          {item.text ? (
            <p className="mt-4 whitespace-pre-wrap break-words text-lg font-medium text-white">
              {item.text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ main */
export default function Status({ meId, user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems((await api.statuses()) || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => groupByUser(items), [items]);
  const mine = groups.find((g) => g.userId === meId);
  const others = groups.filter((g) => g.userId !== meId);

  /** Has any item in this bucket not been viewed by me? */
  const hasUnseen = (group) =>
    group.items.some(
      (s) => !(s.viewedBy || []).some((v) => (v._id || v) === meId),
    );

  return (
    <div className="mx-auto h-full w-full max-w-2xl overflow-y-auto">
      <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <h2 className="text-lg font-bold">Status</h2>
        <div className="flex gap-1">
          <button type="button" className="btn-ghost !px-2" onClick={load} title="Refresh">
            <Icon.refresh className="h-5 w-5" />
          </button>
          <button type="button" className="btn-primary" onClick={() => setComposing(true)}>
            <Icon.plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>

      {error ? <div className="p-3"><ErrorNote onDismiss={() => setError('')}>{error}</ErrorNote></div> : null}

      {/* my status */}
      <button
        type="button"
        onClick={() => (mine ? setViewing(mine) : setComposing(true))}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
      >
        <div className="relative">
          <Avatar name={user?.displayName || 'You'} src={user?.avatarUrl} size={48} online />
          {!mine ? (
            <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-brand-600 text-white dark:border-ink-900">
              <Icon.plus className="h-3 w-3" />
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">My status</div>
          <div className="truncate text-[13px] text-ink-500 dark:text-ink-400">
            {mine
              ? `${mine.items.length} update${mine.items.length === 1 ? '' : 's'} · ${timeAgo(mine.latest)}`
              : 'Tap to add a status update'}
          </div>
        </div>
        {mine ? <Icon.chevronRight className="h-5 w-5 text-ink-400" /> : null}
      </button>

      <div className="px-4 pb-1 pt-4 text-[11.5px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
        Recent updates
      </div>

      {loading && items.length === 0 ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : others.length === 0 ? (
        <EmptyState
          icon={Icon.statusRing}
          title="No recent updates"
          message="Status updates from your contacts appear here and disappear after 24 hours."
        />
      ) : (
        others.map((group) => (
          <button
            key={group.userId}
            type="button"
            onClick={() => setViewing(group)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
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
              <div className="truncate font-semibold">{group.displayName}</div>
              <div className="text-[13px] text-ink-500 dark:text-ink-400">
                {group.items.length} update{group.items.length === 1 ? '' : 's'} · {timeAgo(group.latest)}
              </div>
            </div>
            <Icon.chevronRight className="h-5 w-5 text-ink-400" />
          </button>
        ))
      )}

      <p className="px-4 py-6 text-center text-xs text-ink-400">
        Status updates are deleted automatically after 24 hours.
      </p>

      {composing ? (
        <StatusComposer
          me={meId}
          onClose={() => setComposing(false)}
          onCreated={() => {
            setComposing(false);
            load();
          }}
        />
      ) : null}

      {viewing ? (
        <StatusViewer
          group={viewing}
          meId={meId}
          onClose={() => {
            setViewing(null);
            load();
          }}
          onDeleted={() => load()}
        />
      ) : null}
    </div>
  );
}
