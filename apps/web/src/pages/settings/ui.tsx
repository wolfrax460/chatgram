/**
 * Shared primitives for the WhatsApp-style Settings screen.
 *
 * One row component, one spacing scale, one focus ring — every page under
 * `pages/settings/` renders rows through these so the list and the sub-pages
 * cannot drift apart again (the old screen had three different row paddings and
 * a "Manage" button that sat on the wrong baseline).
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Loader2, type LucideIcon } from 'lucide-react';

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-ink-900';

/* ------------------------------------------------------------------ layout */

/** A sub-page: header (back button on phones) + a max-width column. */
export function SettingsPage({
  title,
  description,
  onBack,
  actions,
  children,
  testId,
}: {
  title: string;
  description?: string;
  /** Renders the mobile back button. Desktop shows the list next to the page. */
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="min-h-full pb-10" data-testid={testId}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-ink-200 bg-white/95 px-2 py-2 backdrop-blur dark:border-white/10 dark:bg-ink-900/95 lg:px-4">
        <button
          type="button"
          onClick={onBack}
          className={`btn-ghost !px-2 lg:hidden ${focusRing}`}
          aria-label="Back to settings"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate px-1 text-[17px] font-bold">{title}</h2>
          {description ? (
            <p className="hidden truncate px-1 text-[12px] text-ink-500 dark:text-ink-400 lg:block">
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      <div className="mx-auto w-full max-w-[720px] px-3 py-3 lg:px-4">{children}</div>
    </div>
  );
}

/** One labelled group of rows (card on phones, same on desktop). */
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="mt-4 first:mt-1" aria-labelledby={title ? id : undefined}>
      {title ? (
        <h3
          id={id}
          className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300"
        >
          {title}
        </h3>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white dark:border-white/10 dark:bg-white/[.03]">
        {children}
      </div>
      {description ? (
        <p className="mt-1.5 px-1 text-[11.5px] leading-snug text-ink-500 dark:text-ink-400">{description}</p>
      ) : null}
    </section>
  );
}

/** Divider between rows inside a group. */
export function RowDivider() {
  return <div className="ml-[60px] h-px bg-ink-100 dark:bg-white/[.06]" aria-hidden="true" />;
}

/* -------------------------------------------------------------------- rows */

export interface SettingsRowProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** Current value shown at the end of the subtitle line. */
  value?: string;
  onClick?: () => void;
  /** Disabled rows are announcement-only ("coming soon"): real, but not fake. */
  disabled?: boolean;
  testId?: string;
  destructive?: boolean;
  trailing?: ReactNode;
  /** Small pill after the title, e.g. "Coming soon". */
  badge?: string;
}

function RowShell({ icon: Icon, title, subtitle, value, disabled, destructive, trailing, badge, onClick }: SettingsRowProps) {
  const content = (
    <>
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
          destructive
            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
            : 'bg-brand-600/10 text-brand-600 dark:text-brand-300'
        }`}
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className={`truncate font-semibold ${destructive ? 'text-rose-600 dark:text-rose-300' : ''}`}>
            {title}
          </span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-ink-200/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-600 dark:bg-white/10 dark:text-ink-300">
              {badge}
            </span>
          ) : null}
        </span>
        {subtitle || value ? (
          <span className="mt-0.5 flex items-baseline gap-2">
            {subtitle ? (
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-500 dark:text-ink-400">{subtitle}</span>
            ) : null}
            {value ? (
              <span className="shrink-0 text-[12px] font-medium text-ink-500 dark:text-ink-400">{value}</span>
            ) : null}
          </span>
        ) : null}
      </span>
      {trailing ??
        (onClick && !disabled ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
        ) : null)}
    </>
  );

  if (!onClick || disabled) {
    return (
      <div
        className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 ${
          disabled ? 'opacity-70' : ''
        }`}
        aria-disabled={disabled || undefined}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-ink-100/70 dark:hover:bg-white/[.04] ${focusRing}`}
    >
      {content}
    </button>
  );
}

export function SettingsRow(props: SettingsRowProps) {
  return (
    <div data-testid={props.testId}>
      <RowShell {...props} />
    </div>
  );
}

/** A row with a switch. The whole row is the switch target. */
export function SettingsToggle({
  icon,
  title,
  subtitle,
  checked,
  onChange,
  disabled,
  testId,
  badge,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testId?: string;
  badge?: string;
}) {
  const Icon = icon;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-ink-100/70 disabled:pointer-events-none disabled:opacity-60 dark:hover:bg-white/[.04] ${focusRing}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300" aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{title}</span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-ink-200/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-600 dark:bg-white/10 dark:text-ink-300">
              {badge}
            </span>
          ) : null}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-[13px] text-ink-500 dark:text-ink-400">{subtitle}</span>
        ) : null}
      </span>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-brand-600' : 'bg-ink-300 dark:bg-white/15'
        }`}
        aria-hidden="true"
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

