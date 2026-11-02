<#
  Build and publish the static Chatgram site to the Oracle VM for the
  chatgram.qd.je virtual host, in parallel with the Vercel deployment.

  WHY THIS SCRIPT EXISTS
  ----------------------
  The Vercel deployment publishes a Build Output API bundle: the landing build
  (client/landing/dist) with the React app copied in as /web/. Vercel applies
  the routes itself. The Oracle VM has no Vercel, so nginx has to reproduce
  those routes and the same static tree has to land on disk.

  This script produces exactly the tree that scripts/deploy-web.ps1 writes to
  client/landing/.vercel/output/static, uploads it as one archive over scp and
  swaps it in atomically:

      upload -> /var/www/chatgram-site.new
      verify the required entry points inside .new
      move the live dir to /var/www/chatgram-site.old
      move .new into place

  A failed upload, a truncated archive or a missing /web/index.html therefore
  can never leave a half-written site: the old directory keeps serving until
  the new one has been verified, and the previous tree remains as .old.

  WHAT IT DOES NOT DO
  -------------------
  - It never touches scripts/deploy-web.ps1, the Vercel project, DNS, TLS or
    the duckdns vhost. The nginx site itself is deploy/nginx/chatgram.qd.je.conf
    and is installed once by hand (see that file's header).
  - It never touches /var/www/downloads or the API process (no PM2 restart).

  Usage (from anywhere):
      powershell -ExecutionPolicy Bypass -File scripts/deploy-web-vm.ps1
      powershell -ExecutionPolicy Bypass -File scripts/deploy-web-vm.ps1 -SkipBuild
      powershell -ExecutionPolicy Bypass -File scripts/deploy-web-vm.ps1 -SiteUrl https://chatgram.qd.je

  -SkipBuild reuses the existing client/landing/dist + apps/web/dist (falling
  back to client/landing/.vercel/output/static only when dist is absent) and
  only re-assembles and re-uploads the tree.

  -SiteUrl is passed through as SITE_URL (and VITE_SITE_URL) during the landing
  and web builds, exactly like scripts/deploy-web.ps1 does. Run it only after
  https://chatgram.qd.je has DNS + TLS; until then the default (no override)
  produces the same canonical URLs as the current Vercel build.

  SSH: the key must be readable only by you. The deploy key is expected at
  %USERPROFILE%\cg-key.pem (override with -SshKey).
#>
param(
  [switch]$SkipBuild,
  [string]$SiteUrl = '',
  [string]$VmHost = 'ubuntu@84.12.64.204',
  [string]$SshKey = (Join-Path $env:USERPROFILE 'cg-key.pem'),
  [string]$RemoteRoot = '/var/www/chatgram-site',
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$landing = Join-Path $repo 'client\landing'
$dist = Join-Path $landing 'dist'
$prebuilt = Join-Path $landing '.vercel\output\static'
$outDir = Join-Path $landing '.vm-output'
$staging = Join-Path $outDir 'chatgram-site'
$archive = Join-Path $outDir 'chatgram-site.tar.gz'
$installer = Join-Path $outDir 'install-vm-site.sh'
$verifier = Join-Path $outDir 'verify-vm-site.sh'

$remoteArchive = '/tmp/chatgram-site.tar.gz'
$remoteInstaller = '/tmp/chatgram-install-vm-site.sh'
$remoteVerifier = '/tmp/chatgram-verify-vm-site.sh'

# The static tree Vercel needs, plus the entry points nginx serves directly.
$requiredEntries = @(
  'index.html',
  'web\index.html',
  'docs\index.html',
  'assets\apk-qr.svg',
  'sitemap.xml',
  'robots.txt',
  '404.html',
  'site.webmanifest'
)

if (-not (Test-Path $SshKey)) {
  throw "SSH key not found: $SshKey (copy the deploy key there and lock its ACL, or pass -SshKey)"
}

if ($SiteUrl) {
  $parsedSiteUrl = $null
  if (-not [System.Uri]::TryCreate($SiteUrl, [System.UriKind]::Absolute, [ref]$parsedSiteUrl)) {
    throw "-SiteUrl is not an absolute URL: $SiteUrl"
  }
  if ($parsedSiteUrl.Scheme -ne 'https') { throw "-SiteUrl must use https:// (got $SiteUrl)" }
  if ($parsedSiteUrl.Query -or $parsedSiteUrl.Fragment) { throw '-SiteUrl must not contain a query string or hash' }
}

# ---------------------------------------------------------------------------
# Build (or reuse) the same sources the Vercel script builds.
# ---------------------------------------------------------------------------
$previousSiteUrl = $env:SITE_URL
$previousViteSiteUrl = $env:VITE_SITE_URL
try {
  if (-not $SkipBuild) {
    if ($SiteUrl) {
      $env:SITE_URL = $SiteUrl
      # The web app's share/invite links fall back to VITE_SITE_URL; keep it
      # aligned with the landing origin on a custom-domain build.
      $env:VITE_SITE_URL = $SiteUrl
      Write-Host "    SITE_URL=$SiteUrl" -ForegroundColor DarkGray
    }

    Write-Host '==> building landing page' -ForegroundColor Cyan
    npm run build --prefix client/landing
    if ($LASTEXITCODE -ne 0) { throw 'landing build failed' }

    Write-Host '==> building web app' -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
  } else {
    Write-Host '==> -SkipBuild: reusing the existing prebuilt output' -ForegroundColor DarkGray
  }

  # -------------------------------------------------------------------------
  # Assemble the identical static tree.
  # -------------------------------------------------------------------------
  Write-Host '==> assembling the static tree' -ForegroundColor Cyan
  Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $staging | Out-Null

  $distReady = (Test-Path (Join-Path $dist 'index.html')) -and (Test-Path (Join-Path $repo 'apps\web\dist\index.html'))
  $prebuiltReady = (Test-Path (Join-Path $prebuilt 'index.html')) -and (Test-Path (Join-Path $prebuilt 'web\index.html'))
  if ($SkipBuild -and -not $distReady -and $prebuiltReady) {
    # No dist tree (e.g. a clean checkout): reuse the last Vercel Build Output.
    Write-Host '    source: client/landing/.vercel/output/static (last Vercel build)' -ForegroundColor DarkGray
    Copy-Item -Recurse -Force (Join-Path $prebuilt '*') $staging
  } else {
    if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw 'client/landing/dist/index.html is missing - run without -SkipBuild' }
    if (-not (Test-Path (Join-Path $repo 'apps\web\dist\index.html'))) { throw 'apps/web/dist/index.html is missing - run without -SkipBuild' }
    Write-Host '    source: client/landing/dist + apps/web/dist' -ForegroundColor DarkGray
    Copy-Item -Recurse -Force (Join-Path $dist '*') $staging
    Remove-Item -Recurse -Force (Join-Path $staging 'web') -ErrorAction SilentlyContinue
    Copy-Item -Recurse -Force (Join-Path $repo 'apps\web\dist') (Join-Path $staging 'web')
  }

  foreach ($entry in $requiredEntries) {
    if (-not (Test-Path (Join-Path $staging $entry))) {
      throw "assembled tree is missing $entry - refusing to upload"
    }
  }

  # -------------------------------------------------------------------------
  # One archive: far fewer round-trips than scp -r over the flaky VM link, and
  # it is extracted into .new atomically.
  # -------------------------------------------------------------------------
  Write-Host '==> packing the tree' -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  Remove-Item -Force $archive -ErrorAction SilentlyContinue
  tar -czf $archive -C $staging .
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $archive)) { throw 'tar failed' }
  $archiveBytes = (Get-Item $archive).Length
  Write-Host ("    {0:N1} MB archive, {1} files" -f ($archiveBytes / 1MB), (Get-ChildItem -Recurse -File $staging).Count) -ForegroundColor DarkGray

  # -------------------------------------------------------------------------
  # Remote installer: verify .new completely before touching the live dir.
  # -------------------------------------------------------------------------
  $installerScript = @'
