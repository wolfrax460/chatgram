import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleDashed, FileVideo, Music, Plus, Image as ImageIcon } from 'lucide-react';
import { useSession, type StatusItem, type User } from '@chatgram/core';
import { api } from '../lib/api';
import { READ_ONLY_SEND_HINT } from '../lib/readOnly';
import { Avatar, timeAgo } from '../components/status/Parts';
import { StatusComposer } from '../components/status/StatusComposer';
import { StatusViewer, type StatusGroup } from '../components/status/StatusViewer';

/* --------------------------------------------------------------- helpers */

/** One bucket per author, newest bucket first. */
function groupByUser(statuses: StatusItem[]): StatusGroup[] {
  const map = new Map<string, StatusGroup>();
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

function mediaIcons(items: StatusItem[]) {
  const kinds = new Set(items.map((item) => item.mediaType ?? (item.mediaUrl ? 'image' : 'text')));
  return (
    <span className="flex items-center gap-1">
      {kinds.has('image') ? <ImageIcon className="h-3 w-3" aria-label="contains photos" /> : null}
      {kinds.has('video') ? <FileVideo className="h-3 w-3" aria-label="contains videos" /> : null}
      {kinds.has('audio') ? <Music className="h-3 w-3" aria-label="contains voice notes" /> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ page */

export default function Status({ readOnly = false }: { readOnly?: boolean }) {
  const me = useSession((s) => s.user);
  const [composing, setComposing] = useState(false);
  const [viewing, setViewing] = useState<StatusGroup | null>(null);

  const statuses = useQuery({ queryKey: ['statuses'], queryFn: () => api.statuses() });
  const meId = me?.id ?? '';

  const groups = useMemo(() => groupByUser(statuses.data ?? []), [statuses.data]);
  const mine = groups.find((group) => group.userId === meId);
  const others = groups.filter((group) => group.userId !== meId);

  const hasUnseen = (group: StatusGroup) =>
    group.items.some((status) => !status.viewedBy.some((viewer) => viewer.id === meId));

  return (
    <div className="mx-auto flex h-full w-full flex-col">
      <header className="flex items-center gap-2 border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <CircleDashed className="h-5 w-5 text-brand-600" />
        <h2 className="font-bold">Status</h2>
        <span className="flex-1" />
        <button
          type="button"
          className="btn-primary"
          onClick={() => setComposing(true)}
          disabled={readOnly}
          title={readOnly ? READ_ONLY_SEND_HINT : undefined}
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* my status */}
        <button
          type="button"
          onClick={() => {
            if (mine) setViewing(mine);
            else if (!readOnly) setComposing(true);
          }}
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
                : 'Tap to add a photo, video or voice note'}
            </p>
          </div>
          {mine ? <span className="text-ink-500 dark:text-ink-400">{mediaIcons(mine.items)}</span> : null}
        </button>

        <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
          Recent updates
        </p>

        {statuses.isLoading ? <p className="p-4 text-sm text-ink-500">Loading…</p> : null}
        {statuses.isError ? (
          <p className="p-4 text-sm text-rose-600 dark:text-rose-400">
            Could not load statuses. {statuses.error instanceof Error ? statuses.error.message : ''}
          </p>
        ) : null}

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
              <p className="flex items-center gap-1 text-xs text-ink-500 dark:text-ink-400">
                {mediaIcons(group.items)}
                {group.items.length} update{group.items.length === 1 ? '' : 's'} · {timeAgo(group.latest)}
              </p>
            </div>
          </button>
        ))}

        <p className="px-4 py-6 text-center text-xs text-ink-400">
          Statuses are deleted automatically after 24 hours, including the stored photo, video or audio file.
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
