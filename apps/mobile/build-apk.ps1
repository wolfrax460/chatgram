# Chatgram Android - one-command sideload APK builder (Windows PowerShell 5.1+)
#
# Why this script exists: the 1.1.0 APK was broken because `cap copy` was never
# run after capacitor.config.json changed. The APK shipped an OLD config (no
# `server.url`) and a 7-day-old web build, and its launcher class did not exist
# at all (see docs/android-build.md). This script refuses to ship an APK whose
# packaged config, launcher class or version code is wrong.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File apps\mobile\build-apk.ps1
#   ... -SkipSync        reuse the assets already copied into android/
#   ... -DebugBuild      assembleDebug instead of the minified release build
#
# Output: release-artifacts\chatgram-android.apk (+ printed size and SHA-256)
#
# NEVER replace the debug keystore: already installed apps only accept updates
# signed with the SAME key. Back up C:\Users\<you>\.android\debug.keystore and
# read docs/android-build.md.

[CmdletBinding()]
param(
    [string]$SdkRoot   = 'D:\androidstudio',
    [string]$JavaHome  = 'C:\Program Files\Android\openjdk\jdk-21.0.8',
    [string]$GradleBat = '',                       # default: cached 9.3.1 distribution
    [switch]$SkipSync,
    [switch]$DebugBuild
)

$ErrorActionPreference = 'Stop'

$mobileDir    = $PSScriptRoot
$repoDir      = Split-Path -Parent (Split-Path -Parent $mobileDir)   # apps/mobile -> apps -> repo
$androidDir   = Join-Path $mobileDir 'android'
$appDir       = Join-Path $androidDir 'app'
$assetsPublic = Join-Path $appDir 'src\main\assets\public'
$fallbackDir  = Join-Path $mobileDir 'native-fallback'
$keystore     = Join-Path $env:USERPROFILE '.android\debug.keystore'
$outputApk    = Join-Path $repoDir 'release-artifacts\chatgram-android.apk'

function Step([string]$text) { Write-Host ""; Write-Host "=== $text" -ForegroundColor Cyan }
function Ok([string]$text)   { Write-Host "  OK   $text" -ForegroundColor Green }
function Fail([string]$text) { throw $text }

# --------------------------------------------------------------- prerequisites
Step 'Checking the toolchain'
if (-not (Test-Path $keystore)) {
    Fail "Debug keystore missing: $keystore. Restore the BACKUP of the original keystore. A freshly generated one changes the signature and installed Chatgram apps will refuse the update."
}
Ok "debug keystore $keystore"

if (Test-Path (Join-Path $JavaHome 'bin\java.exe')) {
    $env:JAVA_HOME = $JavaHome
    $env:PATH = (Join-Path $JavaHome 'bin') + ';' + $env:PATH
} else {
    Write-Warning "JDK not found at $JavaHome - falling back to the existing JAVA_HOME/PATH"
}
Ok "JAVA_HOME=$env:JAVA_HOME"

$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:PATH = (Join-Path $SdkRoot 'platform-tools') + ';' + $env:PATH
Ok "ANDROID_HOME=$SdkRoot"

$buildTools = Get-ChildItem (Join-Path $SdkRoot 'build-tools') -Directory |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { Fail "No build-tools in $SdkRoot\build-tools" }
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$aapt2     = Join-Path $buildTools.FullName 'aapt2.exe'
Ok "build-tools $($buildTools.Name)"

if (-not $GradleBat) {
    $cached = Get-ChildItem (Join-Path $env:USERPROFILE '.gradle\wrapper\dists') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'gradle-9.3.1-*' } |
        ForEach-Object { Get-ChildItem $_.FullName -Directory -Filter 'gradle-9.3.1' -ErrorAction SilentlyContinue } |
        Select-Object -First 1
    if ($cached) { $GradleBat = Join-Path $cached.FullName 'bin\gradle.bat' }
}
if (-not $GradleBat -or -not (Test-Path $GradleBat)) { $GradleBat = Join-Path $androidDir 'gradlew.bat' }
Ok "gradle $GradleBat"

