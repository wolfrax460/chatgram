# Chatgram for Android — build notes

The Android app is a Capacitor shell (`apps/mobile`) that loads the hosted
Chatgram web client. Like the desktop shell, the web build is the single source
of truth: the app points at `https://chatgram-xi.vercel.app/web/`, so every web
deploy reaches the phone without a new APK. This build is a **direct-download,
debug-signed APK for sideloading only** — no release keystore, no Play Store
signing.

## Environment used

| Tool | Value |
| --- | --- |
| JDK | Microsoft OpenJDK **17.0.16** (Gradle 9.3.1 needs 17+; the machine's Android Studio JBR was JDK 25, too new for AGP) |
| Gradle | **9.3.1** from the local wrapper cache (`~/.gradle/wrapper/dists/gradle-9.3.1-bin`) — the wrapper's configured `-all` distribution could not be downloaded |
| Android Gradle Plugin | **8.13.1** (cached in the Gradle module cache) |
| Android SDK | `D:\androidstudio` (`ANDROID_HOME`): platforms 35/36/37, Build-Tools 35.0.0 + 36.0.0, cmdline-tools latest |
| Capacitor | `@capacitor/core` / `@capacitor/android` / `@capacitor/cli` 6.2.x |

### Blocked Gradle download — how it was fixed

1. `gradle-wrapper.properties` `networkTimeout` raised from `10000` to `600000`.
2. Switched the wrapper to the `-bin` distribution (Gradle **9.3.1**) and pinned
   its official SHA-256 (`b266d5ff…ff06`) so a corrupt download is rejected.
3. The Gradle download host was unreachable from this machine, but the 9.3.1
   distribution was already present in the local Gradle cache. The build invokes
   that cached distribution directly (`…/gradle-9.3.1/bin/gradle.bat`), which is
   the documented fallback for a blocked download.
4. AGP bumped 8.2.1 → 8.13.1 + SDK levels 34 → 36 so the build matches the
   installed SDK and the cached Gradle/AGP pair. The first build downloaded
   Build-Tools 35.0.0 automatically after accepting the SDK licences.

## Configuration

- `applicationId` / `namespace`: **`app.chatgram.android`** (was `com.chatgram.app`).
- `versionName` **1.1.0**, `versionCode` 1.
- `capacitor.config.json`: `server.url = https://chatgram-xi.vercel.app/web/`,
  `androidScheme: https`, `cleartext: false`; navigation limited to
  `chatgram-xi.vercel.app` and `chatgram.duckdns.org`.
- `AndroidManifest.xml`: `usesCleartextTraffic="false"`, `allowBackup="false"`,
  permissions for camera, microphone, notifications and gallery media reads
  (camera/mic declared optional — the WebView only asks when a call or voice note
  needs them).
- Splash: dark `#0B141A` background with the Chatgram icon (Android 12+ splash API
  plus legacy splash drawables).
- Launcher icons: adaptive icon regenerated from `client/assets/icon-512.png` for
  every density, background `#0B141A`.
- Back button / safe areas: Capacitor's default back behaviour (WebView history,
  then exit) and the web app's own responsive layout are used; no extra native
  handling was added.

## Build command

```powershell
$env:JAVA_HOME  = '<jdk17>'
$env:ANDROID_HOME = 'D:\androidstudio'
$gradle -p apps/mobile/android assembleDebug --no-daemon --console=plain
```

Output: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
(debug key generated automatically by Gradle).

## This build

| | |
| --- | --- |
| Version | 1.1.0 (versionCode 1, rebuilt 2026-10-26) |
| File | `chatgram-android.apk` (from `app-debug.apk`) |
| Size | 4,127,661 bytes |
| SHA-256 | `1dfe75cb8ac6475fcc29d81a667114a41fe9cc2f1b95379cb92ce693662eb0da` |
| applicationId | `app.chatgram.android` |
| minSdk / targetSdk | 24 / 36 |
| Signing | Gradle **debug** key (sideloading only; Play Store signing is not configured) |

### Verified without a device

- `apkanalyzer apk summary` → `app.chatgram.android 1 1.1.0`
- `apkanalyzer manifest min-sdk` / `target-sdk` → 24 / 36
- `apkanalyzer manifest permissions` → INTERNET, CAMERA, RECORD_AUDIO,
  MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS, READ_MEDIA_IMAGES/VIDEO/AUDIO,
  READ_EXTERNAL_STORAGE (maxSdk 32)
- `apkanalyzer files list` shows the compiled app assets and libraries.

**Not tested:** installation and runtime on a real Android phone or emulator
(none was available in this environment). The first launch will ask for the
device network only; camera/mic prompts appear when a call or voice note is used.

### Install (sideloading) steps

1. Download `chatgram-android.apk` from the landing Downloads tab.
2. Allow "install unknown apps" for the browser/Files app when prompted
   (Settings → Apps → Special access → Install unknown apps).
3. Open the APK and install; launch **Chatgram**.
4. The app needs a network connection to sign in (it loads the hosted web client,
   the same one `/web/` serves).
