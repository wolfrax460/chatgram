# Chatgram for Android - build, test and troubleshooting notes

Last updated **2026-10-27**, build **1.1.2 (versionCode 3)**, app id `app.chatgram.android`,
minSdk 24, targetSdk 34, compileSdk 36.

The Android app is a **thin Capacitor 6 shell** (`apps/mobile`) that loads the hosted web client
`https://chatgram-xi.vercel.app/web/`. Like the desktop shell, the web build is the single source of
truth: a web deploy reaches the phone without a new APK. This build is a **direct-download,
debug-signed APK for sideloading only** - there is no release keystore and no Play Store listing.
The React/Flutter leftovers in `client/android/` are **not** the Android app; do not build them.

---

## 1. Why 1.1.0 "did not work" (diagnosis with evidence)

The 4,127,661-byte 1.1.0 APK could never show the app. Found three independent fatal faults, plus
five defects that would have made the app nearly unusable even after the crash was fixed.

| # | Cause | Evidence | Fix (1.1.1, shipped in 1.1.2) |
|---|-------|----------|--------------|
| 1 | **Launcher activity did not exist.** The merged manifest launches `app.chatgram.android.MainActivity`, but the dex only contained `com.chatgram.app.MainActivity` (the app id/namespace was renamed but the Java package was not). | On an Android 14 emulator: `FATAL EXCEPTION: main ... java.lang.RuntimeException: Unable to instantiate activity ComponentInfo{app.chatgram.android/app.chatgram.android.MainActivity}: java.lang.ClassNotFoundException: Didn't find class "app.chatgram.android.MainActivity"`. Also visible offline: `apkanalyzer dex packages` lists only `com.chatgram.app.MainActivity`. | Moved the activity to `android/app/src/main/java/app/chatgram/android/MainActivity.java` with `package app.chatgram.android`. The build script now fails if the manifest class is not in the dex. |
| 2 | **Stale `cap copy`.** `capacitor.config.json` was edited on 2026-10-25 (app id + `server.url`) but `cap copy` was never re-run, so the APK packaged the 2026-10-20 config: `appId: com.chatgram.app`, **no `server.url`**. Capacitor therefore loaded bundled local assets instead of the hosted client. | APK `assets/capacitor.config.json` (mtime 2026-10-20) vs repo config (mtime 2026-10-25). | `apps/mobile/build-apk.ps1` always runs `cap copy`, then refuses to build unless the **packaged** `assets/capacitor.config.json` has the right appId + `server.url`. |
| 3 | **Broken bundled fallback.** The packaged `assets/public/index.html` loaded `/web/static/index-Cu7qs22L.js` and `/web/static/index-P4d9b3I6.css`, but those files were at `/static/`. Under `https://localhost` both 404, so even the local path was a permanent white screen (and it was a 7-day-old web build). | APK zip contents: `assets/public/static/...` exists, `assets/public/web/...` does not. | The bundled web snapshot is removed from the APK; a tiny `index.html` safety net and `error.html` replace it (see 4). |
| 4 | **Keyboard covered the composer** - no `windowSoftInputMode`, so Android used the default pan/nothing instead of resize. | Manifest inspection. | `android:windowSoftInputMode="adjustResize"` added to `MainActivity`. |
| 5 | **White flash / white screen on network failure** - the post-splash window background was `@null` (white) and there was no `server.errorPath`. | Manifest/styles inspection; the 1.1.0 app showed nothing at all offline. | `android:windowBackground` = branded `#0B141A`, `android.backgroundColor` = `#0B141A`, `server.errorPath = error.html`, plus a local offline page with auto-retry. |
| 6 | **Android 15/16 layout breakage** - targetSdk 36 forces edge-to-edge; the web client does not use `env(safe-area-inset-*)`, so the header sat under the status bar and the composer under the gesture bar, and adjustResize stopped working. | Android 15 edge-to-edge enforcement for targetSdk 35+. | `targetSdkVersion = 34` (compileSdk stays 36). Do not raise it until the web client handles safe areas; see D60. |
| 7 | **Updates would be refused** - `versionCode` stayed 1 for every build, and Gradle would silently generate a NEW debug keystore if the file ever went missing, changing the signature. | Gradle build file inspection. | `versionCode` 2 (then 3 for the published 1.1.2), and the build **fails** if `~/.android/debug.keystore` is missing. |
| 8 | **No shrinking / dead weight** - `assembleDebug`, `minifyEnabled false`, unused storage permissions, a stale 0.5 MB web snapshot, no R8. | Build file + APK contents. | Release build with R8 + resource shrinking, unused `READ_MEDIA_*` / `READ_EXTERNAL_STORAGE` permissions removed, web snapshot dropped, no unused Capacitor plugins (the plugin list was already empty). Result: **4.13 MB -> 1.07 MB**. |