#!/bin/bash
# Runs on the VM. Uploaded + executed by scripts/deploy-web-vm.ps1.
# Safe swap: extract into "<site>.new", verify, then move the live dir to
# "<site>.old" and the new dir into place. Any failure leaves the live site
# untouched.
set -euo pipefail
SITE="__SITE__"
NEW="${SITE}.new"
OLD="${SITE}.old"
ARCHIVE="/tmp/chatgram-site.tar.gz"

rm -rf "$NEW"
mkdir -p "$NEW"
tar -xzf "$ARCHIVE" -C "$NEW"

# nginx runs as www-data: files must be world-readable, dirs traversable.
# Set exact modes (the Windows tar can carry 777), never world-writable.
chmod -R u=rwX,go=rX "$NEW"

for entry in index.html web/index.html docs/index.html assets/apk-qr.svg sitemap.xml robots.txt 404.html site.webmanifest; do
  if [ ! -e "$NEW/$entry" ]; then
    echo "REFUSING: extracted tree is missing $entry"
    rm -rf "$NEW"
    exit 1
  fi
done

if [ -d "$SITE" ]; then
  rm -rf "$OLD"
  mv "$SITE" "$OLD"
fi
mv "$NEW" "$SITE"
rm -f "$ARCHIVE"
echo "installed: $(find "$SITE" -type f | wc -l) files, $(du -sh "$SITE" | cut -f1)"
'@
  $installerScript = $installerScript.Replace('__SITE__', $RemoteRoot)
  # Write LF endings: CRLF makes bash fail on the VM.
  $installerText = $installerScript -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText($installer, $installerText, (New-Object System.Text.ASCIIEncoding))

  $verifyScript = @'
