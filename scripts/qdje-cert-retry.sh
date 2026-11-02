#!/bin/bash
# chatgram.qd.je: obtain the TLS certificate once Let's Encrypt's shared qd.je
# quota frees up, then remove this transient cron entry.
#
# Why this exists: qd.je is not on the Public Suffix List, so Let's Encrypt
# counts every qd.je subdomain against ONE registered domain
# (50 new certificates / 168 h). That quota was exhausted by other users when
# the A record moved here; retrying on a timer is the only supported path.
#
# This script is idempotent: it exits immediately once the certificate exists,
# and it deletes its own cron file at that point.
set -u
LIVE=/etc/letsencrypt/live/chatgram.qd.je/fullchain.pem
LOG=/var/log/chatgram-qdje-cert.log
CRON=/etc/cron.d/chatgram-qdje-cert

if [ -f "$LIVE" ]; then
  echo "$(date -u +%FT%TZ) certificate already present; removing cron" >> "$LOG"
  rm -f "$CRON"
  exit 0
fi

echo "$(date -u +%FT%TZ) attempting certbot" >> "$LOG"
if certbot --nginx -d chatgram.qd.je --redirect -n --agree-tos >> "$LOG" 2>&1; then
  echo "$(date -u +%FT%TZ) SUCCESS" >> "$LOG"
  rm -f "$CRON"
  systemctl reload nginx >> "$LOG" 2>&1
  exit 0
fi

# Rate limited or transient failure: keep the timer and try again later.
echo "$(date -u +%FT%TZ) attempt failed; will retry" >> "$LOG"
exit 0