**Size is not the bug.** A thin wrapper is normally 4-6 MB; 1.1.0's 4.13 MB was normal. The 1.1.1
build is smaller (1.07 MB) only because R8 + resource shrinking run and the unused bundled web copy
is gone.

---

## 2. Decision: keep the thin wrapper (no bundled web client)

Recorded as **D59** in `docs/decisions.md`. Short version:

- The three fatal faults were packaging bugs, not a consequence of loading the hosted URL. The
  hosted client loads fine in the WebView (verified on an emulator).
- Bundling is **not possible without web-layer changes**: `apps/web` builds with Vite
  `base: '/web/'` and `BrowserRouter basename='/web'`, so a bundle served from `https://localhost/`
  would match no route and render blank. It needs a relative base and a root basename first.
- Keeping the wrapper means a web deploy reaches every phone (CHUNK 7 relies on this) and keeps the
  APK small for slow networks.
- The CORS half is already ready for a future bundle: the API allows `https://localhost` and
  `capacitor://localhost` (`server/src/server.js`, `isAlwaysAllowedOrigin`).
- To never show a blank screen again: `server.errorPath` + local `error.html` with auto-retry, and a
  safety-net `index.html` that redirects to the hosted app.

---

## 3. Toolchain on this PC (nothing Android is on PATH)

| Tool | Location / value |
| --- | --- |
| Android SDK | `D:\androidstudio` (`ANDROID_HOME` / `ANDROID_SDK_ROOT`) |
| adb / fastboot | `D:\androidstudio\platform-tools\adb.exe` |
| Emulator | `D:\androidstudio\emulator\emulator.exe` |
| Build-Tools | `D:\androidstudio\build-tools\36.0.0` (`aapt2.exe`, `apksigner.bat`) |
| Command-line tools | `D:\androidstudio\cmdline-tools\latest\bin\` (`sdkmanager.bat`, `avdmanager.bat`, `apkanalyzer.bat`) |
| JDK | `C:\Program Files\Android\openjdk\jdk-21.0.8` (JDK 17+ works; set `JAVA_HOME`) |
| Gradle | cached `9.3.1` in `C:\Users\<you>\.gradle\wrapper\dists\gradle-9.3.1-bin\...\gradle-9.3.1\bin\gradle.bat` |
| AGP | 8.13.1 (Gradle 9.3.1 + AGP 8.13.1 are the cached, working pair) |
| Keystore | `C:\Users\<you>\.android\debug.keystore` |

The Gradle wrapper cannot download its `-all` distribution from this network, so the build script
uses the **cached** 9.3.1 distribution directly (the documented fallback). `sdkmanager` prints a
deprecation warning and an "SDK XML versions up to 3 / version 4 encountered" warning - both
harmless.

---

## 4. Build the APK (one command)

```powershell
cd F:\projects\chatgram
powershell -ExecutionPolicy Bypass -File apps\mobile\build-apk.ps1
```

What the script does (and why each check exists):

1. Fails if `~/.android/debug.keystore` is missing (never silently generate a new key).
2. Checks `capacitor.config.json` has `appId: app.chatgram.android` **and** `server.url`.
3. Runs `cap copy android` (copies the config + web assets into `android/`).
4. Fails if the **packaged** `assets/capacitor.config.json` does not carry `server.url`
   (this is exactly the 1.1.0 bug).
5. Replaces `assets/public` with the small local fallback pages (`error.html`, `index.html`) and
   deletes the copied web bundle (dead weight in a hosted-URL wrapper).
6. Runs `gradlew assembleRelease` (R8 + resource shrinking; Gradle heap limited to 1536 MB).
7. Verifies the APK: applicationId, `versionCode`, that the manifest's launcher class really exists
   in the dex, that the packaged config has `server.url`, and prints the signing certificate.
8. Copies the APK to `release-artifacts\chatgram-android.apk` and prints size + SHA-256.

Options: `-SkipSync` (reuse already copied assets), `-DebugBuild` (`assembleDebug`),
`-SdkRoot`, `-JavaHome`, `-GradleBat`.

Manual equivalent:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
$env:ANDROID_HOME = 'D:\androidstudio'
$env:PATH = "$env:JAVA_HOME\bin;D:\androidstudio\platform-tools;$env:PATH"
cd F:\projects\chatgram\apps\mobile
node node_modules\@capacitor\cli\bin\capacitor copy android
& "$env:USERPROFILE\.gradle\wrapper\dists\gradle-9.3.1-bin\<hash>\gradle-9.3.1\bin\gradle.bat" `
    -p android assembleRelease --no-daemon --console=plain
