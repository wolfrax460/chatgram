import { useCallback, useEffect, useState } from 'react';
import { Film, Image as ImageIcon, Music, Search, Trash2 } from 'lucide-react';
import { adminFetch, formatBytes, formatNumber, relativeTime, type AdminSessionInfo } from './api';
import { Chip, ConfirmDialog, Drawer, EmptyState, PageHead, Select, Skeleton, Toast, useToast } from './ui';

type StatusRow = {
  id: string;
  owner: { id: string; displayName: string; email: string; status: string } | null;
  text: string;
  mediaType: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  mediaBytes: number;
  createdAt: string;
  reports: number;
};
type StatusList = { statuses: StatusRow[]; total: number; page: number; pageCount: number };
type MediaRow = {
  source: 'message' | 'status';
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string | null;
  bytes: number;
  caption: string;
  createdAt: string;
  owner: { id: string; displayName: string; email: string } | null;
};
type MediaList = { media: MediaRow[]; total: number; page: number; pageCount: number; statusBytes: number };
type Storage = {
  statuses: { bytes: number; mediaCount: number };
  messages: { mediaCount: number };
  note: string;
  topUsers: { owner: { id: string; displayName: string; email: string } | null; statusBytes: number; statusCount: number; messageCount: number }[];
};

const TYPE_OPTIONS = [
  { value: '', label: 'All media types' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'file', label: 'Files' },
];

function typeIcon(type: string) {
  if (type === 'video') return <Film className="h-3.5 w-3.5" />;
  if (type === 'audio') return <Music className="h-3.5 w-3.5" />;
  return <ImageIcon className="h-3.5 w-3.5" />;
}

function Preview({ row }: { row: { mediaType?: string | null; type?: string; mediaUrl?: string | null; url?: string; thumbnailUrl?: string | null; text?: string | null; caption?: string | null } }) {
  const type = row.mediaType || row.type || 'text';
  const url = row.mediaUrl || row.url;
  const caption = row.text || row.caption || '';
  if (!url) {
    return <p className="whitespace-pre-wrap rounded-xl bg-[var(--ad-sunken)] p-3 text-[13px]">{caption || 'No text'}</p>;
  }
  if (type === 'video') return <video src={url} poster={row.thumbnailUrl || undefined} controls className="max-h-[320px] w-full rounded-xl bg-black" />;
  if (type === 'audio') return <audio src={url} controls className="w-full" />;
  if (type === 'image') return <img src={url} alt={caption || 'Status media'} className="max-h-[320px] w-full rounded-xl object-contain" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block rounded-xl bg-[var(--ad-sunken)] p-3 text-[12.5px] underline">
      {url}
    </a>
  );
}

