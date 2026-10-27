# Notifications on Android and Windows

Round 2026-10-27. Goal: a new message must reach the user when Chatgram is not in the
foreground, on both native shells, and tapping it must open that conversation.

## Why the web path was not enough

The web build runs inside three different containers and only one of them can show a
browser notification:

| Container | `new Notification()` | What works |
| --- | --- | --- |
| Desktop browser | yes (with permission) | Web Notification API |
| Capacitor Android WebView | silently does nothing (no page-level notification permission) | a native `NotificationManager` notification through a plugin |
| Electron Windows | works but attributed to `electron.exe`, no icon, click handler unreliable in packaged builds | `Notification` in the main process + AppUserModelID |

So the page decides **whether** to notify (`lib/notify.ts`: foreground check, do-not-disturb,
muted chats) and the shell decides **how**.

## Web layer

- `apps/web/src/lib/nativeNotifications.ts` (new): detects the shell
  (`window.chatgramDesktop` for Electron, `Capacitor.Plugins.Notifier` for Android),
  exports `nativeNotify()`, `syncNativePermission()`, `requestNativePermission()` and
  `initNativeNotifications(openChat)`.
- `apps/web/src/lib/notify.ts`: `notificationsSupported()`, `notificationPermission()` and
  `requestNotificationPermission()` are now native-aware; `showNotification()` gained a
  `chatId` argument and hands the notification to the shell before falling back to the
  Web API. The browser path is unchanged.
- `apps/web/src/lib/useRealtime.ts`: the notification title is now the sender's name
  (was the generic "New message") and the chat id travels with the notification, so a
  tap opens the right conversation.
- `apps/web/src/App.tsx`: `initNativeNotifications(openChat)` wires the tap to the app
  router. On Android the pending chat id is drained when the WebView becomes visible
  (`visibilitychange` / `focus`), which covers both "app was in the background" and
  "app was launched by the notification".

## Windows (Electron) changes

`apps/desktop/main.js`:

- `app.setAppUserModelId('com.chatgram.desktop')` (matches `build.appId`). Without it a
  Windows toast is attributed to `electron.exe`, loses the Chatgram icon and its click
  is not delivered in a packaged build — that was the "Windows notifications do not work"
  bug.
- `chatgram:notify` now accepts `{ title, body, chatId, silent }`, keeps the toast object
  so the click handler stays alive, and on click calls `focusMainWindow(chatId)` which
  restores a minimised window, shows one hidden to the tray, focuses it and sends
  `chatgram:open-chat` to the page.
- Existing behaviour kept: tray tooltip + badge from `chatgram:unread`, incoming-call
  toast + `flashFrame`, and the tray's own click/menu.

`apps/desktop/preload.js`:

- `notify` accepts the object payload (and still tolerates the old `(title, body)` form).
- `onOpenChat(callback)` subscribes to `chatgram:open-chat` and returns an unsubscribe
  function; the renderer receives nothing else from Node.

## Android changes

See the Java plugin in `apps/mobile/android/app/src/main/java/app/chatgram/android/`
(`NotifierPlugin`) plus its registration in `MainActivity`:

- channel `messages` (high importance, vibration, default sound) created before the first
  notification;
- `requestPermission()` / `getPermission()` for Android 13+ `POST_NOTIFICATIONS`;
- `notify({ title, body, chatId, tag })` posts/replaces one notification per chat, with a
  tap that launches `MainActivity` single-task and stores the chat id for
  `consumePending()`;
- `cancel()` / `cancelAll()`.

**Honest limit:** this is a *local* notification. It is posted by our own process while the
WebView is alive (backgrounded app, locked screen with the process still running). If
Android has killed the process, nothing can wake it without a remote push: that needs FCM
(project credentials + a server-side sender), which is a separate round. Also, iOS is not
covered at all — Capacitor iOS would need APNs.

## Manual test checklist

Windows:

1. Install/run the app, sign in, minimise to tray, send a message from another account
   (or the phone) → toast appears with the sender name and the Chatgram icon.
2. Click the toast → the window restores and that chat opens.
3. With Chatgram focused → no toast (foreground suppression), only the in-app update.
4. Enable Do not disturb in Settings → no toast in the window, still arrives in the app.

Android:

1. Sign in, grant the notification permission when asked (Android 13+).
2. Put the app in the background / lock the screen, send a message from another account.
3. Notification appears with the sender name and body; tap → app opens on that chat.
4. Two messages in the same chat → one replaced notification, not two stacked.
5. Deny the notification permission → no crash, no notification, app still usable.