# output: apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

---

## 5. Debug keystore: BACK IT UP (the one irreversible thing)

The existing APK and every future update must be signed with the **same key**. Android rejects an
update signed with a different key with *"App not installed"*.

- Current signing key: `C:\Users\mugis\.android\debug.keystore`
  - alias `androiddebugkey`, password `android` (standard debug keystore, not a secret)
  - certificate SHA-256 `8a67642f91beb7183f1a3b2b5ed48e8278bfb1da1cfc7fa4594855068bc0152f`
  - this is the key the 1.1.0 APK was signed with, so 1.1.1 installs as an in-place update (verified)
- **Owner step:** copy that file somewhere safe outside the repo (e.g. your password manager or a
  backup drive) and keep it. Also keep the credentials above with it.
- Never delete `~/.android/debug.keystore`, never run a "clean Android Studio / reset settings"
  wizard that recreates it, and never create a release keystore for this sideload build.
- The Gradle file and the build script both fail loudly when the file is missing instead of
  generating a new one.

Check the signature at any time:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
D:\androidstudio\build-tools\36.0.0\apksigner.bat verify --print-certs release-artifacts\chatgram-android.apk
```

---

## 6. Best path: test on your own Android phone

No emulator, no RAM problem, real camera/mic/speakers, real network.

**USB debugging (recommended)**

1. Phone: Settings -> About phone -> tap *Build number* 7x -> Developer options -> **USB debugging**
   ON. Connect by USB, choose "File transfer" or "Allow USB debugging" on the phone prompt.
2. On the PC:
   ```powershell
   $adb = 'D:\androidstudio\platform-tools\adb.exe'
   & $adb devices            # must list your phone as "device" (not "unauthorized"/"offline")
   & $adb install -r F:\projects\chatgram\release-artifacts\chatgram-android.apk
   ```
3. Allow "install unknown apps" for the app that opens the APK (Files/Chrome) on the phone, or just
   use `adb install`, which needs no such permission.
4. Launch and watch the log:
   ```powershell
   & $adb logcat -c
   & $adb shell am start -W -n app.chatgram.android/app.chatgram.android.MainActivity
   & $adb logcat | Select-String 'Capacitor|chromium|CONSOLE|AndroidRuntime'
   ```
   Look for `Capacitor: Loading app at https://chatgram-xi.vercel.app/web/` - that line proves the
   packaged config is right. Cold start time is the first `TotalTime:` line.
