#!/usr/bin/env bash
# =============================================================================
# Chatgram — keep chatgram.duckdns.org pointing at this VM
# =============================================================================
# DuckDNS has no API key in the URL you should commit. The token is read from,
# in order of precedence:
#
#   1. the DUCKDNS_TOKEN environment variable
#   2. a token file (default /etc/chatgram/duckdns.env, root-readable only)
#
# The token file is OUTSIDE the git repository and is never committed.
#
# One-time setup:
#   sudo mkdir -p /etc/chatgram
#   echo 'DUCKDNS_TOKEN=your-duckdns-token' | sudo tee /etc/chatgram/duckdns.env
#   sudo chmod 600 /etc/chatgram/duckdns.env
#
# Run it once by hand:
#   ./scripts/duckdns-update.sh
#
# Then install the cron entry (the script can do it for you):
#   ./scripts/duckdns-update.sh --install-cron
#
# Cron entry installed (every 5 minutes):
#   */5 * * * * /home/ubuntu/chatgram/scripts/duckdns-update.sh >> /var/log/duckdns.log 2>&1
# =============================================================================
set -euo pipefail

DOMAIN="${DUCKDNS_DOMAIN:-chatgram}"
TOKEN_FILE="${DUCKDNS_TOKEN_FILE:-/etc/chatgram/duckdns.env}"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

log() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# ------------------------------------------------------------- install cron --
if [[ "${1:-}" == "--install-cron" ]]; then
  CRON_LINE="*/5 * * * * ${SCRIPT_PATH} >> /var/log/duckdns.log 2>&1"
  if crontab -l 2>/dev/null | grep -Fq "$SCRIPT_PATH"; then
    log "cron entry already installed"
  else
    ( crontab -l 2>/dev/null || true; echo "$CRON_LINE" ) | crontab -
    log "installed cron entry: $CRON_LINE"
  fi
  exit 0
fi

# -------------------------------------------------------------------- token --
if [[ -n "${DUCKDNS_TOKEN:-}" ]]; then
  TOKEN="$DUCKDNS_TOKEN"
elif [[ -r "$TOKEN_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; . "$TOKEN_FILE"; set +a
  TOKEN="${DUCKDNS_TOKEN:-}"
else
  log "ERROR: no DuckDNS token. Set DUCKDNS_TOKEN or create $TOKEN_FILE"
  exit 1
fi

if [[ -z "${TOKEN:-}" ]]; then
  log "ERROR: DuckDNS token is empty ($TOKEN_FILE)"
  exit 1
fi

# --------------------------------------------------------------------- ping --
# Leaving &ip= empty tells DuckDNS to use the source address of this request,
# which is exactly the VM's current public IP.
RESPONSE="$(curl -fsS --max-time 15 \
  "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip=" || echo "CURL_FAILED")"

case "$RESPONSE" in
  OK)
    log "OK  ${DOMAIN}.duckdns.org updated"
    ;;
  KO)
    log "KO  DuckDNS rejected the update — check the token and that the domain '${DOMAIN}' exists"
    exit 1
    ;;
  *)
    log "Unexpected response: ${RESPONSE}"
    exit 1
    ;;
esac
