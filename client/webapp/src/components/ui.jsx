import React from 'react';

/* ------------------------------------------------------------------ icons */
const S = ({ children, className = 'h-5 w-5', ...rest }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

export const Icon = {
  chat: (p) => (
    <S {...p}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-4.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
    </S>
  ),
  users: (p) => (
    <S {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.9M18 20a5.6 5.6 0 0 0-2-4.3" />
    </S>
  ),
  settings: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </S>
  ),
  send: (p) => (
    <S {...p}>
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
    </S>
  ),
  search: (p) => (
    <S {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </S>
  ),
  plus: (p) => (
    <S {...p}>
      <path d="M12 5v14M5 12h14" />
    </S>
  ),
  close: (p) => (
    <S {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </S>
  ),
  back: (p) => (
    <S {...p}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </S>
  ),
  check: (p) => (
    <S {...p}>
      <path d="m5 13 4 4L19 7" />
    </S>
  ),
  checkDouble: (p) => (
    <S {...p}>
      <path d="m2 13 4 4L16 7" />
      <path d="m11 15 2 2L23 7" />
    </S>
  ),
  logout: (p) => (
    <S {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </S>
  ),
  sun: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </S>
  ),
  moon: (p) => (
    <S {...p}>
      <path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.8 6.8 0 0 0 10.2 10.2Z" />
    </S>
  ),
  monitor: (p) => (
    <S {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </S>
  ),
  mic: (p) => (
    <S {...p}>
      <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
    </S>
  ),
  image: (p) => (
    <S {...p}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4 18 5.5-5.5 4 4L17 13l4 4" />
    </S>
  ),
  attach: (p) => (
    <S {...p}>
      <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l8.49-8.48a3.7 3.7 0 1 1 5.23 5.23l-8.49 8.49a1.85 1.85 0 1 1-2.62-2.62l7.78-7.78" />
    </S>
  ),
  info: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </S>
  ),
  refresh: (p) => (
    <S {...p}>
      <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
    </S>
  ),
  lock: (p) => (
    <S {...p}>
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </S>
  ),
  user: (p) => (
    <S {...p}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </S>
  ),
};

/* ----------------------------------------------------------------- avatar */
const PALETTE = [
  'from-brand-500 to-brand-700',
  'from-sky-500 to-indigo-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-700',
  'from-emerald-500 to-teal-700',
  'from-cyan-500 to-blue-600',
  'from-fuchsia-500 to-rose-600',
];

function hashOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name = '?', src, size = 44, online = false, className = '' }) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';
  const gradient = PALETTE[hashOf(name || '?') % PALETTE.length];

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {src ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full rounded-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
      <div
        className={`absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br ${gradient} font-semibold text-white ${src ? 'opacity-0' : ''}`}
        style={{ fontSize: size * 0.38 }}
      >
        {initials}
      </div>
      {online ? (
        <span className="absolute -bottom-0.5 -right-0.5 block h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-ink-900" />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- helpers */
export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon: I = Icon.chat, title, message, action }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center animate-fade-in">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
        <I className="h-8 w-8" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {message ? <p className="max-w-sm text-sm text-ink-500 dark:text-ink-400">{message}</p> : null}
      {action}
    </div>
  );
}

export function ErrorNote({ children, onDismiss }) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-300/50 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 animate-fade-in dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
      <span className="mt-0.5">!</span>
      <span className="flex-1">{children}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="opacity-60 hover:opacity-100">
          <Icon.close className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function Logo({ size = 'h-9 w-9' }) {
  return (
    <div className={`grid ${size} place-items-center rounded-xl bg-brand-600 text-white shadow-sm`}>
      <Icon.chat className="h-[55%] w-[55%]" />
    </div>
  );
}

export function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function formatDay(iso) {
  try {
    const d = new Date(iso);
    const today = new Date();
    const yest = new Date();
    yest.setDate(today.getDate() - 1);
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, today)) return 'Today';
    if (same(d, yest)) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}