#!/bin/bash
# Host-header checks against nginx on the VM itself, before DNS moves.
set -u
HOSTNAME_QD="chatgram.qd.je"
for path in / /web/ /docs/ /web/admin /sitemap.xml /robots.txt /assets/apk-qr.svg /api/status/health /downloads/checksums.txt; do
  code=$(curl -sS -H "Host: $HOSTNAME_QD" -o /dev/null -w '%{http_code}' "http://127.0.0.1${path}" 2>/dev/null || echo ERR)
  printf '  %-26s %s\n' "$path" "$code"
done
'@
  $verifierText = $verifyScript -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText($verifier, $verifierText, (New-Object System.Text.ASCIIEncoding))

  # -------------------------------------------------------------------------
  # Upload + install.
  # -------------------------------------------------------------------------
  Write-Host '==> uploading to the VM' -ForegroundColor Cyan
  $scpOptions = @('-i', $SshKey, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=30', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=6')
  scp @scpOptions $archive "${VmHost}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw 'scp of the site archive failed (live site untouched)' }
  scp @scpOptions $installer "${VmHost}:$remoteInstaller"
  if ($LASTEXITCODE -ne 0) { throw 'scp of the installer failed (live site untouched)' }

  Write-Host '==> installing with the safe swap' -ForegroundColor Cyan
  # /var/www is root-owned; the swap (create .new, move the live dir to .old)
  # needs root. The VM user has passwordless sudo.
  ssh -i $SshKey -o StrictHostKeyChecking=no -o ConnectTimeout=30 $VmHost 'sudo -n true'
  if ($LASTEXITCODE -ne 0) { throw 'passwordless sudo is required to swap /var/www/chatgram-site (live site untouched)' }
  ssh -i $SshKey -o StrictHostKeyChecking=no -o ConnectTimeout=30 $VmHost "sudo -n bash $remoteInstaller"
  if ($LASTEXITCODE -ne 0) { throw 'remote install failed (previous site kept in .old)' }

  if (-not $SkipVerify) {
    Write-Host '==> verifying the chatgram.qd.je vhost with a Host header (before DNS)' -ForegroundColor Cyan
    scp @scpOptions $verifier "${VmHost}:$remoteVerifier" | Out-Null
    ssh -i $SshKey -o StrictHostKeyChecking=no -o ConnectTimeout=30 $VmHost "bash $remoteVerifier"
  }

  Write-Host 'VM deploy OK' -ForegroundColor Green
} finally {
  if ($null -eq $previousSiteUrl) { Remove-Item Env:\SITE_URL -ErrorAction SilentlyContinue } else { $env:SITE_URL = $previousSiteUrl }
  if ($null -eq $previousViteSiteUrl) { Remove-Item Env:\VITE_SITE_URL -ErrorAction SilentlyContinue } else { $env:VITE_SITE_URL = $previousViteSiteUrl }
}
