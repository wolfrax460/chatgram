@echo off
REM Creates the lightweight emulator used for testing Chatgram on a 12 GB PC.
REM Android 14 (API 34) Google APIs x86_64 image, Pixel 6 profile, 2048 MB RAM,
REM 2 CPU cores, 4 GB data partition - see docs/android-build.md.
setlocal
set JAVA_HOME=C:\Program Files\Android\openjdk\jdk-21.0.8
set ANDROID_HOME=D:\androidstudio
set ANDROID_SDK_ROOT=D:\androidstudio
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%

echo y | "%ANDROID_HOME%\cmdline-tools\latest\bin\avdmanager.bat" create avd ^
  -n chatgram_api34 ^
  -k "system-images;android-34;google_apis;x86_64" ^
  -d pixel_6 ^
  --force
echo AVD_CREATE_EXIT=%ERRORLEVEL%
endlocal