5. Useful: `& $adb shell am force-stop app.chatgram.android` (clean restart),
   `& $adb logcat -c` (clear log), `& $adb shell screencap -p /sdcard/s.png` + `& $adb pull /sdcard/s.png .`

**Wireless debugging (Android 11+, no cable)**

1. Phone: Developer options -> **Wireless debugging** ON -> *Pair device with pairing code*
   (this needs the phone and PC on the same Wi-Fi).
2. On the PC:
   ```powershell
   D:\androidstudio\platform-tools\adb.exe pair <phone-ip>:<pair-port>     # enter the 6-digit code
   D:\androidstudio\platform-tools\adb.exe connect <phone-ip>:<debug-port>
   D:\androidstudio\platform-tools\adb.exe devices
   ```
3. Then `adb install -r` / `adb logcat` exactly as above.

---

## 7. Emulator on this 12 GB PC (the light setup that actually boots)

This machine: i3-1115G4, 11.7 GB RAM, WHPX available. Do **not** download API 35/36/37 images
(heavier, and the "Google Play" variants need far more RAM). Use **Android 14 (API 34) Google APIs
x86_64**, 2048 MB RAM, 2 cores, 4 GB storage, software graphics.

**Install the image (~1.5 GB download, 4.2 GB on disk)**

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
$env:ANDROID_HOME = 'D:\androidstudio'
Set-Content .pkg.txt 'system-images;android-34;google_apis;x86_64'
& D:\androidstudio\cmdline-tools\latest\bin\sdkmanager.bat --package_file=.pkg.txt
```

(`--package_file` avoids a PowerShell/cmd quirk that splits the `;`-separated package name into
four arguments.)

**Create the AVD** (this repo ships `apps/mobile/create-avd.cmd`, which does the same):

```powershell
echo y | & D:\androidstudio\cmdline-tools\latest\bin\avdmanager.bat create avd `
  -n chatgram_api34 -k "system-images;android-34;google_apis;x86_64" -d pixel_6 --force
```

Then tune `%USERPROFILE%\.android\avd\chatgram_api34.avd\config.ini`:

```ini
hw.ramSize=2048
hw.cpu.ncore=2
disk.dataPartition.size=4G
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader_indirect   ; use "auto" if the GPU keeps up, software is the stable choice
hw.keyboard=yes
hw.camera.front=emulated
showDeviceFrame=no
```

**Boot and free the host**

```powershell
D:\androidstudio\emulator\emulator.exe -avd chatgram_api34 `
  -no-window -no-audio -no-boot-anim -no-snapshot -no-snapshot-save `
  -memory 2048 -cores 2 -gpu swiftshader_indirect
```

- `-no-snapshot-save` keeps a clean state and avoids corrupt snapshots; `-memory 2048` caps the guest.
  (On this 11.7 GB PC the emulator logs `Increasing RAM size to 2560MB` - it raises the value itself
  when it thinks the host can spare it; that is normal, not an error.)
- Cold boot on this machine takes about **50 s** (`Boot completed in 50856 ms` in the emulator log).
- Only boot one emulator. Close Chrome, Slack, Docker and Android Studio while testing.
- The emulator **boots but is very slow with software graphics**: on this PC the Android system UI
  and `system_server` repeatedly show *"Process system isn't responding"* while the Chatgram app
  itself renders and runs. That is a host/emulator limit, not an app bug. If you need emulator
  testing beyond a smoke test, use a real phone.

**Make the emulator usable**

