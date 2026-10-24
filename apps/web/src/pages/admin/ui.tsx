import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Search, X } from 'lucide-react';

/* ------------------------------------------------------------------ select */

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * One shared dark dropdown for the whole dashboard (Change 3): no native
 * select popups, full keyboard support (arrows, Enter, Escape, type-ahead),
 * listbox semantics, scrolls, closes on outside click, works on touch.
 */
export function Select({
  value,
  options,
  onChange,
  label,
  className,
  placeholder = 'Select…',
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    const matches = options.filter((option) => option.label.toLowerCase().includes(needle));
    return matches.length ? matches : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, filtered.findIndex((option) => option.value === value));
    setActive(index);
    setQuery('');
  }, [open, value, filtered]);

  function choose(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + delta + filtered.length) % Math.max(1, filtered.length));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) setOpen(true);
      else if (filtered[active]) choose(filtered[active]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (!open && event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      setOpen(true);
      setQuery(event.key);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className || ''}`}>
      <button
        type="button"
        className="admin-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
      </button>
      {open ? (
        <div className="admin-select-list" role="listbox" id={listId} aria-label={label}>
          <div className="sticky top-0 bg-[var(--ad-raised)] px-1 pb-1">
            <input
              autoFocus
              className="admin-input !py-1.5 !text-[12px]"
              placeholder="Type to filter…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const delta = event.key === 'ArrowDown' ? 1 : -1;
                  setActive((current) => (current + delta + filtered.length) % Math.max(1, filtered.length));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  if (filtered[active]) choose(filtered[active]);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
            />
          </div>
          {filtered.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-active={index === active}
              className="admin-select-option"
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.hint ? <span className="text-[10.5px] text-[var(--ad-faint)]">{option.hint}</span> : null}
              {option.value === value ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
          {filtered.length === 0 ? <p className="px-2 py-2 text-[12px] text-[var(--ad-muted)]">No matches.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- sparkline */

export function Sparkline({
  values,
  width = 132,
  height = 36,
  accent = 'var(--ad-accent)',
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  accent?: string;
  label: string;
}) {
  const points = values.length >= 2 ? values : [0, 0];
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const path = points
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${(height - ((value - min) / span) * (height - 4) - 2).toFixed(1)}`)
    .join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  const id = useId().replace(/[:]/g, '');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path d={path} fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------------- bar chart */

export function BarChart({ points, label }: { points: { day: string; count: number }[]; label: string }) {
  const max = Math.max(...points.map((point) => point.count), 1);
  return (
    <div>
      <div className="flex h-32 items-end gap-1.5" role="img" aria-label={label}>
        {points.map((point) => (
          <div key={point.day} className="group relative flex h-full flex-1 items-end" title={`${point.day}: ${point.count}`}>
            <div
              className="w-full rounded-t-[3px] transition-[filter] group-hover:brightness-125"
              style={{
                height: `${point.count === 0 ? 2 : Math.max(4, (point.count / max) * 118)}px`,
                background:
                  point.count === 0
                    ? 'var(--ad-border-strong)'
                    : 'linear-gradient(180deg, var(--ad-accent), rgba(45,226,166,0.25))',
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-[var(--ad-faint)]">
        <span>{points[0]?.day?.slice(5)}</span>
        <span>{points[points.length - 1]?.day?.slice(5)}</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- pieces */

export function Chip({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
}) {
  return <span className={`admin-chip admin-chip-${tone === 'default' ? '' : tone}`.trim()}>{children}</span>;
}

export function StatCard({
  label,
  value,
  hint,
  trend,
  values,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: number;
  values?: number[];
  tone?: 'default' | 'warning' | 'danger';
}) {
  const trendColor = trend === undefined ? '' : trend > 0 ? 'text-[var(--ad-success)]' : trend < 0 ? 'text-[var(--ad-danger)]' : 'text-[var(--ad-muted)]';
  return (
    <div className="admin-card admin-card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="admin-kpi-label">{label}</p>
          <p className={`admin-kpi-value mt-1 ${tone === 'danger' ? 'text-[var(--ad-danger)]' : tone === 'warning' ? 'text-[var(--ad-warning)]' : ''}`}>{value}</p>
          <p className="mt-1 flex items-center gap-2 text-[11px] text-[var(--ad-muted)]">
            {trend !== undefined ? <span className={trendColor}>{trend > 0 ? `+${trend}` : trend} vs yesterday</span> : null}
            {hint ? <span>{hint}</span> : null}
          </p>
        </div>
        {values ? <Sparkline values={values} label={`${label} trend`} /> : null}
      </div>
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className="admin-skeleton h-4" style={{ width: `${90 - index * 12}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, icon }: { title: string; body: string; icon?: React.ReactNode }) {
  return (
    <div className="admin-empty">
      {icon ?? <Search className="h-6 w-6" />}
      <p className="font-semibold text-[var(--ad-text)]">{title}</p>
      <p className="max-w-sm">{body}</p>
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="admin-drawer-backdrop" onClick={onClose} />
      <aside className="admin-drawer" role="dialog" aria-label={title} aria-modal="true">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold">{title}</h2>
          <button type="button" className="admin-btn admin-btn-sm" onClick={onClose} aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="admin-card w-full max-w-md p-5">
        <div className="flex items-start gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${danger ? 'bg-[var(--ad-danger)]/15 text-[var(--ad-danger)]' : 'bg-[var(--ad-accent-soft)] text-[var(--ad-accent)]'}`}>
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-bold">{title}</h2>
            <p className="mt-1 text-[12.5px] text-[var(--ad-muted)]">{body}</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="admin-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`admin-btn ${danger ? 'admin-btn-danger' : 'admin-btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useToast(): { message: string | null; show: (message: string) => void } {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 3800);
  }, []);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  return { message, show };
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="admin-toast" role="status">
      {message}
    </div>
  );
}

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="admin-page-head">
      <div>
        <h1 className="admin-page-title">{title}</h1>
        {subtitle ? <p className="admin-page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
