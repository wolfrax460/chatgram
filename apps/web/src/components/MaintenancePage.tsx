/**
 * The maintenance experience (Parts A, B, C of the maintenance-page brief).
 *
 * Rendered by App.tsx while `GET /api/app/features` reports `maintenanceMode`,
 * or locally at `?maintenance-preview=1` (no server flag involved) so admins can
 * review the page.
 *
 * Everything here uses existing endpoints only:
 *  - GET /api/status/health + GET /api/app/features: one poll every 10 s, backed
 *    off to 60 s; paused while `document.hidden`; immediate check on
 *    visibilitychange / online. The app counts as "back" only when the health
 *    check is ok AND maintenanceMode is off (health stays 200 during maintenance).
 *  - POST /api/auth/refresh: silently refreshed before the reload, never logging
 *    the user out.
 *  - No maintenance-updates endpoint exists, so the "Live updates" feed is built
 *    from real checks in this browser (never invented admin messages).
 *
 * The page never claims a message was sent, queued or pushed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, BellOff, Bug, CheckCircle2, ChevronDown, Clock,
  Download, ExternalLink, FileText, Globe, Home, LifeBuoy, Mail, Monitor, Moon,
  RefreshCw, ShieldCheck, Sparkles, Sun, WifiOff,
} from 'lucide-react';
import { useTheme } from '@chatgram/core';
import { LOCALE_LABELS, LOCALES, useI18n, type Locale } from '../lib/i18n';
import {
  AUTO_RELOAD_LIMIT_MS, BACK_BANNER_MS, POLL_MAX_MS, POLL_START_MS, RELOAD_JITTER_MS,
  checkAvailability, readNotifyPreference, readPreviewDraft, readSavedDraft, refreshSessionSilently,
  rememberReturnPath, reloadToRememberedPath, saveNotifyPreference, saveSavedDraft,
  notifyWhenBack, type Availability,
} from '../lib/maintenance';
import {
  MAINTENANCE_STRINGS, MAINTENANCE_SUPPORT_EMAIL, formatMaintenance, type MaintenanceStrings,
} from '../lib/maintenanceStrings';
import { notificationPermission, requestNotificationPermission } from '../lib/notify';

const SERVER_DEFAULT_MESSAGE = 'Chatgram is under maintenance. We will be back shortly.';

type PageState = 'checking' | 'down' | 'back' | 'tired' | 'preview';
type NotifyState = 'idle' | 'granted' | 'denied' | 'unsupported';
type UpdateEntry = { at: number; kind: 'opened' | 'down' | 'up' };

const ASSET_ICON = `${import.meta.env.BASE_URL}chatgram-icon.svg`;

function timeLabel(iso: number | string, locale: Locale, withSeconds = false): string {
  const date = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
    });
  } catch {
    return date.toISOString().slice(11, withSeconds ? 19 : 16);
  }
}

function initialNotifyState(): NotifyState {
  const permission = notificationPermission();
  if (permission === 'unsupported') return 'unsupported';
  if (permission === 'denied') return 'denied';
  if (permission === 'granted') return readNotifyPreference() ? 'granted' : 'idle';
  return 'idle';
}

export type MaintenancePageProps = {
  /** The admin's single custom message (PlatformSettings.maintenanceMessage). */
  maintenanceMessage?: string;
  /** Render locally for review; never enable, check, notify or reload. */
  preview?: boolean;
};