if (-not (Test-Path (Join-Path $repoDir 'apps\web\dist\index.html'))) {
    Write-Warning 'apps/web/dist is missing - cap copy will keep whatever assets are already in android/'
}

# ------------------------------------------------------- config sanity check
Step 'Checking capacitor.config.json'
$configPath = Join-Path $mobileDir 'capacitor.config.json'
$config = Get-Content $configPath -Raw | ConvertFrom-Json
if ($config.appId -ne 'app.chatgram.android') {
    Fail "capacitor.config.json appId is '$($config.appId)', expected app.chatgram.android (must match the Gradle namespace/applicationId)."
}
if (-not $config.server.url) {
    Fail 'capacitor.config.json has no server.url - the app would load the bundled assets and show a blank screen. This is exactly the 1.1.0 bug.'
}
Ok "appId $($config.appId), server.url $($config.server.url)"

# -------------------------------------------------------------- copy web assets
if (-not $SkipSync) {
    Step 'Running cap copy (syncs capacitor.config.json + web assets into android/)'
    $capCli = Join-Path $mobileDir 'node_modules\@capacitor\cli\bin\capacitor'
    if (-not (Test-Path $capCli)) { Fail "Capacitor CLI missing: $capCli (run npm install in apps/mobile)" }
    Push-Location $mobileDir
    try {
        & node $capCli copy android
        if ($LASTEXITCODE -ne 0) { Fail "cap copy failed with exit code $LASTEXITCODE" }
    }
    finally { Pop-Location }
    Ok 'cap copy finished'
} else {
    Step 'Skipping cap copy (-SkipSync)'
}

# the packaged config is what the APK actually reads at runtime
$packagedConfig = Get-Content (Join-Path $appDir 'src\main\assets\capacitor.config.json') -Raw | ConvertFrom-Json
if (-not $packagedConfig.server.url) {
    Fail 'The PACKAGED assets/capacitor.config.json has no server.url - cap copy did not run or the config was edited after it. Refusing to build a blank-screen APK.'
}
if ($packagedConfig.appId -ne 'app.chatgram.android') {
    Fail "Packaged appId is '$($packagedConfig.appId)', expected app.chatgram.android."
}
Ok "packaged config appId $($packagedConfig.appId), server.url $($packagedConfig.server.url)"

# ---------------------------------------------- local fallback / error page
Step 'Installing the offline fallback pages'
if (-not (Test-Path $assetsPublic)) { New-Item -ItemType Directory -Path $assetsPublic -Force | Out-Null }
# The app loads the hosted client, so the copied web bundle is dead weight:
# dropping it keeps the APK small and means a stale snapshot can never be shown.
foreach ($junk in @('static', 'assets', 'chatgram-icon.svg')) {
    $p = Join-Path $assetsPublic $junk
    if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}
# Capacitor logs "Unable to read public/cordova.js" when these two stubs are
# missing; they are empty files, so keep them to keep logcat clean.
foreach ($stub in @('cordova.js', 'cordova_plugins.js')) {
    $p = Join-Path $assetsPublic $stub
    if (-not (Test-Path $p)) { New-Item -ItemType File -Path $p -Force | Out-Null }
}
Copy-Item (Join-Path $fallbackDir 'index.html') (Join-Path $assetsPublic 'index.html') -Force
Copy-Item (Join-Path $fallbackDir 'error.html') (Join-Path $assetsPublic 'error.html') -Force
$fallbackKb = [math]::Round(((Get-ChildItem $assetsPublic -File | Measure-Object Length -Sum).Sum) / 1KB, 1)
Ok "fallback index.html + error.html in assets/public ($fallbackKb KB)"

# ------------------------------------------------------------------- build
$task = 'assembleRelease'
$variant = 'release'
if ($DebugBuild) { $task = 'assembleDebug'; $variant = 'debug' }
Step "Building $task (Gradle memory is limited in android/gradle.properties for a 12 GB PC)"
Push-Location $androidDir
try {
    & $GradleBat $task --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { Fail "Gradle $task failed with exit code $LASTEXITCODE" }
}
finally { Pop-Location }

