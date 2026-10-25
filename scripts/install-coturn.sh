#!/usr/bin/env bash
# Install and configure coturn for Chatgram calls.
# - REST-style auth (use-auth-secret) so the API mints short-lived credentials
# - UDP+TCP 3478, TLS 5349 (reusing the existing Let's Encrypt certificate)
# - limited relay range, denied private/metadata peers, quotas and bandwidth caps
# The shared secret is generated here, written to coturn + server .env, and never printed.
set -euo pipefail

REALM="chatgram.duckdns.org"
LIVE="/etc/letsencrypt/live/${REALM}"
CERTDIR="/etc/turnserver/certs"
ENVF="$HOME/chatgram/server/.env"

echo "== host =="
hostname; . /etc/os-release && echo "$PRETTY_NAME"

echo "== certificate present? =="
if sudo -n test -f "$LIVE/fullchain.pem" && sudo -n test -f "$LIVE/privkey.pem"; then
  echo "  letsencrypt cert found for $REALM"
else
  echo "  ERROR: certificate not found at $LIVE"; exit 1
fi

echo "== installing coturn =="
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq coturn >/dev/null
coturn --version 2>/dev/null | head -1 || true

echo "== copying certificate for the turnserver user =="
sudo mkdir -p "$CERTDIR"
sudo cp "$LIVE/fullchain.pem" "$CERTDIR/fullchain.pem"
sudo cp "$LIVE/privkey.pem" "$CERTDIR/privkey.pem"
sudo chown -R turnserver:turnserver "$CERTDIR"
sudo chmod 640 "$CERTDIR"/*.pem

echo "== generating shared secret (not printed) =="
SECRET=""
if sudo grep -q '^static-auth-secret=' /etc/turnserver.conf 2>/dev/null; then
  # Keep the existing secret so credentials stay valid across reruns.
  SECRET=$(sudo awk -F= '/^static-auth-secret=/{print substr($0, index($0,"=")+1)}' /etc/turnserver.conf)
  echo "  reusing existing secret"
fi
if [ -z "$SECRET" ]; then
  SECRET=$(openssl rand -hex 32)
  echo "  new secret generated"
fi

echo "== writing /etc/turnserver.conf =="
sudo tee /etc/turnserver.conf >/dev/null <<EOF
# Chatgram TURN (managed; regenerate with scripts/install-coturn.sh)
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
realm=${REALM}
server-name=${REALM}

# REST-style ephemeral credentials: the API signs username=expiry:user.
use-auth-secret
static-auth-secret=${SECRET}

# TLS using the existing Let's Encrypt certificate (copied above).
cert=${CERTDIR}/fullchain.pem
pkey=${CERTDIR}/privkey.pem
cipher-list="ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM"
no-tlsv1
no-tlsv1_1

# Relay range is deliberately small.
min-port=49160
max-port=49200

# Never relay to private, loopback, link-local or cloud metadata ranges.
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::/7
denied-peer-ip=fe80::/10

# Abuse limits.
user-quota=24
total-quota=600
max-bps=3000000
bps-capacity=0

# Quiet logging: lifecycle only, no credentials in the log.
log-file=/var/log/turnserver.log
simple-log
no-cli
no-software-attribute
EOF

# The turnserver service needs the same secret available through the env file
# Debian sets in /etc/default/coturn.
if ! sudo grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn 2>/dev/null; then
  echo 'TURNSERVER_ENABLED=1' | sudo tee -a /etc/default/coturn >/dev/null
fi

echo "== firewall =="
if sudo ufw status | grep -q 'Status: active'; then
  sudo ufw allow 3478/udp  >/dev/null
  sudo ufw allow 3478/tcp  >/dev/null
  sudo ufw allow 5349/udp  >/dev/null
  sudo ufw allow 5349/tcp  >/dev/null
  sudo ufw allow 49160:49200/udp >/dev/null
  echo "  ufw rules added"
else
  echo "  ufw inactive (iptables/firewalld may still need rules)"
fi
if command -v iptables >/dev/null 2>&1; then
  sudo iptables -C INPUT -p udp --dport 3478 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p udp --dport 3478 -j ACCEPT
  sudo iptables -C INPUT -p tcp --dport 3478 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 3478 -j ACCEPT
  sudo iptables -C INPUT -p tcp --dport 5349 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 5349 -j ACCEPT
  sudo iptables -C INPUT -p udp --dport 5349 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p udp --dport 5349 -j ACCEPT
  sudo iptables -C INPUT -p udp --dport 49160:49200 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p udp --dport 49160:49200 -j ACCEPT
  echo "  iptables rules added"
fi

echo "== enabling service =="
sudo systemctl enable coturn >/dev/null 2>&1 || true
sudo systemctl restart coturn
sleep 2
sudo systemctl is-active coturn || true

echo "== writing TURN settings to server .env (values hidden) =="
cd "$HOME/chatgram/server"
node - "$SECRET" <<'NODE'
const fs = require('fs');
const [secret] = process.argv.slice(2);
const path = '.env';
const lines = fs.existsSync(path) ? fs.readFileSync(path, 'utf8').split(/\r?\n/) : [];
const wanted = {
  TURN_SECRET: secret,
  TURN_REALM: 'chatgram.duckdns.org',
  TURN_HOST: 'chatgram.duckdns.org',
  TURN_PORT: '3478',
  TURN_TLS_PORT: '5349',
  TURN_TTL_SECONDS: '3600',
};
const seen = new Set();
const out = lines.map((line) => {
  const m = /^([A-Z0-9_]+)=/.exec(line);
  if (m && Object.prototype.hasOwnProperty.call(wanted, m[1])) {
    seen.add(m[1]);
    return `${m[1]}=${wanted[m[1]]}`;
  }
  return line;
});
for (const [key, value] of Object.entries(wanted)) {
  if (!seen.has(key)) out.push(`${key}=${value}`);
}
fs.writeFileSync(path, out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n', { mode: 0o600 });
console.log('  env keys written: ' + Object.keys(wanted).join(', '));
NODE
chmod 600 .env

echo "== listening ports =="
sudo ss -lntup 2>/dev/null | grep -E ':(3478|5349)\b' || echo "  coturn not listening yet"
echo "== done =="