```powershell
$adb = 'D:\androidstudio\platform-tools\adb.exe'
& $adb shell wm size 720x1600; & $adb shell wm density 320          # far less GPU work
& $adb shell settings put global window_animation_scale 0
& $adb shell settings put global transition_animation_scale 0
& $adb shell settings put global animator_duration_scale 0
foreach ($p in 'com.google.android.gms','com.google.android.googlequicksearchbox','com.android.chrome',
               'com.google.android.youtube','com.google.android.apps.photos','com.google.android.gm') {
  & $adb shell pm disable-user --user 0 $p                            # kills the GMS ANRs
}
& $adb shell getprop sys.boot_completed   # 1 = booted
```

Install + launch exactly as on a phone. Cold-start measurement on this emulator for 1.1.2:
**3.9 s COLD** right after `force-stop` (`am start -W` TotalTime; 2.3 s in an earlier 1.1.1 run with
a warm WebView cache). The < 3 s target is
for a mid-range phone, which cannot be measured here.

**Command-line only path (no Android Studio at all):** everything above uses only
`sdkmanager.bat`, `avdmanager.bat`, `emulator.exe` and `adb.exe`. No Studio needed.

**If you do use Android Studio:** keep its heap at 2 GB in
`C:\Program Files\Android\Android Studio\bin\studio64.exe.vmoptions` (or
`%APPDATA%\Google\AndroidStudio<version>\studio64.exe.vmoptions` on newer installs):

```ini
-Xmx2048m
```

and keep Gradle at `-Xmx1536m` (already set in `apps/mobile/android/gradle.properties`, together with
`org.gradle.workers.max=2`, `org.gradle.parallel=false`). Do not raise these on 12 GB.

**Graphics:** start with Automatic; if the emulator shows black tiles or the UI glitches, switch to
Software (`-gpu swiftshader_indirect`). **Hyper-V / Windows Hypervisor Platform** must be on
(`emulator -accel-check` prints `WHPX ... is installed and usable` on this PC).

---

## 8. This build (1.1.2)

| | |
| --- | --- |
| Version | **1.1.2**, `versionCode` **3** (1.1.1 was `versionCode` 2; 1.1.0 was 1) |
| File | `release-artifacts/chatgram-android.apk` |
| Size | **1,116,911 bytes (1.07 MB)** - 1.1.0 was 4,127,661 bytes |
| SHA-256 | `03812cb5ecdc64b343860d7ded4f08b3c54ddad24be63673529e0517d72a1ceb` |
| applicationId | `app.chatgram.android` |
| minSdk / targetSdk / compileSdk | 24 / 34 / 36 |
| Signing | debug key (`C:\Users\mugis\.android\debug.keystore`), cert SHA-256 `8a67642f...152f` |
| Loads | `https://chatgram-xi.vercel.app/web/` (verified in logcat) |
| Built by | `apps/mobile/build-apk.ps1` (runs a FRESH `cap copy`) on 2026-10-27 |

`versionCode` was bumped to 3 for this build because a clean rebuild changes the APK bytes
(non-reproducible build + timestamps), and Android requires an increasing versionCode for updates:
any 1.1.1 (`versionCode 2`) test build already on a phone still updates in place to 1.1.2.

Verified with the emulator (Android 14 / API 34 Google APIs x86_64, 720x1600, software graphics):

- `adb install -r` over the installed 1.1.1 build -> **Success** (same key, in-place update).
- 1.1.0 (for comparison, historical): `FATAL EXCEPTION: main ... ClassNotFoundException:
  app.chatgram.android.MainActivity` - the app closed before drawing anything.
- 1.1.2 logcat: `Capacitor: Loading app at https://chatgram-xi.vercel.app/web/`, `App started`,
  **no FATAL / no ClassNotFoundException**; `topResumedActivity=app.chatgram.android/.MainActivity`.
- Rendering: the Chatgram sign-in screen (logo, "Welcome back", email/phone, password, Sign in,
  Continue with Google, Create account, Privacy/Terms/Help, version footer) - screenshot
  `docs/reports/android-1.1.2-launch.png`.
