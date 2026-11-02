#!/bin/bash
# Host-header smoke test for the chatgram.qd.je vhost (runs on the VM, before DNS).
set -u
H='Host: chatgram.qd.je'
A=$(grep -o '/web/assets/[^"]*\.js' /var/www/chatgram-site/web/index.html | head -1)
echo "asset path: ${A:-<none>}"
if [ -n "${A:-}" ]; then
  printf "%-42s %s\n" "$A" "$(curl -sS -o /dev/null -w '%{http_code} %{content_type} %{size_download}B' -H "$H" "http://127.0.0.1$A")"
fi
for p in / /web /web/ /web/admin /web/admin/users /docs/ /fr/ /fr /rw /en/ /guides/how-to-use-chatgram.html /web/version.json /sitemap.xml /robots.txt /site.webmanifest /favicon.ico /nonexistent-page /downloads/latest.yml /api/status/health; do
  printf "%-42s %s\n" "$p" "$(curl -sS -o /dev/null -w '%{http_code}' -H "$H" "http://127.0.0.1$p")"
done
echo "--- landing canonical ---"
grep -o 'https://[a-z0-9.-]*chatgram[a-z0-9./-]*' /var/www/chatgram-site/index.html | sort -u | head -5
