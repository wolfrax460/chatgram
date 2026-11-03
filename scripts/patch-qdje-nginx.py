#!/usr/bin/env python3
"""Insert HSTS / nosniff / Referrer-Policy after every Permissions-Policy header
in the ENABLED chatgram.qd.je vhost, then test and reload nginx with a rollback.

Idempotent: a block that already has Strict-Transport-Security is left alone.
Certbot's managed TLS block is preserved exactly as it is.

Usage (from the repo root, on the VM):
    python3 scripts/patch-qdje-nginx.py
"""
import re
import shutil
import subprocess
import sys
import time

LIVE = "/etc/nginx/sites-available/chatgram.qd.je"
EXTRA = [
    'add_header Strict-Transport-Security "max-age=31536000" always;',
    'add_header X-Content-Type-Options "nosniff" always;',
    'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
]

sudo = ["sudo", "-n"]


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


with open(LIVE, encoding="utf-8") as handle:
    lines = handle.read().splitlines()

out = []
inserted = 0
index = 0
while index < len(lines):
    line = lines[index]
    out.append(line)
    if "add_header Permissions-Policy" in line:
        # consume continuation lines (a long directive can be wrapped)
        while not line.rstrip().endswith("always;"):
            index += 1
            line = lines[index]
            out.append(line)
        indent = re.match(r"\s*", out[-1]).group(0)
        already = any("Strict-Transport-Security" in nxt for nxt in lines[index + 1 : index + 2])
        if not already:
            for extra in EXTRA:
                out.append(f"{indent}{extra}")
            inserted += 1
    index += 1

if inserted == 0:
    print("nothing to do: every header block already has HSTS")
    sys.exit(0)

backup = f"{LIVE}.bak-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}"
if run(sudo + ["cp", LIVE, backup]).returncode != 0:
    sys.exit("could not back up the live file")

tmp = "/tmp/chatgram.qd.je.patched"
with open(tmp, "w", encoding="utf-8") as handle:
    handle.write("\n".join(out) + "\n")

if run(sudo + ["cp", tmp, LIVE]).returncode != 0:
    sys.exit("could not write the patched file")

test = run(sudo + ["nginx", "-t"])
sys.stderr.write(test.stderr)
if test.returncode != 0:
    run(sudo + ["cp", backup, LIVE])
    run(sudo + ["nginx", "-t"])
    sys.exit("nginx -t failed, restored the backup")

if run(sudo + ["systemctl", "reload", "nginx"]).returncode != 0:
    sys.exit("reload failed")

print(f"patched {inserted} header block(s)")
print(f"backup: {backup}")