- Cold start `am start -W`: **Status ok, LaunchState COLD, TotalTime 3887 ms** on this
  software-rendered emulator (the very first launch after install timed out at ~12.8 s because the
  WebView initialises cold; a mid-range phone should be faster).
- `adb shell dumpsys package app.chatgram.android` -> `versionCode=3 versionName=1.1.2
  minSdk=24 targetSdk=34`.
- Offline behaviour (verified for 1.1.1, unchanged code): with Wi-Fi and mobile data off the app
  shows the local `error.html` ("Can't reach Chatgram", auto-retry, Try again) instead of a blank
  screen - logcat shows `Capacitor: Handling local request: https://localhost/error.html`.

**Not tested (needs a real phone or a second device):** sign-in with a real account, chat list,
sending a message, voice note, a 1:1 call with camera/mic permission prompts, joining a group,
Chatgram AI chat, back button from a deep page, keyboard resize with the real IME, in-app
notifications (the WebView has no Web Notification API - see gaps), and cold start on mid-range
hardware.

---

## 9. What 1.1.1 (carried into 1.1.2) changed for performance / size / usability

- **R8 (`minifyEnabled true`) + `shrinkResources true`** on a release build signed with the debug key
  - no `debuggable`, smaller dex. Kept classes in `app/proguard-rules.pro` (Capacitor runtime,
  `@JavascriptInterface` methods, `MainActivity` name).
- **Unused Capacitor plugins removed:** none were ever installed; the plugin list in the packaged
  config is `[]`, so the APK contains only the Capacitor core. Do not add plugins without a reason.
- **No bundled web snapshot** in the APK (it was 7 days stale and broken; the app loads the hosted
  client). The APK keeps only two tiny local pages.
- **WebView hardening** (`MainActivity`): normal HTTP cache (`LOAD_DEFAULT`, so a second start
  reuses the downloaded web client), `setMediaPlaybackRequiresUserGesture(false)` so voice notes and
  call audio play without an extra tap, `MIXED_CONTENT_NEVER_ALLOW`.
- **Splash without white flash:** Android 12+ splash API with the branded `#0B141A` colour, a dark
  window background behind the WebView, and `android.backgroundColor` set to the same colour.
- **Permissions only when needed:** INTERNET, ACCESS_NETWORK_STATE, CAMERA, RECORD_AUDIO,
  MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS. Camera/mic are requested by the WebView at the moment a
  call or voice note starts (Capacitor's `BridgeWebChromeClient.onPermissionRequest` maps them to the
  Android runtime prompt). The media/storage permissions from 1.1.0 were removed (the file picker
  uses the Storage Access Framework and needs none).
- **Keyboard:** `adjustResize` + `configChanges` incl. `keyboard|density|fontScale`.
- **Back button:** Capacitor's default (WebView history, then exit). No custom handling.
- **Admin dashboard in the app:** the web bundle code-splits every admin page
  (`apps/web/dist/static/AdminApp-*.js` and one chunk per admin page), so `/web/admin` never loads
  inside the app unless someone opens it manually. Nothing to do on the Android side.
- **Caching/preconnect:** the WebView HTTP cache handles repeat loads; `preconnect`/preload hints are
  a web-side (`apps/web`) concern, not changeable from the Android project.

---