/** A labelled radio/segmented choice rendered inside a group. */
export function SettingsChoice({
  title,
  subtitle,
  ariaLabel,
  value,
  onChange,
  options,
  testId,
}: {
  title?: string;
  subtitle?: string;
  ariaLabel: string;
  value: string;
  onChange: (key: string) => void;
  options: { key: string; label: string; icon?: LucideIcon }[];
  testId?: string;
}) {
  return (
    <div className="px-4 py-3" role="group" aria-label={ariaLabel} data-testid={testId}>
      {title ? <p className="text-[13.5px] font-semibold">{title}</p> : null}
      {subtitle ? <p className="mt-0.5 text-[12px] text-ink-500 dark:text-ink-400">{subtitle}</p> : null}
      <div className="mt-2 flex gap-2">
        {options.map((option) => {
          const Icon = option.icon;
          const selected = value === option.key;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-[13px] font-semibold transition ${focusRing} ${
                selected
                  ? 'border-brand-600 bg-brand-600/10 text-brand-700 dark:text-brand-300'
                  : 'border-ink-200 text-ink-600 hover:bg-ink-100/70 dark:border-white/10 dark:text-ink-300 dark:hover:bg-white/5'
              }`}
            >
              {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A link row (external navigation). */
export function SettingsLinkRow({
  icon,
  title,
  subtitle,
  href,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  href: string;
  testId?: string;
}) {
  const Icon = icon;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      data-testid={testId}
      className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-ink-100/70 dark:hover:bg-white/[.04] ${focusRing}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300" aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {subtitle ? <span className="block truncate text-[13px] text-ink-500 dark:text-ink-400">{subtitle}</span> : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
    </a>
  );
}

/* ------------------------------------------------------------------ fields */

export function SettingsField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="px-4 py-2.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11.5px] leading-snug text-ink-500 dark:text-ink-400">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- dialogs */

export function SettingsDialog({
  title,
  description,
  onClose,
  children,
  footer,
  testId,
  destructive,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  testId?: string;
  destructive?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    const first = panelRef.current?.querySelector<HTMLElement>('input, textarea, button');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        className={`w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800 ${
          destructive ? 'ring-1 ring-rose-500/40' : ''
        }`}
      >
        <h3 id={titleId} className={`text-lg font-bold ${destructive ? 'text-rose-600 dark:text-rose-300' : ''}`}>
          {title}
        </h3>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">{description}</p>
        ) : null}
        {children ? <div className="mt-3">{children}</div> : null}
        {footer ? <div className="mt-4 flex gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ status */

export function SettingsNotice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'success' | 'error' | 'warning';
}) {
  const tones: Record<string, string> = {
    info: 'border-ink-200 bg-ink-50 text-ink-700 dark:border-white/10 dark:bg-white/5 dark:text-ink-200',
    success:
      'border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    error:
      'border-rose-300/60 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
    warning:
      'border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200',
  };
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-3 py-2 text-[12.5px] leading-relaxed ${tones[tone]}`}
      {...(tone !== 'error' ? { 'aria-live': 'polite' as const } : {})}
    >
      {children}
    </p>
  );
}

export function SettingsSpinner({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-ink-500 dark:text-ink-400">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {label}
    </p>
  );
}

/** Inline "coming soon" explanation so disabled rows are honest, never fake. */
export function SettingsCross({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 pt-1.5 text-[11.5px] leading-snug text-ink-500 dark:text-ink-400">{children}</p>
  );
}

/** Copy-to-clipboard button used by Invite / Profile share rows. */
export function useCopyToClipboard(): {
  copied: string | null;
  copy: (value: string, key?: string) => Promise<void>;
} {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const copy = useCallback(async (value: string, key = 'default') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }, []);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return { copied, copy };
}
