import { useEffect, useRef, useState } from 'react';

/**
 * Interactive phone mock-up for the hero.
 *
 * The screens are real DOM (not screenshots), so the tabs are clickable, the
 * content scales crisply at any zoom, and it follows the site's light/dark
 * theme. Auto-advances every few seconds and pauses while hovered or focused.
 */

const SCREENS = [
  { id: 'chats', label: 'Chats' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'status', label: 'Status' },
  { id: 'settings', label: 'Settings' },
];

const CHATS = [
  { name: 'Amina', preview: 'See you at 7 then 👍', time: '09:41', unread: 2, hue: 160 },
  { name: 'Design team', preview: 'Kwame: new mockups are up', time: '09:12', unread: 0, hue: 200, group: true },
  { name: 'Chatgram Support', preview: 'Thanks for the report!', time: 'Yesterday', unread: 0, hue: 45, support: true },
  { name: 'Eric', preview: 'Voice message', time: 'Yesterday', unread: 0, hue: 280 },
];

const MESSAGES = [
  { mine: false, text: 'Hey! Did you get the files?', time: '09:38' },
  { mine: true, text: 'Yes — reviewing them now', time: '09:39', read: true },
  { mine: false, text: 'Perfect. Anything you want changed?', time: '09:40' },
  { mine: true, text: 'Just the colours on the header', time: '09:41', read: true },
];

function Avatar({ name, hue, size = 34, support }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <div
      className="pd-avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: support
          ? 'linear-gradient(135deg,#0b3a33,#008069)'
          : `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${hue + 22} 60% 32%))`,
      }}
    >
      {support ? 'C' : initials}
    </div>
  );
}

function ScreenChats() {
  return (
    <div className="pd-screen">
      <div className="pd-topbar">
        <span className="pd-wordmark">Chatgram</span>
        <span className="pd-icons">
          <i className="pd-dot" />
          <i className="pd-dot" />
        </span>
      </div>
      <div className="pd-search">Search or start a new chat</div>
      <div className="pd-list">
        {CHATS.map((c) => (
          <div className="pd-row" key={c.name}>
            <Avatar name={c.name} hue={c.hue} support={c.support} />
            <div className="pd-row-main">
              <div className="pd-row-top">
                <span className="pd-name">{c.name}</span>
                <span className="pd-time">{c.time}</span>
              </div>
              <div className="pd-row-bottom">
                <span className="pd-preview">{c.preview}</span>
                {c.unread ? <span className="pd-badge">{c.unread}</span> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScreenConversation() {
  return (
    <div className="pd-screen pd-conv">
      <div className="pd-topbar pd-convbar">
        <span className="pd-back">‹</span>
        <Avatar name="Amina" hue={160} size={28} />
        <div className="pd-conv-title">
          <span className="pd-name">Amina</span>
          <span className="pd-sub">online</span>
        </div>
      </div>
      <div className="pd-messages">
        {MESSAGES.map((m, i) => (
          <div key={i} className={`pd-bubble ${m.mine ? 'pd-mine' : 'pd-theirs'}`}>
            <span>{m.text}</span>
            <span className="pd-meta">
              {m.time}
              {m.read ? ' ✓✓' : m.mine ? ' ✓' : ''}
            </span>
          </div>
        ))}
        <div className="pd-bubble pd-theirs pd-typing">
          <i /><i /><i />
        </div>
      </div>
      <div className="pd-composer">
        <span className="pd-input">Type a message</span>
        <span className="pd-send">➤</span>
      </div>
    </div>
  );
}

function ScreenStatus() {
  return (
    <div className="pd-screen">
      <div className="pd-topbar">
        <span className="pd-wordmark">Status</span>
      </div>
      <div className="pd-status-row">
        <div className="pd-add-ring">+</div>
        <div>
          <div className="pd-name">My status</div>
          <div className="pd-sub">Tap to add a status update</div>
        </div>
      </div>
      <div className="pd-section-label">Recent updates</div>
      {[
        { name: 'Amina', hue: 160, t: '5 minutes ago' },
        { name: 'Kwame', hue: 200, t: '22 minutes ago' },
        { name: 'Eric', hue: 280, t: '1 hour ago' },
      ].map((s) => (
        <div className="pd-row" key={s.name}>
          <div className="pd-ring">
            <Avatar name={s.name} hue={s.hue} size={32} />
          </div>
          <div className="pd-row-main">
            <div className="pd-name">{s.name}</div>
            <div className="pd-sub">{s.t}</div>
          </div>
        </div>
      ))}
      <div className="pd-section-label">Your privacy</div>
      <div className="pd-privacy">
        Status updates disappear after 24 hours. You choose who can see them.
      </div>
    </div>
  );
}

function ScreenSettings() {
  return (
    <div className="pd-screen">
      <div className="pd-topbar">
        <span className="pd-wordmark">Settings</span>
      </div>
      <div className="pd-profile">
        <Avatar name="You" hue={45} size={48} />
        <div>
          <div className="pd-name">Your name</div>
          <div className="pd-sub">Available</div>
        </div>
      </div>
      {[
        ['Appearance', 'Light'],
        ['Theme', 'System'],
        ['Help & feedback', 'Chat with support'],
        ['Privacy', 'Contacts only'],
        ['Version', '1.0.0'],
      ].map(([label, value]) => (
        <div className="pd-setting" key={label}>
          <span>{label}</span>
          <span className="pd-setting-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

const RENDERERS = {
  chats: ScreenChats,
  conversation: ScreenConversation,
  status: ScreenStatus,
  settings: ScreenSettings,
};

export default function PhoneDemo() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (paused) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    timer.current = setInterval(() => {
      setIndex((i) => (i + 1) % SCREENS.length);
    }, 4200);
    return () => clearInterval(timer.current);
  }, [paused]);

  const Screen = RENDERERS[SCREENS[index].id];

  return (
    <div
      className="pd-wrap"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="pd-glow" aria-hidden="true" />
      <div className="pd-phone">
        <div className="pd-notch" aria-hidden="true" />
        <div className="pd-viewport">
          {/* key forces a remount so the enter animation replays */}
          <div key={SCREENS[index].id} className="pd-fade">
            <Screen />
          </div>
        </div>
      </div>

      <div className="pd-tabs" role="tablist" aria-label="Preview screens">
        {SCREENS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={`pd-tab ${i === index ? 'is-active' : ''}`}
            onClick={() => setIndex(i)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="pd-hint">Tap a screen to explore — this is the real layout, not a screenshot.</p>
    </div>
  );
}
