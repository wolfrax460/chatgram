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

## Android changes (APK 1.1.5 / versionCode 6)

New Java files in `apps/mobile/android/app/src/main/java/app/chatgram/android/`:

- `NotifierPlugin.java` — Capacitor plugin `@CapacitorPlugin(name = "Notifier")` with
  `requestPermission()`, `getPermission()` (Android 13+ `POST_NOTIFICATIONS`, resolving
  only after the user answers; below API 33 resolves granted immediately), `notify()`,
  `cancel()`, `cancelAll()` and `consumePending()`. The `messages` channel is created in
  `load()`, before the first notification.
- `NotifierNotifications.java` — channel `messages` (`IMPORTANCE_HIGH`, vibration, default
  sound, badge on), permission/enabled checks, `NotificationCompat` post/replace keyed by
  Android's `(tag, id)` pair (one notification per chat), per-chat `setGroup`, and an
  immutable content `PendingIntent` (`SINGLE_TOP | CLEAR_TOP`, activity is `singleTask`).
  `cancelAll()` filters by the `messages` channel, so the updater's notification survives.
- `NotifierStore.java` — the tapped chat id lives in `chatgram_notifier` SharedPreferences,
  cleared atomically by `consumePending()`, with a tap token so activity/process recreation
  cannot re-open a chat the user already visited.
- `MainActivity.java` — registers the plugin and captures the launch intent plus
  `onNewIntent()`.
- `AndroidManifest.xml` — `VIBRATE` added (channel vibration silently does nothing without
  it); `POST_NOTIFICATIONS` was already declared.

No new Gradle dependencies (AndroidX core/appcompat already provide `NotificationCompat`).
The small icon is the existing `@mipmap/ic_launcher_foreground` — the project has no
dedicated notification icon asset, and adding a binary asset was out of scope.

Verification: `gradlew :app:assembleDebug` → `BUILD SUCCESSFUL`; `apkanalyzer dex packages`
lists the plugin and all six methods plus `MainActivity.onNewIntent`; `aapt2 dump badging`
shows `POST_NOTIFICATIONS` and `VIBRATE`.

**Honest limit:** this is a *local* notification. It is posted by our own process while the
web app (and its socket) is alive — backgrounded app, locked screen with the process still
running. If Android has killed the process nothing can wake it without a remote push: that
needs FCM (project credentials, a server sender keyed to device tokens, and a data message
that starts the call/message flow), which is a separate round. The comment saying so is in
`NotifierPlugin` and `NotifierNotifications`. iOS is not covered at all (APNs + Capacitor
iOS would be a separate shell).

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