## 10. Verify without a device

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
$apk = 'F:\projects\chatgram\release-artifacts\chatgram-android.apk'
D:\androidstudio\build-tools\36.0.0\aapt2.exe dump badging $apk | Select-String 'package:|sdkVersion'
D:\androidstudio\build-tools\36.0.0\aapt2.exe dump xmltree $apk --file AndroidManifest.xml | Select-String 'MainActivity|windowSoftInputMode'
D:\androidstudio\build-tools\36.0.0\apksigner.bat verify --print-certs $apk
D:\androidstudio\cmdline-tools\latest\bin\apkanalyzer.bat dex packages $apk | Select-String 'MainActivity'
(Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
```

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| App closes instantly / "Chatgram keeps stopping" | Launcher class not in the dex (the 1.1.0 bug) | Rebuild with `build-apk.ps1`; it verifies the class. Check `adb logcat` for `ClassNotFoundException`. |
| White screen, no error | Packaged config lost `server.url`, or the hosted page failed and there is no `errorPath` | The build script checks the packaged config; `error.html` handles offline. Check `adb logcat | Select-String 'Capacitor: Loading app at'`. |
| White screen after splash for a long time | Slow/mobile network, first load of the web client | Wait once (the WebView cache helps the next start), or test on Wi-Fi. |
| "App not installed" when updating | Different signing key, or `versionCode` not increased | Use the original `~/.android/debug.keystore`; bump `versionCode` for every release. |
| "Verify it's you" / login loop | Web login rejects the user (verification, throttle), not the APK | Sign in on the web first; the app is the same client. |
| Keyboard hides the composer | `adjustResize` missing or edge-to-edge on Android 15+ | 1.1.1 sets `adjustResize`; targetSdk is 34 on purpose. |
| Camera/mic never prompted | Android runtime permission denied earlier | Settings -> Apps -> Chatgram -> Permissions, allow Camera/Microphone. |
| "Unable to read public/cordova.js" in logcat | Capacitor Cordova compatibility layer, no Cordova plugins | Harmless; 1.1.1 ships empty stubs so it does not appear. |
| Emulator: "Process system isn't responding" | Emulator too slow (software graphics, 12 GB host) | Lower resolution (`wm size 720x1600`), disable GMS, or use a real phone. |

---

## 12. Owner steps

1. **Back up `C:\Users\mugis\.android\debug.keystore`** (+ alias `androiddebugkey`, password
   `android`). Without it, no APK update can be installed over an existing app.
2. Install `release-artifacts/chatgram-android.apk` on your phone (`adb install -r` or open the file
   and allow "install unknown apps" once). Do this once by hand; later versions can update over it.
3. Publish the new APK for the landing page: copy `release-artifacts/chatgram-android.apk` to the
   server's `/downloads/` (the `/downloads/*` route is proxied to the VM), then update
   `client/landing/content/site.mjs` (Android `version`, `sizeBytes`, SHA-256 if present) and
   `client/landing/content/guides.mjs` (the 4,127,661-byte/1.1.0 text), plus
   `client/landing/scripts/validate.mjs` (it hard-codes size 4127661 and version 1.1.0), and redeploy
   the landing/web build. **Not done in this session** - it needs the production deploy + the
   upload, and publishing a checksum for a file that is not on the server yet would be a lie.
   Values to publish for **1.1.2**: version **1.1.2**, versionCode **3**, size **1116911** bytes,
   SHA-256 `03812cb5ecdc64b343860d7ded4f08b3c54ddad24be63673529e0517d72a1ceb`.
4. Test the authenticated flows on your phone (sign-in, chat list, send a message, voice note, 1:1
   call with permissions, group join, Chatgram AI) and report anything that fails with a
   `adb logcat` excerpt.
5. Optionally delete the `chatgram_api34` AVD when done (`avdmanager delete avd -n chatgram_api34`) to
   free ~5 GB; the API 34 system image is at `D:\androidstudio\system-images\android-34`.

## 13. Known gaps

- **No push notifications in the app.** The Android WebView does not implement the Web Notification
  API, and no notification plugin is installed, so an incoming call or message while the app is in
  the background cannot raise a system notification. Needs a Capacitor notification plugin (or
  FCM) - unrelated to the 1.1.0 crash. POST_NOTIFICATIONS is declared for that future work.
- **No safe-area handling yet**, which is why targetSdk stays 34; see D59/D60.
- **Bundled/offline app is not built**: needs a Vite relative base + root router basename in
  `apps/web` (out of scope here).
- Cold start on a real mid-range phone, and every authenticated flow, is unverified (see 8).

