# Calling: permissions, mesh m-lines and TURN reachability

Round: 2026-10-27. Scope: A1 (microphone/camera permission), A2 (remote media,
signalling, ICE, TURN), A3/A4 (call screen + call rows). B–F are separate rounds.

## 1. What was actually broken

| Symptom | Root cause | Fixed by |
| --- | --- | --- |
| "Microphone permission was denied" with no way forward | `getUserMedia` rejection was turned into one generic sentence. On Android the WebView remembers a denied prompt per origin, so every later attempt fails instantly with `NotAllowedError` and the app kept retrying forever. | Preflight + `MediaPermissionDialog` (platform-specific taps + Try again) |
| Silent failure when the page is not secure | `getUserMedia` does not exist outside a secure context; the code assumed it did. | `isSecureMediaContext()` / `hasMediaCapture()` checked before capture |
| Caller's camera invisible to a participant who joined without a camera | `pc.addTrack()` built the SDP from the local tracks. An audio-only participant answered with a single audio m-line, which **rejects the video section of the offer**, so the caller had nowhere to send video. | Explicit `addTransceiver('audio')` + `addTransceiver('video')`, tracks attached with `replaceTrack()` |
| Remote `<video>` stayed paused (big play icon) | Autoplay policy rejected `play()`; nothing caught the rejection or asked for a tap. | `.play()` retry + "Tap to enable sound" overlay in the call screen |
| "Reconnecting…" that never recovers on mobile data | TURN is configured and running, but its ports are **not reachable from the internet** (see §3). Wi-Fi succeeds over host/srflx candidates; mobile-data NATs need a relay that is blocked. | Diagnosed + documented; needs one OCI console change (cannot be done from code) |
| ICE restarted too aggressively | `disconnected` triggered a restart after 2 s, killing connections that were about to recover (Wi-Fi ↔ mobile handover). | 6 s grace, then restart; `failed` restarts immediately and ends with actionable copy |

## 2. Microphone / camera flow (A1)

`apps/web/src/lib/mediaPermissions.ts` is the single source of truth:

1. `isSecureMediaContext()` + `hasMediaCapture()` — stop early with "Open Chatgram
   over HTTPS" instead of a misleading permission error.
2. `queryMediaPermission('microphone' | 'camera')` — `navigator.permissions.query`
   when supported. A hard `denied` never re-prompts in Chrome/WebView, so we show the
   dialog instead of asking again. `unsupported` (Safari) is a normal answer and is
   never treated as denied.
3. `describeMediaError()` maps `NotAllowedError`, `PermissionDeniedError`,
   `NotFoundError`, `DevicesNotFoundError`, `NotReadableError`, `TrackStartError`,
   `OverconstrainedError`, `ConstraintNotSatisfiedError`, `SecurityError`, `AbortError`
   and `TypeError` to distinct human copy.
4. `reportMediaFailure(error, kind, retry)` publishes to `MediaPermissionDialog`
   (mounted once in `App.tsx`), which shows numbered instructions for
   Android Chrome / the Android app / iOS Safari / other iOS browsers / desktop, and a
   **Try again** button that re-runs the real action (start call, answer call, record a
   voice note) from a tap.

Call sites: `startCall`, `joinActiveCall`, `acceptCall` (a failed capture no longer
declines the incoming call — it keeps ringing so the retry can answer it) and
`useVoiceRecorder.start`.

### Android (verified against the Capacitor sources in this repo)

- Permissions are already declared in `apps/mobile/android/app/src/main/AndroidManifest.xml`:
  `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`, and now
  `BLUETOOTH_CONNECT` (+ legacy `BLUETOOTH`/`BLUETOOTH_ADMIN` up to API 30) for call
  audio routing, with optional `uses-feature` entries so devices without a camera,
  microphone, Bluetooth or telephony still install.
- No custom plugin is needed for `getUserMedia`: Capacitor 6's
  `BridgeWebChromeClient.onPermissionRequest()` (in
  `apps/mobile/node_modules/@capacitor/android/.../BridgeWebChromeClient.java`)
  requests `CAMERA` + `RECORD_AUDIO` at runtime and calls `request.grant()` only after
  the user allows the OS prompt. It requires the permissions to be declared in the
  manifest (`PermissionHelper.hasDefinedPermission`), which they are — that was the
  one thing that could have silently broken the prompt.
- `apps/mobile/capacitor.config.json` already has `server.androidScheme: "https"`
  (secure context), `captureInput: true` (media capture enabled in the WebView),
  `allowMixedContent: false` and `allowNavigation` limited to the Chatgram hosts. No
  CSP is set by the shell.
