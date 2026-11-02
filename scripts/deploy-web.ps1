<#
  Build and deploy the landing page, the web app (/web/) and the static
  terms/privacy page (/docs/) to Vercel in one go.

  WHY THIS SCRIPT EXISTS
  ----------------------
  A plain `vercel --prod` from client/landing makes Vercel run its own build
  (`vite build`) from the uploaded source. That build wipes `dist/` (Vite uses
  emptyOutDir), which silently deletes the `dist/web` folder we had copied the
  app into — so the landing updated but `/web/` returned 404.

  The reliable way is the Build Output API: assemble `.vercel/output/static`
  ourselves and deploy with `--prebuilt`, so Vercel uploads exactly what we
  built and never re-runs a build.

  Usage (from anywhere):
      powershell -ExecutionPolicy Bypass -File scripts/deploy-web.ps1

  DOMAIN MOVE (all switches default OFF; the plain command above is unchanged)
  ---------------------------------------------------------------------------
  -SiteUrl <url>   Passes SITE_URL into the landing build (canonical, hreflang,
                   OG/Twitter, JSON-LD, sitemap, robots and the APK QR code).
                   Omit it to keep building for the current host.

  -EnableRedirect   Adds 308 host redirects (old host -> the new home) to the
                   Build Output config *after* proving the new home is live.
                   Vercel preserves the query string on redirects, so
                   /join?invite=... and /web/#... keep their parameters/anchors.
                   The redirect list is an allow-list of landing pages only:
                   /api/*, /downloads/*, release/version endpoints, latest.yml,
                   checksums.txt and the installer/APK paths are NEVER touched,
                   because installed Android/Windows builds must keep using the
                   old host until they are rebuilt.

  -IncludeWebApp    With -EnableRedirect, also redirects /web and /web/(.*).
                   Only pass this after every installed Android/Windows build
                   loads the new host; otherwise those apps break.

  ONE-STEP CUTOVER (after DNS + Vercel domain + TLS for https://chatgram.qd.je
  are all live):
      powershell -ExecutionPolicy Bypass -File scripts/deploy-web.ps1 `
        -SiteUrl https://chatgram.qd.je -EnableRedirect

  Rollback: rerun the script without switches (canonical returns to the current
  host, redirects disappear). The redirect only exists in the deployment that
  contains it, so any earlier deployment is a rollback too.
#>
param(
  [switch]$SkipBuild,
  [string]$SiteUrl = '',
  [switch]$EnableRedirect,
  [switch]$IncludeWebApp
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$landing = Join-Path $repo 'client\landing'
$dist = Join-Path $landing 'dist'
$output = Join-Path $landing '.vercel\output'

# The new home. The redirect destination defaults to it; -SiteUrl overrides it
# (e.g. for a www/apex swap) and is what the landing build treats as canonical.
$newHome = 'https://chatgram.qd.je'
$redirectTarget = $newHome

if ($SiteUrl) {
  $parsedSiteUrl = $null
  if (-not [System.Uri]::TryCreate($SiteUrl, [System.UriKind]::Absolute, [ref]$parsedSiteUrl)) {
    throw "-SiteUrl is not an absolute URL: $SiteUrl"
  }
  if ($parsedSiteUrl.Scheme -ne 'https') { throw "-SiteUrl must use https:// (got $SiteUrl)" }
  if ($parsedSiteUrl.Query -or $parsedSiteUrl.Fragment) { throw '-SiteUrl must not contain a query string or hash' }
  $redirectTarget = $parsedSiteUrl.GetLeftPart([System.UriPartial]::Authority)
}

if ($IncludeWebApp -and -not $EnableRedirect) {
  throw '-IncludeWebApp only makes sense together with -EnableRedirect'
}

# ---------------------------------------------------------------------------
# Build Output API config
# ---------------------------------------------------------------------------
# Route-level headers + proxies are unchanged from the previous script. The
# redirects array is assembled below; it is EMPTY unless -EnableRedirect.
$routes = @(
  @{
    src = '/(.*)'
    headers = @{ 'Permissions-Policy' = 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)' }
    continue = $true
  },
  @{ src = '/static/(.*)'; headers = @{ 'cache-control' = 'public, max-age=31536000, immutable' }; continue = $true },
  @{ src = '/web/static/(.*)'; headers = @{ 'cache-control' = 'public, max-age=31536000, immutable' }; continue = $true },
  @{ src = '/assets/(.*)'; headers = @{ 'cache-control' = 'public, max-age=3600' }; continue = $true },
  @{ src = '/web(/.*)?'; headers = @{ 'X-Robots-Tag' = 'noindex, nofollow' }; continue = $true },
  @{ src = '/api/(.*)'; headers = @{ 'X-Robots-Tag' = 'noindex, nofollow' }; continue = $true },
  @{ src = '/api/(.*)'; dest = 'https://chatgram.duckdns.org/api/$1' },
  @{ src = '/downloads/(.*)'; dest = 'https://chatgram.duckdns.org/downloads/$1' },
  @{ src = '/rw/?'; dest = '/rw/index.html' },
  @{ src = '/fr/?'; dest = '/fr/index.html' },
  @{ src = '/sw/?'; dest = '/sw/index.html' },
  @{ handle = 'filesystem' },
  @{ src = '/web(/.*)?'; dest = '/web/index.html' },
  @{ src = '/docs(/.*)?'; dest = '/docs/index.html' },
  @{ src = '/(.*)'; dest = '/404.html'; status = 404 }
)

# These two stay in every deployment (they are same-deployment rewrites, not
# domain redirects).
$redirects = @(
  @{ source = '/app'; destination = '/web/'; permanent = $false },
  @{ source = '/app/(.*)'; destination = '/web/'; permanent = $false }
)

$oldHost = 'chatgram-xi.vercel.app'
$hostCondition = @(@{ type = 'host'; value = $oldHost })

# Landing-page allow-list, as source -> destination-path pairs so the new home
# always receives the canonical path (e.g. /rw -> /rw/). Everything that serves a
# real file an installed app depends on (API, downloads, release feed,
# version.json, latest.yml, checksums.txt, installers) is deliberately absent
# from this list, so it can never be redirected by accident.
$pageRedirects = @(
  @{ source = '/'; destinationPath = '/' },
  @{ source = '/rw'; destinationPath = '/rw/' },
  @{ source = '/rw/'; destinationPath = '/rw/' },
  @{ source = '/fr'; destinationPath = '/fr/' },
  @{ source = '/fr/'; destinationPath = '/fr/' },
  @{ source = '/sw'; destinationPath = '/sw/' },
  @{ source = '/sw/'; destinationPath = '/sw/' },
  @{ source = '/docs'; destinationPath = '/docs/' },
  @{ source = '/docs/'; destinationPath = '/docs/' },
  @{ source = '/sitemap.xml'; destinationPath = '/sitemap.xml' },
  @{ source = '/robots.txt'; destinationPath = '/robots.txt' },
  @{ source = '/site.webmanifest'; destinationPath = '/site.webmanifest' },
  @{ source = '/favicon.ico'; destinationPath = '/favicon.ico' },
  @{ source = '/guides/how-to-use-chatgram.html'; destinationPath = '/guides/how-to-use-chatgram.html' },
  @{ source = '/guides/chatgram-android-download-install.html'; destinationPath = '/guides/chatgram-android-download-install.html' },
  @{ source = '/guides/chatgram-windows-download-smartscreen.html'; destinationPath = '/guides/chatgram-windows-download-smartscreen.html' },
  @{ source = '/guides/chatgram-ai-four-languages.html'; destinationPath = '/guides/chatgram-ai-four-languages.html' }
)

if ($EnableRedirect) {
  foreach ($pageRedirect in $pageRedirects) {
    $redirects += @{
      source = $pageRedirect.source
      has = $hostCondition
      destination = "$redirectTarget$($pageRedirect.destinationPath)"
      permanent = $true
    }
  }

  # /web/ is only redirected when every installed shell has been rebuilt to the
  # new host; Android 1.1.7 and Windows 1.1.6 still load the old /web/ URL.
  if ($IncludeWebApp) {
    foreach ($source in @('/web', '/web/')) {
      $redirects += @{ source = $source; has = $hostCondition; destination = "$redirectTarget/web/"; permanent = $true }
    }
    $redirects += @{ source = '/web/:path*'; has = $hostCondition; destination = "$redirectTarget/web/:path*"; permanent = $true }
  }

  # Safety rail (b): refuse to emit any redirect that touches the paths installed
  # clients, the API proxy or the download/update feeds depend on.
  $forbidden = '(^|/)(api|downloads)(/|$)|version\.json|/version($|/)|latest\.yml|checksums\.txt|\.apk($|/)|\.exe($|/)'
  foreach ($entry in $redirects) {
    if ($entry.source -match $forbidden) {
      throw "Refusing to write redirect for a protected path: $($entry.source)"
    }
  }
  if (-not $IncludeWebApp) {
    foreach ($entry in $redirects) {
      if ($entry.source -match '^/web($|/)') {
        throw 'Refusing to redirect /web without -IncludeWebApp'
      }
    }
  }
}

$configObject = [ordered]@{
  version = 3
  routes = $routes
  redirects = $redirects
}
$config = ($configObject | ConvertTo-Json -Depth 12)
# Fail loudly here rather than letting Vercel reject the deployment later.
$null = $config | ConvertFrom-Json

# Never bake a local dev API URL into the production bundle: Vite loads
# apps/web/.env.local for `npm run build` too. Dev-only values belong in
# apps/web/.env.development.local (loaded in dev mode only).
if (Test-Path (Join-Path $repo 'apps\web\.env.local')) {
  throw 'apps/web/.env.local exists - remove it (use apps/web/.env.development.local for dev) before deploying'
}

# Safety rail (a): only redirect after the new home answers 200 over a valid
# TLS certificate and really serves the Chatgram landing page. Nothing is
# written and nothing is deployed when this probe fails.
if ($EnableRedirect) {
  Write-Host "==> checking the new home before enabling redirects: $redirectTarget/" -ForegroundColor Cyan
  $probe = $null
  try {
    $probe = Invoke-WebRequest -Uri "$redirectTarget/" -UseBasicParsing -TimeoutSec 30
  } catch {
    throw "Refusing to enable redirects: $redirectTarget/ is not reachable over HTTPS with a valid certificate ($($_.Exception.Message))"
  }
  if ($probe.StatusCode -ne 200) {
    throw "Refusing to enable redirects: $redirectTarget/ returned $($probe.StatusCode) instead of 200"
  }
  if ($probe.Content -notmatch 'Chatgram') {
    throw "Refusing to enable redirects: $redirectTarget/ does not look like the Chatgram landing page (marker 'Chatgram' not found)"
  }
  Write-Host '  new home is 200, TLS valid, landing marker found' -ForegroundColor Green
  if (-not $SiteUrl) {
    Write-Warning 'Redirect is enabled but -SiteUrl was not passed: canonical/OG/JSON-LD still point at the old host. Use -SiteUrl <new-home> for a consistent cutover.'
  }
}

$previousSiteUrl = $env:SITE_URL
$previousViteSiteUrl = $env:VITE_SITE_URL
if ($SiteUrl) {
  $env:SITE_URL = $SiteUrl
  # The web app's share/invite links fall back to VITE_SITE_URL; keep it aligned
  # with the landing origin on a custom-domain build.
  $env:VITE_SITE_URL = $SiteUrl
}

try {
  if (-not $SkipBuild) {
    Write-Host '==> building landing page' -ForegroundColor Cyan
    if ($SiteUrl) { Write-Host "    SITE_URL=$SiteUrl" -ForegroundColor DarkGray }
    npm run build --prefix client/landing
    if ($LASTEXITCODE -ne 0) { throw 'landing build failed' }

    Write-Host '==> building web app' -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
  }

  Write-Host '==> assembling dist/web' -ForegroundColor Cyan
  Remove-Item -Recurse -Force (Join-Path $dist 'web') -ErrorAction SilentlyContinue
  Copy-Item -Recurse (Join-Path $repo 'apps\web\dist') (Join-Path $dist 'web')

  Write-Host '==> assembling .vercel/output (Build Output API)' -ForegroundColor Cyan
  Remove-Item -Recurse -Force $output -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path (Join-Path $output 'static') -Force | Out-Null
  Copy-Item -Recurse -Path (Join-Path $dist '*') -Destination (Join-Path $output 'static')
  # Write without a BOM: Vercel rejects a config.json it cannot parse.
  [System.IO.File]::WriteAllText((Join-Path $output 'config.json'), $config, (New-Object System.Text.UTF8Encoding($false)))

  # Guard: never deploy without the app and the static docs page.
  foreach ($required in @('..\config.json', 'index.html', 'web\index.html', 'docs\index.html', 'assets\apk-qr.svg')) {
    if (-not (Test-Path (Join-Path $output "static\$required"))) {
      throw "prebuilt output is missing $required - refusing to deploy"
    }
  }

  Write-Host '==> deploying (prebuilt)' -ForegroundColor Cyan
  Set-Location $landing
  npx vercel --prod --yes --prebuilt
  if ($LASTEXITCODE -ne 0) { throw 'vercel deploy failed' }

  Write-Host '==> verifying production' -ForegroundColor Cyan
  $base = if ($SiteUrl) { $SiteUrl } else { 'https://chatgram-xi.vercel.app' }
  $failures = 0
  foreach ($path in @('/', '/web/', '/web/admin', '/docs/')) {
    try {
      $r = Invoke-WebRequest -Uri "$base$path" -UseBasicParsing -TimeoutSec 30
      Write-Host ("  {0,-14} {1}" -f $path, $r.StatusCode) -ForegroundColor Green
    } catch {
      Write-Host ("  {0,-14} FAILED {1}" -f $path, $_.Exception.Message) -ForegroundColor Red
      $failures += 1
    }
  }
  if ($failures -gt 0) { throw "$failures production checks failed" }

  # The web app calls `/api/...` on its own origin (required for the SameSite=Strict
  # admin cookie and for streaming answers): prove the proxy really forwards to the
  # API instead of the SPA fallback returning the HTML shell.
  Write-Host '==> verifying the /api proxy' -ForegroundColor Cyan
  $health = $null
  try {
    $health = Invoke-RestMethod -Uri "$base/api/status/health" -TimeoutSec 30
  } catch {
    throw "API proxy GET failed: $($_.Exception.Message)"
  }
  if (-not $health.ok) { throw "API proxy returned an unhealthy status: $($health | ConvertTo-Json -Compress)" }
  Write-Host '  GET  /api/status/health  ok' -ForegroundColor Green

  # The desktop auto-updater and the landing downloads read through this route.
  try {
    $latest = Invoke-WebRequest -Uri "$base/downloads/latest.yml" -UseBasicParsing -TimeoutSec 60
    if ($latest.StatusCode -ne 200) { throw "latest.yml returned $($latest.StatusCode)" }
  } catch {
    throw "downloads proxy failed: $($_.Exception.Message)"
  }
  Write-Host '  GET  /downloads/latest.yml  ok' -ForegroundColor Green

  $postStatus = 0
  try {
    Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST -UseBasicParsing -TimeoutSec 30 `
      -ContentType 'application/json' -Body '{"identifier":"deploy-check@chatgram.test","password":"not-a-real-password"}' | Out-Null
  } catch {
    $postStatus = [int]$_.Exception.Response.StatusCode
  }
  if ($postStatus -ne 401) { throw "API proxy POST returned $postStatus (expected 401) - /api is not being proxied" }
  Write-Host '  POST /api/auth/login     forwards (401 as expected)' -ForegroundColor Green

  if ($EnableRedirect) {
    Write-Host '==> verifying gated 308 redirects (old host)' -ForegroundColor Cyan
    $oldBase = 'https://chatgram-xi.vercel.app'
    $expectStatus = 308
    $redirectChecks = @(
      @{ path = '/'; expected = 308 },
      @{ path = '/rw/'; expected = 308 },
      @{ path = '/guides/how-to-use-chatgram.html'; expected = 308 },
      @{ path = '/api/status/health'; expected = 200 },
      @{ path = '/downloads/latest.yml'; expected = 200 },
      @{ path = '/web/version.json'; expected = 200 },
      @{ path = '/web/'; expected = $(if ($IncludeWebApp) { 308 } else { 200 }) }
    )
    $redirectFailures = 0
    foreach ($check in $redirectChecks) {
      try {
        $response = Invoke-WebRequest -Uri "$oldBase$($check.path)" -UseBasicParsing -TimeoutSec 30 -MaximumRedirection 0
        $status = [int]$response.StatusCode
      } catch {
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode } else { $status = 0 }
      }
      $ok = $status -eq $check.expected
      if (-not $ok) { $redirectFailures += 1 }
      $color = if ($ok) { 'Green' } else { 'Red' }
      Write-Host ("  {0,-40} {1} (expected {2})" -f $check.path, $status, $check.expected) -ForegroundColor $color
    }
    if ($redirectFailures -gt 0) { throw "$redirectFailures redirect checks failed" }
  }

  Write-Host 'deploy OK' -ForegroundColor Green
} finally {
  if ($null -eq $previousSiteUrl) { Remove-Item Env:\SITE_URL -ErrorAction SilentlyContinue } else { $env:SITE_URL = $previousSiteUrl }
  if ($null -eq $previousViteSiteUrl) { Remove-Item Env:\VITE_SITE_URL -ErrorAction SilentlyContinue } else { $env:VITE_SITE_URL = $previousViteSiteUrl }
}
