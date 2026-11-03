#!/usr/bin/env bash
# Read-only: how many certificates does the server actually send, and which?
set -uo pipefail
echo "== ssl_certificate line in the live vhost"
grep -n 'ssl_certificate ' /etc/nginx/sites-available/chatgram.qd.je
echo "== leaf subject/issuer"
echo | openssl s_client -connect 127.0.0.1:443 -servername chatgram.qd.je 2>/dev/null | openssl x509 -noout -subject -issuer
echo "== chain presented by the server (issuer of each certificate)"
echo | openssl s_client -connect 127.0.0.1:443 -servername chatgram.qd.je -showcerts 2>/dev/null > /tmp/sc.txt
grep -c 'BEGIN CERTIFICATE' /tmp/sc.txt
awk '/BEGIN CERTIFICATE/{n++} {print > ("/tmp/cert" n ".pem")}' /tmp/sc.txt
for f in /tmp/cert*.pem; do [ -f "$f" ] && openssl x509 -in "$f" -noout -subject -issuer 2>/dev/null && echo "-- $f"; done
echo "== verify result"
echo | openssl s_client -connect 127.0.0.1:443 -servername chatgram.qd.je 2>&1 | grep -E 'Verify return code|verify error'
echo "== what the certbot fullchain file holds"
grep -c 'BEGIN CERTIFICATE' /etc/letsencrypt/live/chatgram.qd.je/fullchain.pem