$builtApk = Join-Path $appDir "build\outputs\apk\$variant\app-$variant.apk"
if (-not (Test-Path $builtApk)) { Fail "APK not found: $builtApk" }
Ok "built $builtApk"

# ------------------------------------------------------------- verification
Step 'Verifying the APK'
$badging = & $aapt2 dump badging $builtApk
$pkgLine = ($badging | Select-String -Pattern '^package:' | Select-Object -First 1).Line
Write-Host "  $pkgLine"
if ($pkgLine -notmatch "name='app\.chatgram\.android'") { Fail 'Wrong applicationId in the APK' }
if ($pkgLine -notmatch "versionCode='5'") {
    Fail "Unexpected versionCode (expected 5). Bump versionCode for every release or Android refuses the update: $pkgLine"
}

$tree = & $aapt2 dump xmltree $builtApk --file AndroidManifest.xml
$activityLine = ($tree | Select-String -Pattern 'MainActivity' | Select-Object -First 1).Line
Write-Host "  $activityLine"
$activityMatch = [regex]::Match($activityLine, '="([a-zA-Z0-9_.]+MainActivity)"')
if (-not $activityMatch.Success) { Fail 'Could not find the launcher activity in the manifest' }
$activityClass = $activityMatch.Groups[1].Value
Ok "launcher activity $activityClass"

# The 1.1.0 APK declared app.chatgram.android.MainActivity but only shipped
# com.chatgram.app.MainActivity -> ClassNotFoundException on every launch.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($builtApk)
try {
    $needle = $activityClass.Replace('.', '/')
    $found = $false
    foreach ($entry in ($zip.Entries | Where-Object { $_.FullName -like 'classes*.dex' })) {
        $stream = $entry.Open()
        $reader = New-Object System.IO.StreamReader($stream)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose(); $stream.Dispose() }
        if ($text.Contains($needle)) { $found = $true; break }
    }
    if (-not $found) {
        Fail "The dex does not contain $needle but the manifest launches it - the app would crash on start (exactly the 1.1.0 bug)."
    }
    Ok "dex contains $needle"

    $cfgEntry = $zip.Entries | Where-Object { $_.FullName -eq 'assets/capacitor.config.json' }
    if (-not $cfgEntry) { Fail 'APK has no assets/capacitor.config.json' }
    $stream = $cfgEntry.Open()
    $reader = New-Object System.IO.StreamReader($stream)
    try { $apkConfigText = $reader.ReadToEnd() } finally { $reader.Dispose(); $stream.Dispose() }
    $apkConfig = $apkConfigText | ConvertFrom-Json
    if (-not $apkConfig.server.url) { Fail 'APK config has no server.url -> blank screen' }
    Ok "APK config server.url $($apkConfig.server.url)"
}
finally { $zip.Dispose() }

$certLine = (& $apksigner verify --print-certs $builtApk | Select-String 'SHA-256 digest' | Select-Object -First 1).Line
Write-Host "  $certLine"

# Copy to the release folder used by the landing page download.
New-Item -ItemType Directory -Path (Split-Path -Parent $outputApk) -Force | Out-Null
Copy-Item $builtApk $outputApk -Force
$size = (Get-Item $outputApk).Length
$sha  = (Get-FileHash $outputApk -Algorithm SHA256).Hash.ToLower()

Step 'Done'
Write-Host ("  APK     : {0}" -f $outputApk)
Write-Host ("  size    : {0:N0} bytes ({1:N2} MB)" -f $size, ($size / 1MB))
Write-Host ("  sha256  : {0}" -f $sha)
Write-Host  '  version : 1.1.4 (versionCode 5), applicationId app.chatgram.android'
Write-Host ''
Write-Host '  Install on a phone with USB debugging:  adb install -r release-artifacts\chatgram-android.apk'
Write-Host '  BACK UP C:\Users\<you>\.android\debug.keystore - without it updates fail.' -ForegroundColor Yellow

exit 0