/** Statuses & media: recent statuses, the media library and audited removals. */
export default function StatusesMediaPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [tab, setTab] = useState<'statuses' | 'media'>('statuses');
  const [statuses, setStatuses] = useState<StatusList | null>(null);
  const [media, setMedia] = useState<MediaList | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [selectedStatus, setSelectedStatus] = useState<StatusRow | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<MediaRow | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<'status' | 'media' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [statusPayload, mediaPayload, storagePayload] = await Promise.all([
        adminFetch<StatusList>(`/api/admin/statuses?mediaType=${type === 'file' ? '' : type}&page=${page}&limit=20`),
        adminFetch<MediaList>(`/api/admin/media?type=${type}&page=${page}&limit=20`),
        adminFetch<Storage>('/api/admin/media/storage'),
      ]);
      setStatuses(statusPayload);
      setMedia(mediaPayload);
      setStorage(storagePayload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the statuses and media.');
    }
  }, [page, type]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeStatus() {
    if (!selectedStatus) return;
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch<{ message: string }>(`/api/admin/statuses/${selectedStatus.id}`, {
        method: 'DELETE',
        csrf: session.csrfToken,
      });
      toast.show(result.message);
      setSelectedStatus(null);
      setConfirmRemove(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not remove the status.');
    } finally {
      setBusy(false);
    }
  }

  async function removeMedia() {
    if (!selectedMedia) return;
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch<{ message: string }>('/api/admin/media/remove', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { source: selectedMedia.source, id: selectedMedia.id },
      });
      toast.show(result.message);
      setSelectedMedia(null);
      setConfirmRemove(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not remove the media.');
    } finally {
      setBusy(false);
    }
  }

  const rows = tab === 'statuses' ? statuses?.statuses ?? [] : media?.media ?? [];
  const filtered = rows.filter((row) => !search || JSON.stringify(row).toLowerCase().includes(search.toLowerCase()));
  const pageCount = tab === 'statuses' ? statuses?.pageCount ?? 1 : media?.pageCount ?? 1;

  return (
    <div>
      <PageHead
        title="Statuses & media"
        subtitle={storage ? `${storage.statuses.mediaCount} status media (${formatBytes(storage.statuses.bytes)}) · ${formatNumber(storage.messages.mediaCount)} message attachments` : 'Recent statuses, uploaded media and removals'}
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-grid sm:grid-cols-3">
        <div className="admin-card admin-card-pad">
          <p className="admin-kpi-label">Status media</p>
          <p className="admin-kpi-value mt-1">{formatBytes(storage?.statuses.bytes ?? 0)}</p>
          <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">{storage?.statuses.mediaCount ?? 0} files</p>
        </div>
        <div className="admin-card admin-card-pad">
          <p className="admin-kpi-label">Message attachments</p>
          <p className="admin-kpi-value mt-1">{formatNumber(storage?.messages.mediaCount ?? 0)}</p>
          <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">attachments still stored</p>
        </div>
        <div className="admin-card admin-card-pad">
          <p className="admin-kpi-label">Storage note</p>
          <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">{storage?.note || 'Loading…'}</p>
        </div>
      </div>

      <div className="admin-card mt-3">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ad-border)] p-3">
          {(['statuses', 'media'] as const).map((key) => (
            <button key={key} type="button" className={`admin-btn admin-btn-sm ${tab === key ? 'admin-btn-primary' : ''}`} onClick={() => { setTab(key); setPage(1); setSearch(''); }}>
              {key === 'statuses' ? 'Recent statuses' : 'Media library'}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="w-40"><Select label="Media type filter" value={type} options={TYPE_OPTIONS} onChange={(value) => { setType(value); setPage(1); }} /></div>
            <div className="relative min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ad-faint)]" />
              <input className="admin-input admin-input-with-icon" placeholder="Filter this page" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Filter statuses or media" />
            </div>
          </div>
        </div>

        <div className="admin-scroll max-h-[56vh] overflow-y-auto">
          {!statuses || !media ? (
            <div className="p-4"><Skeleton lines={5} /></div>
          ) : filtered.length === 0 ? (
            <div className="p-3"><EmptyState title="Nothing here" body="Statuses and uploaded media appear here with their owner and size." /></div>
          ) : tab === 'statuses' ? (
            <table className="admin-table">
              <thead><tr><th>Owner</th><th>Status</th><th>Type</th><th>Size</th><th>Posted</th><th>Reports</th></tr></thead>
              <tbody>
                {(filtered as StatusRow[]).map((row) => (
                  <tr key={row.id} onClick={() => setSelectedStatus(row)}>
                    <td className="text-[12px]">{row.owner?.displayName || 'unknown'}<p className="text-[10.5px] text-[var(--ad-faint)]">{row.owner?.email || ''}</p></td>
                    <td className="max-w-[340px]"><p className="truncate text-[12.5px]">{row.text || (row.mediaUrl ? 'Media status' : 'Empty status')}</p></td>
                    <td><Chip>{row.mediaType}</Chip></td>
                    <td className="tabular-nums text-[12px]">{row.mediaBytes ? formatBytes(row.mediaBytes) : '—'}</td>
                    <td className="whitespace-nowrap text-[11.5px] text-[var(--ad-muted)]">{relativeTime(row.createdAt)}</td>
                    <td>{row.reports > 0 ? <Chip tone="danger">{row.reports}</Chip> : <span className="text-[11.5px] text-[var(--ad-faint)]">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="admin-table">
              <thead><tr><th>Media</th><th>Source</th><th>Owner</th><th>Stored</th></tr></thead>
              <tbody>
                {(filtered as MediaRow[]).map((row) => (
                  <tr key={`${row.source}-${row.id}`} onClick={() => setSelectedMedia(row)}>
                    <td>
                      <p className="flex items-center gap-2 text-[12.5px] font-medium">{typeIcon(row.type)} {row.type}</p>
                      <p className="mt-0.5 max-w-[320px] truncate text-[11px] text-[var(--ad-faint)]">{row.caption || row.url}</p>
                    </td>
                    <td><Chip tone={row.source === 'status' ? 'accent' : 'default'}>{row.source}</Chip></td>
                    <td className="text-[12px]">{row.owner?.displayName || 'unknown'}</td>
                    <td className="whitespace-nowrap text-[11.5px] text-[var(--ad-muted)]">{row.bytes ? formatBytes(row.bytes) : '—'} · {relativeTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {pageCount > 1 ? (
          <div className="flex items-center justify-between border-t border-[var(--ad-border)] px-3 py-2">
            <p className="text-[11.5px] text-[var(--ad-muted)]">Page {page} of {pageCount}</p>
            <div className="flex gap-1.5">
              <button type="button" className="admin-btn admin-btn-sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
              <button type="button" className="admin-btn admin-btn-sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
            </div>
          </div>
        ) : null}
      </div>

      {selectedStatus ? (
        <Drawer title={`Status by ${selectedStatus.owner?.displayName || 'unknown'}`} onClose={() => setSelectedStatus(null)}>
          <Preview row={selectedStatus} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip>{selectedStatus.mediaType}</Chip>
            <Chip>{relativeTime(selectedStatus.createdAt)}</Chip>
            {selectedStatus.mediaBytes ? <Chip>{formatBytes(selectedStatus.mediaBytes)}</Chip> : null}
            {selectedStatus.reports > 0 ? <Chip tone="danger">{selectedStatus.reports} open report(s)</Chip> : null}
          </div>
          <p className="mt-2 break-all text-[11px] text-[var(--ad-faint)]">{selectedStatus.mediaUrl || 'text-only status'}</p>
          <button type="button" className="admin-btn admin-btn-danger mt-3" onClick={() => setConfirmRemove('status')} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5" /> Remove status
          </button>
        </Drawer>
      ) : null}

      {selectedMedia ? (
        <Drawer title={`${selectedMedia.type} from ${selectedMedia.owner?.displayName || 'unknown'}`} onClose={() => setSelectedMedia(null)}>
          <Preview row={selectedMedia} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip tone={selectedMedia.source === 'status' ? 'accent' : 'default'}>{selectedMedia.source}</Chip>
            <Chip>{relativeTime(selectedMedia.createdAt)}</Chip>
            {selectedMedia.bytes ? <Chip>{formatBytes(selectedMedia.bytes)}</Chip> : null}
          </div>
          <p className="mt-2 break-all text-[11px] text-[var(--ad-faint)]">{selectedMedia.url}</p>
          <button type="button" className="admin-btn admin-btn-danger mt-3" onClick={() => setConfirmRemove('media')} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5" /> {selectedMedia.source === 'status' ? 'Remove status' : 'Remove attachment (delete for everyone)'}
          </button>
        </Drawer>
      ) : null}

      {confirmRemove ? (
        <ConfirmDialog
          title={confirmRemove === 'status' ? 'Remove this status?' : 'Remove this attachment?'}
          body={
            confirmRemove === 'status'
              ? 'The status and its stored media are deleted for everyone. This is audited.'
              : 'The message is deleted for everyone (its text stays in the moderation log). This is audited.'
          }
          confirmLabel={confirmRemove === 'status' ? 'Remove status' : 'Remove attachment'}
          danger
          busy={busy}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => void (confirmRemove === 'status' ? removeStatus() : removeMedia())}
        />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