export default function MaintenancePage({ maintenanceMessage = '', preview = false }: MaintenancePageProps) {
  const { locale, setLocale } = useI18n();
  const strings = MAINTENANCE_STRINGS[locale];
  const stringsRef = useRef<MaintenanceStrings>(strings);
  stringsRef.current = strings;

  const themeMode = useTheme((state) => state.mode);
  const setThemeMode = useTheme((state) => state.setMode);

  const draft = useMemo(() => (preview ? readPreviewDraft() : null), [preview]);
  const [state, setState] = useState<PageState>(preview ? 'preview' : 'checking');
  const [lastCheck, setLastCheck] = useState<Availability | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [updates, setUpdates] = useState<UpdateEntry[]>(() =>
    preview ? [] : [{ at: Date.now(), kind: 'opened' }],
  );
  const [draftText, setDraftText] = useState(() => readSavedDraft());
  const [notifyState, setNotifyState] = useState<NotifyState>(() => initialNotifyState());
  const [now, setNow] = useState(() => Date.now());
  const [tipIndex, setTipIndex] = useState(0);
  const checkAgainRef = useRef<() => void>(() => undefined);

  /* Remember where the user was so we reload there after maintenance. */
  useEffect(() => {
    if (preview) return;
    rememberReturnPath(window.location.pathname + window.location.search + window.location.hash);
  }, [preview]);

  /* Page title (the app title is restored on unmount). */
  useEffect(() => {
    const previous = document.title;
    document.title = strings.pageTitle;
    return () => {
      document.title = previous;
    };
  }, [strings.pageTitle]);

  /* ------------------------------------------------------- health polling */
  useEffect(() => {
    if (preview) return undefined;
    let cancelled = false;
    let finished = false;
    let stopped = false;
    let timer: number | null = null;
    let failures = 0;
    let startedAt = Date.now();
    let hiddenAt: number | null = null;
    const extraTimers: number[] = [];

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const finish = () => {
      if (finished || cancelled) return;
      finished = true;
      clearTimer();
      setState('back');
      const copy = stringsRef.current;
      if (readNotifyPreference()) notifyWhenBack(copy.backHeadline, copy.backMessage);
      const bannerTimer = window.setTimeout(() => {
        void refreshSessionSilently().finally(() => {
          const jitter = Math.floor(Math.random() * RELOAD_JITTER_MS);
          const reloadTimer = window.setTimeout(() => {
            if (cancelled) return;
            try {
              reloadToRememberedPath();
            } catch {
              window.location.reload();
            }
          }, jitter);
          extraTimers.push(reloadTimer);
        });
      }, BACK_BANNER_MS);
      extraTimers.push(bannerTimer);
    };

    const schedule = () => {
      if (cancelled || finished || stopped) return;
      if (Date.now() - startedAt >= AUTO_RELOAD_LIMIT_MS) {
        stopped = true;
        clearTimer();
        setState('tired');
        return;
      }
      clearTimer();
      if (document.hidden) return;
      const delay = Math.min(POLL_MAX_MS, POLL_START_MS * 2 ** Math.min(Math.max(failures - 1, 0), 3));
      timer = window.setTimeout(() => void check(false), delay);
    };

    const check = async (manual: boolean) => {
      if (cancelled || finished) return;
      if (manual) setState('checking');
      const result = await checkAvailability();
      if (cancelled || finished) return;
      setLastCheck(result);
      setNow(Date.now());
      setUpdates((previous) =>
        [{ at: result.checkedAt, kind: result.up ? ('up' as const) : ('down' as const) }, ...previous].slice(0, 6),
      );
      if (result.up) {
        failures = 0;
        finish();
        return;
      }
      if (stopped) {
        setState('tired');
        return;
      }
      failures = manual ? 0 : failures + 1;
      setState('down');
      schedule();
    };

    checkAgainRef.current = () => {
      if (finished || cancelled) return;
      void check(true);
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (hiddenAt === null) hiddenAt = Date.now();
        clearTimer();
        return;
      }
      if (hiddenAt !== null) {
        startedAt += Date.now() - hiddenAt;
        hiddenAt = null;
      }
      if (!finished && !stopped) void check(false);
    };
    const onOnline = () => {
      if (document.hidden || finished || stopped) return;
      void check(false);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    void check(false);

    return () => {
      cancelled = true;
      checkAgainRef.current = () => undefined;
      clearTimer();
      for (const id of extraTimers) window.clearTimeout(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
    // The poll loop is intentionally created once: a language or theme change
    // must not restart the 30-minute window. Copy is read through stringsRef.
  }, [preview]);

  /* Clock + rotating tips. */
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const tips = window.setInterval(
      () => setTipIndex((index) => (index + 1) % MAINTENANCE_STRINGS[locale].tips.length),
      9_000,
    );
    return () => {
      window.clearInterval(clock);
      window.clearInterval(tips);
    };
  }, [locale]);

  /* ------------------------------------------------------------ derived */
  const customMessage = (maintenanceMessage || '').trim();
  const previewCustom = preview
    ? (draft?.messages[locale] || draft?.messages.en || '').trim()
    : '';
  const showCustom = preview ? Boolean(previewCustom) : Boolean(customMessage) && customMessage !== SERVER_DEFAULT_MESSAGE;

  const endAt = preview && draft?.endsAt ? new Date(draft.endsAt).getTime() : Number.NaN;
  const minutesLeft = Number.isFinite(endAt) ? Math.max(0, Math.ceil((endAt - now) / 60_000)) : null;
  const countdown = preview && draft?.endsAt
    ? minutesLeft !== null && minutesLeft > 0
      ? formatMaintenance(strings.backIn, { minutes: minutesLeft })
      : strings.backAnyMoment
    : strings.backSoon;

  const statusText =
    state === 'preview'
      ? strings.statusPreview
      : state === 'back'
        ? strings.statusUp
        : state === 'tired'
          ? strings.statusTired
          : state === 'down'
            ? strings.statusDown
            : strings.statusChecking;

  const StatusIcon =
    state === 'back' ? CheckCircle2 : state === 'tired' ? Clock : state === 'preview' ? AlertTriangle : state === 'down' ? WifiOff : RefreshCw;
  const statusSpins = state === 'checking';

  const checking = state === 'checking';
  const checkDisabled = preview || checking || state === 'back';

  const reportBody = formatMaintenance(strings.reportProblemBody, {
    url: window.location.href,
    time: new Date().toISOString(),
  });
  const reportHref = `mailto:${MAINTENANCE_SUPPORT_EMAIL}?subject=${encodeURIComponent(
    strings.reportProblemSubject,
  )}&body=${encodeURIComponent(reportBody)}`;

  const onCheckAgain = useCallback(() => {
    if (preview) return;
    checkAgainRef.current();
  }, [preview]);

  const onDraftChange = useCallback((value: string) => {
    setDraftText(value);
    saveSavedDraft(value);
  }, []);

  async function enableNotifications() {
    if (preview) return;
    const permission = await requestNotificationPermission();
    if (permission === 'granted') {
      saveNotifyPreference(true);
      setNotifyState('granted');
      return;
    }
    if (permission === 'denied') setNotifyState('denied');
    else if (permission === 'unsupported') setNotifyState('unsupported');
  }

  const quickLinks = [
    { key: 'help', label: strings.linkHelp, href: '/#faq', Icon: LifeBuoy },
    { key: 'downloads', label: strings.linkDownloads, href: '/#download', Icon: Download },
    { key: 'privacy', label: strings.linkPrivacy, href: '/docs/#privacy', Icon: ShieldCheck },
    { key: 'contact', label: strings.linkContact, href: `mailto:${MAINTENANCE_SUPPORT_EMAIL}`, Icon: Mail },
    { key: 'landing', label: strings.linkLanding, href: '/', Icon: Home },
  ];

  return (
    <div className="h-full w-full overflow-x-hidden overflow-y-auto bg-ink-50 text-ink-800 dark:bg-ink-900 dark:text-ink-100">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 py-6 sm:px-6 sm:py-10">
        {preview ? (
          <div
            className="mb-5 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
            role="status"
            data-testid="maintenance-preview-banner"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <strong className="font-bold uppercase tracking-wide">{strings.previewBadge}</strong> — {strings.previewNote}
            </span>
          </div>
        ) : null}

        <header className="text-center">
          <span className="inline-flex items-center gap-2">
            <img
              src={ASSET_ICON}
              alt=""
              width={48}
              height={48}
              className="maintenance-logo h-12 w-12 rounded-2xl shadow-sm ring-1 ring-black/5"
            />
            <span className="text-lg font-bold tracking-tight">Chatgram</span>
          </span>
          <h1 className="mt-4 break-words text-balance text-2xl font-bold leading-tight sm:text-3xl">
            {strings.headline}
          </h1>
          <p className="mx-auto mt-2 max-w-md break-words text-sm leading-relaxed text-ink-600 dark:text-ink-300">
            {strings.message}
          </p>

          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mx-auto mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink-700 shadow-sm dark:border-white/10 dark:bg-white/[.04] dark:text-ink-200"
            data-testid="maintenance-status"
          >
            <StatusIcon
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 text-brand-600 motion-reduce:animate-none dark:text-brand-300 ${statusSpins ? 'animate-spin' : ''}`}
            />
            <span className="min-w-0 break-words">{statusText}</span>
          </p>

          <p className="mt-2 text-[12.5px] font-medium text-ink-600 dark:text-ink-300" data-testid="maintenance-countdown">
            {countdown}
          </p>

          {preview && draft?.phase ? (
            <p className="mt-1 text-[12px] text-ink-600 dark:text-ink-300">{formatMaintenance(strings.phaseLabel, { phase: draft.phase })}</p>
          ) : null}
          {preview && draft?.startsAt ? (
            <p className="mt-1 text-[12px] text-ink-600 dark:text-ink-300">
              {formatMaintenance(strings.startedAt, { time: timeLabel(draft.startsAt, locale) })}
            </p>
          ) : null}
          {preview && draft?.endsAt ? (
            <p className="mt-1 text-[12px] text-ink-600 dark:text-ink-300">
              {formatMaintenance(strings.endsAt, { time: timeLabel(draft.endsAt, locale) })}
            </p>
          ) : null}

          {showCustom ? (
            <div className="card mt-4 p-3 text-left">
              <p className="text-[11px] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                {strings.customMessageLabel}
              </p>
              <p className="mt-1 break-words text-[13px] leading-relaxed text-ink-700 dark:text-ink-200">
                {preview ? previewCustom : customMessage}
              </p>
            </div>
          ) : null}

          <div className="mt-4">
            <button
              type="button"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-[12.5px] font-semibold text-ink-700 shadow-sm transition hover:bg-ink-100 dark:border-white/10 dark:bg-white/[.04] dark:text-ink-200 dark:hover:bg-white/[.08]"
              aria-expanded={detailsOpen}
              aria-controls="maintenance-details"
              onClick={() => setDetailsOpen((open) => !open)}
              data-testid="maintenance-details-toggle"
            >
              {detailsOpen ? strings.detailsHide : strings.detailsShow}
              <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${detailsOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {detailsOpen ? (
            <div
              id="maintenance-details"
              className="card mt-2 p-4 text-left"
              data-testid="maintenance-details"
            >
              {preview ? (
                <p className="text-[12.5px] text-ink-600 dark:text-ink-300">{strings.previewCheckDisabled}</p>
              ) : lastCheck ? (
                <>
                  <dl className="grid grid-cols-1 gap-1.5 text-[12.5px] sm:grid-cols-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-ink-600 dark:text-ink-300">{strings.currentCheck}</dt>
                      <dd className="text-right font-semibold">{lastCheck.up ? strings.checkResultUp : strings.checkResultDown}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-ink-600 dark:text-ink-300">{strings.lastChecked}</dt>
                      <dd className="text-right font-semibold">{timeLabel(lastCheck.checkedAt, locale, true)}</dd>
                    </div>
                    {lastCheck.health ? (
                      <>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-ink-600 dark:text-ink-300">{strings.labelDatabase}</dt>
                          <dd className="text-right font-semibold">{lastCheck.health.database ?? strings.unknown}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-ink-600 dark:text-ink-300">{strings.labelSocket}</dt>
                          <dd className="text-right font-semibold">{lastCheck.health.socket ?? strings.unknown}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-ink-600 dark:text-ink-300">{strings.labelStorage}</dt>
                          <dd className="text-right font-semibold">{lastCheck.health.storage ?? strings.unknown}</dd>
                        </div>
                      </>
                    ) : (
                      <p className="text-ink-600 dark:text-ink-300 sm:col-span-2">{strings.healthUnavailable}</p>
                    )}
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-ink-600 dark:text-ink-300">{strings.labelMaintenanceFlag}</dt>
                      <dd className="text-right font-semibold">
                        {lastCheck.maintenanceMode === null ? strings.unknown : lastCheck.maintenanceMode ? strings.on : strings.off}
                      </dd>
                    </div>
                  </dl>
                  {lastCheck.error ? (
                    <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{lastCheck.error}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-[12.5px] text-ink-600 dark:text-ink-300">{strings.neverChecked}</p>
              )}
            </div>
          ) : null}
        </header>

        <main className="mt-6 flex-1 space-y-4" id="maintenance-main">
          {state === 'back' ? (
            <section
              className="card border-brand-600/40 bg-brand-50 p-4 text-center dark:border-brand-400/30 dark:bg-brand-600/10"
              aria-live="assertive"
              data-testid="maintenance-back"
            >
              <CheckCircle2 className="mx-auto h-8 w-8 text-brand-700 dark:text-brand-300" aria-hidden="true" />
              <h2 className="mt-2 text-lg font-bold">{strings.backHeadline}</h2>
              <p className="mt-1 text-sm text-ink-700 dark:text-ink-200">{strings.backMessage}</p>
              <p className="mt-1 text-[12px] font-semibold text-brand-700 dark:text-brand-300">{strings.reloadPending}</p>
            </section>
          ) : null}

          {state === 'tired' ? (
            <section
              className="card p-4"
              data-testid="maintenance-tired"
            >
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="font-bold">{strings.tiredHeadline}</h2>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">{strings.tiredMessage}</p>
                </div>
              </div>
              <button type="button" className="btn-primary mt-3 min-h-[44px] w-full" onClick={onCheckAgain} disabled={checking}>
                <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
                {checking ? strings.checking : strings.checkAgain}
              </button>
            </section>
          ) : null}

          {/* Live check log (real checks only; there is no admin update feed yet). */}
          <section className="card p-4" aria-labelledby="maintenance-updates-title">
            <h2 id="maintenance-updates-title" className="flex items-center gap-2 text-sm font-bold">
              <Activity className="h-4 w-4 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              {strings.updatesTitle}
            </h2>
            {updates.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-ink-600 dark:text-ink-300">{strings.updatesEmpty}</p>
            ) : (
              <ul className="mt-2 space-y-2" aria-live="off">
                {updates.map((entry) => (
                  <li key={`${entry.at}-${entry.kind}`} className="flex gap-2 text-[12.5px] leading-snug">
                    <span className="w-16 shrink-0 font-mono text-[11px] text-ink-600 dark:text-ink-300">
                      {timeLabel(entry.at, locale)}
                    </span>
                    <span className="min-w-0 break-words text-ink-700 dark:text-ink-200">
                      {entry.kind === 'opened'
                        ? strings.updateOpened
                        : entry.kind === 'up'
                          ? strings.updateCheckUp
                          : strings.updateCheckDown}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11.5px] leading-snug text-ink-600 dark:text-ink-300">{strings.updatesNote}</p>
          </section>

          {/* Quick links to pages that stay online while the API is down. */}
          <section className="card p-4" aria-labelledby="maintenance-links-title">
            <h2 id="maintenance-links-title" className="text-sm font-bold">{strings.quickLinksTitle}</h2>
            <ul className="mt-2 grid grid-cols-2 gap-2">
              {quickLinks.map(({ key, label, href, Icon }) => (
                <li key={key} className="min-w-0">
                  <a
                    href={href}
                    className="flex min-h-[44px] items-center gap-2 rounded-xl border border-ink-200 px-3 py-2 text-[12.5px] font-semibold text-ink-700 transition hover:bg-ink-100 dark:border-white/10 dark:text-ink-200 dark:hover:bg-white/[.06]"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                    <span className="min-w-0 break-words">{label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {/* Notify me when it's back: permission is requested on click only. */}
          <section className="card p-4" aria-labelledby="maintenance-notify-title">
            <h2 id="maintenance-notify-title" className="flex items-center gap-2 text-sm font-bold">
              <Bell className="h-4 w-4 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              {strings.notifyTitle}
            </h2>
            {notifyState === 'granted' ? (
              <p className="mt-2 flex items-start gap-2 text-[12.5px] text-ink-700 dark:text-ink-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                {strings.notifyOn}
              </p>
            ) : notifyState === 'denied' || notifyState === 'unsupported' ? (
              <p className="mt-2 flex items-start gap-2 text-[12.5px] text-ink-700 dark:text-ink-200">
                <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-ink-500 dark:text-ink-300" aria-hidden="true" />
                {notifyState === 'denied' ? strings.notifyDenied : strings.notifyUnsupported}
              </p>
            ) : (
              <button
                type="button"
                className="btn-primary mt-2 min-h-[44px] w-full"
                onClick={() => void enableNotifications()}
                disabled={preview}
                title={preview ? strings.previewCheckDisabled : undefined}
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {strings.notifyButton}
              </button>
            )}
            <p className="mt-2 text-[11.5px] leading-snug text-ink-600 dark:text-ink-300">{strings.notifyNote}</p>
          </section>

          {/* Local-only draft: never sent or queued. */}
          <section className="card p-4" aria-labelledby="maintenance-draft-title">
            <h2 id="maintenance-draft-title" className="flex items-center gap-2 text-sm font-bold">
              <FileText className="h-4 w-4 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              {strings.draftTitle}
            </h2>
            <label className="sr-only" htmlFor="maintenance-draft">{strings.draftTitle}</label>
            <textarea
              id="maintenance-draft"
              className="field mt-2 min-h-[88px] resize-y"
              value={draftText}
              maxLength={2000}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={strings.draftPlaceholder}
              aria-describedby="maintenance-draft-note"
              data-testid="maintenance-draft"
            />
            <p className="mt-2 flex items-start gap-1.5 text-[12px] font-semibold text-brand-700 dark:text-brand-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {strings.draftSaved}
            </p>
            <p id="maintenance-draft-note" className="mt-1 text-[11.5px] leading-snug text-ink-600 dark:text-ink-300">
              {strings.draftNote}
            </p>
          </section>

          {/* Rotating "Did you know?" tips about features that really exist. */}
          <section className="card p-4" aria-labelledby="maintenance-tips-title">
            <h2 id="maintenance-tips-title" className="flex items-center gap-2 text-sm font-bold">
              <Sparkles className="h-4 w-4 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              {strings.tipsTitle}
            </h2>
            <p className="mt-2 min-h-[3.5rem] break-words text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-200">
              {strings.tips[tipIndex]}
            </p>
            <div className="mt-1 flex gap-1.5" aria-hidden="true">
              {strings.tips.map((_, index) => (
                <span
                  key={index}
                  className={`h-1.5 rounded-full transition-all motion-reduce:transition-none ${index === tipIndex ? 'w-5 bg-brand-600 dark:bg-brand-300' : 'w-1.5 bg-ink-200 dark:bg-white/20'}`}
                />
              ))}
            </div>
          </section>

          {/* Theme is remembered locally by the existing store. */}
          <section className="card p-4" aria-labelledby="maintenance-prefs-title">
            <h2 id="maintenance-prefs-title" className="text-sm font-bold">{strings.preferencesTitle}</h2>

            <p className="mt-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-600 dark:text-ink-300">
              {themeMode === 'dark' ? <Moon className="h-3.5 w-3.5" aria-hidden="true" /> : themeMode === 'light' ? <Sun className="h-3.5 w-3.5" aria-hidden="true" /> : <Monitor className="h-3.5 w-3.5" aria-hidden="true" />}
              {strings.themeLabel}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={strings.themeLabel}>
              {([
                { key: 'system', label: strings.themeSystem, Icon: Monitor },
                { key: 'light', label: strings.themeLight, Icon: Sun },
                { key: 'dark', label: strings.themeDark, Icon: Moon },
              ] as const).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setThemeMode(key)}
                  aria-pressed={themeMode === key}
                  className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition ${
                    themeMode === key
                      ? 'border-brand-600 bg-brand-600/10 text-brand-800 dark:border-brand-300 dark:bg-brand-300/10 dark:text-brand-200'
                      : 'border-ink-200 text-ink-700 hover:bg-ink-100 dark:border-white/10 dark:text-ink-200 dark:hover:bg-white/[.06]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </section>
        </main>

        <footer className="mt-6 border-t border-ink-200 pt-4 dark:border-white/10">
          <button
            type="button"
            className="btn-primary min-h-[44px] w-full"
            onClick={onCheckAgain}
            disabled={checkDisabled}
            data-testid="maintenance-check-again"
          >
            <RefreshCw className={`h-4 w-4 ${statusSpins ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
            {checking ? strings.checking : strings.checkAgain}
          </button>

          {/* Language switcher (EN/RW/FR/SW) — copy is marked for native review. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label={strings.languageLabel}>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-ink-600 dark:text-ink-300">
              <Globe className="h-3.5 w-3.5" aria-hidden="true" /> {strings.languageLabel}
            </span>
            {LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLocale(code)}
                aria-pressed={locale === code}
                className={`min-h-[36px] rounded-lg border px-2 py-1 text-[11.5px] font-semibold transition ${
                  locale === code
                    ? 'border-brand-600 bg-brand-600/10 text-brand-800 dark:border-brand-300 dark:bg-brand-300/10 dark:text-brand-200'
                    : 'border-ink-200 text-ink-700 hover:bg-ink-100 dark:border-white/10 dark:text-ink-200 dark:hover:bg-white/[.06]'
                }`}
              >
                {code.toUpperCase()} · {LOCALE_LABELS[code]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-center text-[11px] leading-snug text-ink-600 dark:text-ink-300">{strings.nativeReview}</p>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px] font-semibold">
            <a className="inline-flex min-h-[36px] items-center gap-1.5 text-ink-700 underline-offset-2 hover:underline dark:text-ink-200" href={`mailto:${MAINTENANCE_SUPPORT_EMAIL}`}>
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              {MAINTENANCE_SUPPORT_EMAIL}
            </a>
            <a className="inline-flex min-h-[36px] items-center gap-1.5 text-ink-700 underline-offset-2 hover:underline dark:text-ink-200" href={reportHref}>
              <Bug className="h-3.5 w-3.5" aria-hidden="true" />
              {strings.reportProblem}
            </a>
            <a className="inline-flex min-h-[36px] items-center gap-1.5 text-ink-700 underline-offset-2 hover:underline dark:text-ink-200" href="/docs/#terms">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Terms
            </a>
          </div>

          <p className="mt-3 text-center text-[11.5px] leading-snug text-ink-600 dark:text-ink-300">{strings.footerNote}</p>
        </footer>
      </div>
    </div>
  );
}
