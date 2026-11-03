#!/usr/bin/env bash
# Install deploy/nginx/chatgram.qd.je.conf as the ENABLED chatgram.qd.je vhost.
#
#   scp -i "$KEY" deploy/nginx/chatgram.qd.je.conf ubuntu@HOST:/tmp/chatgram.qd.je.conf
#   ssh -i "$KEY" ubuntu@HOST 'bash -s' < scripts/install-qdje-nginx.sh
#
# The enabled file is /etc/nginx/sites-available/chatgram.qd.je (no .conf suffix),
# which is what the sites-enabled symlink points at and where certbot wrote the
# TLS block. The file is backed up first and restored if `nginx -t` fails, so a
# bad edit can never take the site down.
set -euo pipefail

SRC=/tmp/chatgram.qd.je.conf
LIVE=/etc/nginx/sites-available/chatgram.qd.je
BACKUP="${LIVE}.bak-$(date -u +%Y%m%d-%H%M%S)"

test -f "$SRC" || { echo "missing $SRC (scp the conf first)" >&2; exit 1; }
grep -q 'server_name chatgram.qd.je' "$SRC" || { echo "$SRC is not the chatgram.qd.je vhost" >&2; exit 1; }

sudo -n cp "$LIVE" "$BACKUP"
sudo -n cp "$SRC" "$LIVE"

if ! sudo -n nginx -t; then
  echo "nginx -t failed, restoring $BACKUP" >&2
  sudo -n cp "$BACKUP" "$LIVE"
  sudo -n nginx -t && sudo -n systemctl reload nginx
  exit 1
fi

sudo -n systemctl reload nginx
echo "installed $LIVE"
echo "backup: $BACKUP"