- Manifest changes take effect only in a new APK (next version bump), not in a web deploy.

### Web headers

`client/landing/vercel.json` now sends
`Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)`.
Note: the header was **absent** before, which means media was allowed by default — the
header is hardening (it also guarantees nothing accidental sets `camera=()`), not the
cause of the denial.

## 3. TURN: configured, listening, unreachable (needs one console change)

Verified on `ubuntu@84.12.64.204`:

- API env: `TURN_HOST=chatgram.duckdns.org`, `TURN_PORT=3478`, `TURN_TLS_PORT=5349`,
  `TURN_SECRET` present, `TURN_TTL_SECONDS=3600`.
- `/api/calls/ice` mints short-lived coturn REST credentials and returns
  `turn:…:3478?transport=udp`, `turn:…:3478?transport=tcp` and
  `turns:…:5349?transport=tcp` next to the STUN URLs.
- `turnserver` is listening on UDP+TCP 3478/5349; the VM's own iptables accepts
  3478/5349 and the relay range 49160–49200.
- From the public internet both ports **time out** (TCP 3478 and 5349 both closed),
  i.e. the Oracle Cloud VCN security list does not allow them — only 22/80/443 are open.

### Fix (Oracle Cloud console, one time)

VCN → Security Lists → the list attached to the instance's subnet → Add Ingress Rules:

| Source | IP Protocol | Destination Port Range | Purpose |
| --- | --- | --- | --- |
| 0.0.0.0/0 | UDP | 3478 | TURN/UDP |
| 0.0.0.0/0 | TCP | 3478 | TURN/TCP |
| 0.0.0.0/0 | TCP | 5349 | TURN/TLS |
| 0.0.0.0/0 | UDP | 5349 | TURN/DTLS |
| 0.0.0.0/0 | UDP | 49160-49200 | relay ports (`min-port`/`max-port` in turnserver.conf) |

Verify from a machine outside the VM:

```powershell
Test-NetConnection chatgram.duckdns.org -Port 3478   # expect True
Test-NetConnection chatgram.duckdns.org -Port 5349   # expect True
```

TURN/TLS on **443** is not possible on this box: nginx owns 443 for the site and the
API. 5349 is the standard TURN TLS port and satisfies "TLS on a TLS port"; a second
hostname + SNI multiplexing would be needed for 443.

## 4. Signalling and media (A2)

- One `RTCPeerConnection` per peer, perfect negotiation (`polite` derived from user
  ids), `makingOffer`/`ignoreOffer` glare handling, remote candidates queued until
  `setRemoteDescription` resolves — already in `lib/calls.ts`, verified while adding
  the transceivers.
- `pc.ontrack` no longer trusts `event.streams[0]` (a transceiver-replaced track has no
  stream id) and drops ended tracks of the same kind, so toggling a camera off/on does
  not leave a dead video element.
- Local preview muted; remote video `autoPlay playsInline` with a `.play()` retry and a
  "Tap to enable sound" overlay when the browser blocks autoplay.
- `disconnected` → 6 s grace → `restartIce()` (impolite side re-offers with
  `{iceRestart:true}`, TURN credentials refreshed first); `failed` → immediate restart;
  15 s window then the call ends with "Connection lost — … check your network", never a
  vague "connection dropped".
- `getStats()` runs every 3 s and drives the quality indicator (RTT and inbound packet
  loss) — the call screen shows one status line and one quality indicator, never both
  "Reconnecting" and "Good connection".

## 5. Manual test checklist

1. Phone browser (Chrome Android 360/412 px): deny the prompt → dialog appears with the
   Chrome steps; allow in site settings; "Try again" starts the call.
2. Android app: Settings → Apps → Chatgram → Permissions → Microphone → Allow; try
   again from the dialog.
3. Desktop Chrome 1366: block the camera in site settings; call → dialog; unblock and
   retry.
4. Caller with camera → receiver who accepted without a camera → receiver sees video
   (transceiver fix).
5. Wi-Fi vs mobile data with the OCI rules from §3 → `relay` candidates selected on
   mobile data, call stays connected.
6. Lock the phone mid-call → audio keeps flowing (foreground service is the next
   native round; this round does not add it).
7. Voice note: deny mic → same dialog; allow → record, send, play on both sides.
8. Update dialog (previous round): appears once, Ignore hides it everywhere except
   Settings → About.
