#!/usr/bin/env bash
# Validate sitemap.xml exactly as a crawler sees it, plus DNS sanity.
set -uo pipefail
echo "== DNS"
getent ahostsv4 chatgram.qd.je | awk '{print $1}' | sort -u
getent ahostsv6 chatgram.qd.je | awk '{print $1}' | sort -u | sed 's/^/AAAA: /' || true

echo "== fetch as Googlebot with gzip"
curl -sS --compressed -A 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' \
  -o /tmp/sm.xml -w 'status=%{http_code} type=%{content_type} size=%{size_download}\n' \
  https://chatgram.qd.je/sitemap.xml
curl -sS --compressed -A 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' \
  -o /tmp/rb.txt -w 'robots: status=%{http_code} type=%{content_type} size=%{size_download}\n' \
  https://chatgram.qd.je/robots.txt

echo "== XML well-formedness + protocol checks (python xml.etree)"
python3 - <<'PY'
import xml.etree.ElementTree as ET

NS = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9', 'x': 'http://www.w3.org/1999/xhtml'}
raw = open('/tmp/sm.xml', 'rb').read()
print('bytes', len(raw), 'bom', raw[:3] == b'\xef\xbb\xbf', 'decl', raw[:5] == b'<?xml')
tree = ET.fromstring(raw)
print('root', tree.tag)
urls = tree.findall('s:url', NS)
print('urls', len(urls))
no_loc = no_lastmod = 0
for url in urls:
    loc = url.find('s:loc', NS)
    lastmod = url.find('s:lastmod', NS)
    if loc is None or not (loc.text or '').startswith('https://chatgram.qd.je/'):
        no_loc += 1
    if lastmod is None:
        no_lastmod += 1
alts = tree.findall('.//x:link', NS)
print('missing loc', no_loc, 'missing lastmod', no_lastmod, 'alternates', len(alts))
print('x-default count', len([a for a in alts if a.get('hreflang') == 'x-default']))
PY

echo "== every loc status (HEAD, following one redirect)"
python3 - <<'PY'
import re, ssl, urllib.request

raw = open('/tmp/sm.xml', 'r', encoding='utf-8').read()
locs = re.findall(r'<loc>([^<]+)</loc>', raw)
bad = []
for loc in locs:
    req = urllib.request.Request(loc, method='HEAD', headers={'User-Agent': 'chatgram-seo-check/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            if res.status != 200:
                bad.append((loc, res.status))
    except Exception as error:  # noqa: BLE001 - report, never crash
        bad.append((loc, repr(error)))
print('checked', len(locs), 'non-200', len(bad))
for item in bad:
    print('  BAD', item)
PY

echo "== robots.txt"
head -c 400 /tmp/rb.txt
