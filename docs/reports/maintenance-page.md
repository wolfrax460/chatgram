# Maintenance page upgrade — report

1. **A — Auto-refresh:** the maintenance screen (`apps/web/src/components/MaintenancePage.tsx`) polls `GET /api/status/health` **and** `GET /api/app/features` every 10 s (backing off 10→20→40→60 s after failures), pauses while `document.hidden`, re-checks immediately on `visibilitychange`/`online`, shows **“We’re back”** for 2 s, silently refreshes the session via `POST /api/auth/refresh` (never logging out) and reloads the path remembered in `sessionStorage` after 0–8 s jitter; after **30 min** of active polling it stops auto-reloading and offers **“Still working on it” + Check again**. “Back” requires a healthy API **and** `maintenanceMode: false`, because `/api/status/health` keeps returning 200 during maintenance.
2. **B — Design:** branded, mobile-first page on the existing design system (Inter, `ink-*`/`brand-*` tokens, `.card`/`.btn-primary`/`.field`), dark/light follows the system theme (existing store, switch remembered locally), logo + green accent with a soft pulse that is disabled under `prefers-reduced-motion`, headline **“We’re making Chatgram better”** and the exact safe-chats message, an `aria-live` status line, the raw health text removed from the main view (current result + last-checked time behind a **Details** toggle), custom-message block, countdown/“We’ll be back shortly”, footer with Check again, contact mailto, legal links, EN/RW/FR/SW switcher (copy marked for native-speaker review), 44 px touch targets, no horizontal scroll at 360 px.
3. **C — While waiting:** a real timestamped “Live updates” feed built from the browser’s own checks (newest first, refreshed by the poll — no maintenance-updates endpoint exists, noted in-page), quick links (Help/FAQ, downloads, privacy, contact, landing), **“Notify me when it’s back”** (permission requested only on click, notification only while the tab stays open, explicitly no closed-app push and no email collection), localStorage draft with **“Your draft is saved on this device”** and a “not sent or queued” note, rotating “Did you know?” tips (verified features: AI in 4 languages, 24 h Status with photo/video/voice, two-step verification, group voice/video calls), plus language/theme switches and a “Report a problem” mailto carrying the page URL + time.
4. **D — Read-only mode:** `readOnlyMode` from `/api/app/features` now drives a top banner with the brief’s wording, a disabled composer with the same message, greyed call buttons with tooltips (chat header, Calls page), no status posting, disabled edit/star/forward/pin/reactions and empty-screen actions, guarded `sendText`/`sendFile`/`editMessage` (the socket `message:send`/`call:start` paths bypass the server’s 503 gate, so the client must block them), and any remaining server `503 { code: 'READ_ONLY' }` is surfaced as the API message — nothing is silently dropped. Maintenance (blocks everyone, full-page screen) vs read-only (chats readable, writes blocked) is explained next to the admin switches.
5. **Screenshots: none taken by me.** The Lead owns the 2 shared screenshots. `docs/screens/` and `docs/screenshots/` were not touched.
6. **Wrappers + owner steps + scope:** Electron (`apps/desktop`) and Android (Capacitor WebView) load the same hosted `/web/` build, so both show it and resume correctly through visibility/online events. Owner: normal web deploy (`scripts/deploy-web.ps1`) and toggle maintenance/read-only on `/web/admin/flags`; preview locally from that page. During maintenance users **cannot send, call, upload, edit or even read** (the API is 503 and the app is replaced); in read-only they can read chats but **cannot send, upload, call or edit**. **Not built:** closed-app push, an offline send queue, and the server-side maintenance-updates feed.

## Gaps / server changes needed (Lead decides; `server/` was not edited)

| Gap | Impact | Suggested server change |
|---|---|---|
| No maintenance-updates resource or endpoint | Dashboard cannot post “Live updates”; the page shows the browser check log instead (`/api/app/announcements` also returns 503 during maintenance because the gate only exempts `/auth`, `/config`, `/app/features`, health) | Add `GET /api/app/maintenance/updates` + admin CRUD, and exempt it in `platformGate` |
| PlatformSettings has only one `maintenanceMessage` | No 4-language message, start time, expected end time/countdown, phase label, scheduled-before banner or auto-off | Add `maintenanceMessageI18n{en,rw,fr,sw}`, `maintenanceStartsAt/EndsAt`, `maintenancePhase`, `maintenanceBannerLeadMinutes`, `maintenanceAutoOffHours` + scheduler auto-off |
| Socket handlers are not behind `platformGate` | `message:send` and `call:start` still work over the socket if a client connects during maintenance/read-only; the web client disables them, other clients may not | Gate socket message/call events on `platformSettings.get()` |
| No public settings endpoint for contact/socials | Footer uses the repo-wide placeholder `support@chatgram.local`; the admin Settings `supportEmail`, privacy/terms URLs and any social links are not publicly readable | Expose a safe subset on `GET /api/config` (support email, legal links, socials) |
| Audit is per-save only | Preview-draft fields (4 languages, times, phase, auto-off) are browser-local, **not saved or audited** — labelled in the admin UI | Persist them through `/api/admin/platform-settings` so the existing `platform_settings_update` audit covers them |

**Verification (no screenshots):** `npm run typecheck -w @chatgram/web` and `npm run build -w @chatgram/web` pass; a temporary headless-browser check against a local Vite server confirmed the preview/real maintenance page (headline, banner, details, language + theme switch, draft persistence, no horizontal scroll at 360 px, mocked “maintenance off” → “We’re back” → reload to the remembered path), read-only mode (banner, readable messages, disabled composer/call/status buttons) and the admin flags page (safety confirmation, draft fields, Preview opening `?maintenance-preview=1`). Check scripts were deleted afterwards; no Playwright suite was added.

**Not built (by design of the brief):** closed-app push notifications and an offline send queue. The draft box only stores text locally; no message is claimed to be queued or sent.

## Server follow-up (2026-10-27)

The two server-side gaps in the table above are now closed in `server/` (the web page
is unchanged):

1. **Socket gate.** Socket.IO now refuses the namespace handshake during maintenance
   with `connect_error` → `err.data = { code: 'MAINTENANCE', message }`, and drops
   events from sockets that were connected before the switch (they stay connected and
   resume on their own when maintenance ends; the presence heartbeat is still let
   through so they are not reaped). This closes the `message:send` / `call:start`
   bypass called out above.
2. **Auto-off.** `PlatformSettings.maintenanceUntil` (ISO date, optional, max 7 days
   ahead) makes the window one-shot: once it passes, the REST gate, the socket gate and
   `/api/app/features` all report maintenance off without another admin action.
   `/api/app/features` now reports the effective `maintenanceMode` plus
   `maintenanceUntil`, so both shells can show the page before their first API call and
   recover by polling. `PUT /api/admin/platform-settings` accepts the field and the
   existing `platform_settings_update` audit keeps covering every change.

Still open (not done here): the maintenance-updates feed, the multi-language message /
start-end fields, and a public contact/socials endpoint. One cross-scope item for the
web client (`apps/web/src/App.tsx`): on boot it calls `api.me()` and clears the tokens
in its `catch`, so a returning user whose session check gets `503 MAINTENANCE` is
logged out; skipping the session call while `features.maintenanceMode` is true (and
letting the maintenance page refresh the session, as it already does) avoids that.

