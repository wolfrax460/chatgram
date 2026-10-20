import React, { useCallback, useEffect, useState } from 'react';
import { api, tokens, userCache } from './lib/api.js';
import { connectSocket, disconnectSocket } from './lib/socket.js';
import { useTheme } from './lib/theme.js';
import { getPrefs } from './lib/prefs.js';
import { playMessageSound, showNotification } from './lib/notify.js';
import { Avatar, Icon, Logo, Spinner } from './components/ui.jsx';
import Auth from './views/Auth.jsx';
import Chats from './views/Chats.jsx';
import Contacts from './views/Contacts.jsx';
import Settings from './views/Settings.jsx';
import Status from './views/Status.jsx';

const NAV = [
  { key: 'chats', label: 'Chats', icon: Icon.chat },
  { key: 'status', label: 'Status', icon: Icon.statusRing },
  { key: 'contacts', label: 'Contacts', icon: Icon.users },
  { key: 'settings', label: 'Settings', icon: Icon.settings },
];

export default function App() {
  const { mode, toggle } = useTheme();
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('chats');
  const [socket, setSocket] = useState(null);
  const [pendingChat, setPendingChat] = useState(null);

  // Restore an existing session on load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tokens.access) {
        setBooting(false);
        return;
      }
      try {
        const me = await api.me();
        if (cancelled) return;
        const profile = me?.user || me;
        setUser(profile);
        userCache.set(profile);
      } catch {
        tokens.clear();
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live connection once we have a session.
  useEffect(() => {
    if (!user) return undefined;
    const s = connectSocket();
    setSocket(s);
    return () => {
      disconnectSocket();
      setSocket(null);
    };
  }, [user]);

  // Notifications + sounds for incoming messages while the window is not in
  // focus (the open chat view handles the in-focus case itself).
  useEffect(() => {
    if (!socket) return undefined;
    const onNew = (msg) => {
      const prefs = getPrefs();
      if (!prefs.notifications && !prefs.sounds) return;

      const senderId = msg.senderId?._id || msg.senderId;
      if (senderId === (user?._id || user?.id)) return; // never notify for my own

      const focused = document.visibilityState === 'visible' && document.hasFocus();
      if (focused) return;

      if (prefs.sounds) playMessageSound();
      if (prefs.notifications) {
        const name = msg.senderId?.displayName || 'New message';
        const body =
          msg.content ||
          (msg.type === 'image'
            ? 'Photo'
            : msg.type === 'video'
              ? 'Video'
              : msg.type === 'audio'
                ? 'Voice message'
                : msg.type === 'file'
                  ? 'Document'
                  : 'New message');
        showNotification(name, body, () => window.focus());
      }
    };
    socket.on('message:new', onNew);
    return () => socket.off('message:new', onNew);
  }, [socket, user]);
  const handleSignedIn = useCallback((data) => {
    tokens.save(data.accessToken, data.refreshToken);
    const profile = data.user || userCache.get();
    if (profile) userCache.set(profile);
    setUser(profile);
    setTab('chats');
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout', {});
    } catch {
      /* best effort */
    }
    tokens.clear();
    disconnectSocket();
    setUser(null);
  }, []);

  const openChatById = useCallback((chatId) => {
    setPendingChat({ id: chatId, at: Date.now() });
    setTab('chats');
  }, []);

  if (booting) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-4">
          <Logo size="h-12 w-12" />
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Auth onSignedIn={handleSignedIn} />;
  }

  const meId = user._id || user.id;

  return (
    <div className="flex h-full">
      {/* ------------------------------------------------------------ rail */}
      <aside className="hidden w-[84px] shrink-0 flex-col items-center gap-2 border-r border-ink-200 bg-white/60 py-4 dark:border-white/10 dark:bg-white/[.02] lg:flex">
        <Logo />
        <div className="mt-4 flex flex-1 flex-col gap-1">
          {NAV.map(({ key, label, icon: I }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              title={label}
              className={`relative grid h-12 w-14 place-items-center rounded-xl transition ${
                tab === key
                  ? 'bg-brand-600/10 text-brand-700 dark:text-brand-300'
                  : 'text-ink-500 hover:bg-ink-100 dark:hover:bg-white/5'
              }`}
            >
              {tab === key ? (
                <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-brand-600" />
              ) : null}
              <I className="h-6 w-6" />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggle}
          title={`Theme: ${mode}`}
          className="grid h-10 w-10 place-items-center rounded-xl text-ink-500 hover:bg-ink-100 dark:hover:bg-white/5"
        >
          {mode === 'dark' ? (
            <Icon.moon className="h-5 w-5" />
          ) : mode === 'light' ? (
            <Icon.sun className="h-5 w-5" />
          ) : (
            <Icon.monitor className="h-5 w-5" />
          )}
        </button>
        <Avatar name={user.displayName} src={user.avatarUrl} size={40} online />
      </aside>

      {/* ------------------------------------------------------------ main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <header className="flex items-center gap-3 border-b border-ink-200 px-3 py-2.5 dark:border-white/10 lg:hidden">
          <Logo size="h-8 w-8" />
          <span className="font-bold">Chatgram</span>
          <div className="flex-1" />
          <button type="button" onClick={toggle} className="btn-ghost !px-2">
            {mode === 'dark' ? (
              <Icon.moon className="h-5 w-5" />
            ) : mode === 'light' ? (
              <Icon.sun className="h-5 w-5" />
            ) : (
              <Icon.monitor className="h-5 w-5" />
            )}
          </button>
        </header>

        <main className="min-h-0 flex-1">
          {tab === 'chats' ? (
            <Chats
              meId={meId}
              socket={socket}
              onOpenContacts={() => setTab('contacts')}
              initialChatId={pendingChat}
            />
          ) : tab === 'status' ? (
            <Status meId={meId} user={user} />
          ) : tab === 'contacts' ? (
            <Contacts meId={meId} onOpenChat={openChatById} />
          ) : (
            <Settings
              user={user}
              onSignedOut={handleSignOut}
              onOpenSupport={openChatById}
              onUserUpdated={(updated) =>
                setUser((prev) => ({ ...prev, ...updated }))
              }
            />
          )}
        </main>

        {/* mobile bottom nav */}
        <nav className="flex border-t border-ink-200 dark:border-white/10 lg:hidden">
          {NAV.map(({ key, label, icon: I }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition ${
                tab === key ? 'text-brand-600 dark:text-brand-300' : 'text-ink-500'
              }`}
            >
              <I className="h-5 w-5" />
              {label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
