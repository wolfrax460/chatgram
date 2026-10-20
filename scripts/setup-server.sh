#!/usr/bin/env bash
# =============================================================================
# Chatgram — one-shot server setup for Ubuntu on Oracle Cloud Always Free
# =============================================================================
# Idempotent: safe to run again; it skips anything already done.
#
#   chmod +x scripts/setup-server.sh
#   ./scripts/setup-server.sh
#
# Installs: git, nginx, certbot, python3-certbot-nginx, curl, Node.js LTS, pm2
# Configures: 2 GB swap file, OS firewall for 80/443 (persisted)
#
# It does NOT start the app — that is DEPLOY.md step D.
#
# Both x86_64 (VM.Standard.E2.1.Micro) and aarch64 (VM.Standard.A1.Flex) are
# supported. NodeSource publishes for both.
# =============================================================================
set -euo pipefail

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[1;33m!\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------- preflight --
if [[ $EUID -eq 0 ]]; then
  warn "Running as root. Prefer a normal user with sudo (e.g. 'ubuntu')."
  SUDO=""
else
  SUDO="sudo"
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script targets Ubuntu/Debian (apt). Oracle Linux would need dnf." >&2
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) NODE_ARCH="arm64" ;;
  x86_64|amd64)  NODE_ARCH="x64"   ;;
  *)             NODE_ARCH="$ARCH" ;;
esac

log "Host information"
ok "architecture: $ARCH (Node binaries: $NODE_ARCH)"
ok "distro: $(. /etc/os-release && echo "$PRETTY_NAME")"
ok "memory: $(free -h | awk '/^Mem:/{print $2}') total, $(free -h | awk '/^Mem:/{print $7}') available"
ok "disk:   $(df -h / | awk 'NR==2{print $4}') free on /"

# -------------------------------------------------------------------- swap ---
# Extra safety net on a 1 GB box: without swap the OOM killer terminates Node
# during a burst instead of slowing down.
log "Swap"
if swapon --show | grep -q '/swapfile'; then
  ok "2 GB swapfile already active"
elif [[ -f /swapfile ]]; then
  $SUDO swapon /swapfile || true
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
  ok "existing /swapfile enabled"
else
  $SUDO fallocate -l 2G /swapfile || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile >/dev/null
  $SUDO swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
  # Prefer RAM; only swap under real pressure.
  $SUDO sysctl -q vm.swappiness=10
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' | $SUDO tee -a /etc/sysctl.conf >/dev/null
  ok "created and enabled 2 GB /swapfile"
fi

# ------------------------------------------------------------------ packages --
log "System packages"
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -qq
$SUDO apt-get -y -qq upgrade

# iptables-persistent must not prompt while installing.
echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | $SUDO debconf-set-selections
echo "iptables-persistent iptables-persistent/autosave_v6 boolean true" | $SUDO debconf-set-selections

$SUDO apt-get install -y -qq \
  git nginx certbot python3-certbot-nginx curl ca-certificates \
  iptables-persistent netfilter-persistent
ok "git, nginx, certbot, curl, iptables-persistent installed"

$SUDO systemctl enable --now nginx >/dev/null 2>&1 || true
ok "nginx enabled and running"

# ---------------------------------------------------------------- node + pm2 --
log "Node.js LTS"
if command -v node >/dev/null 2>&1 && [[ "$(node -v | sed 's/v//;s/\..*//')" -ge 20 ]]; then
  ok "Node $(node -v) already installed"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y -qq nodejs
  ok "Node $(node -v) installed"
fi

log "PM2"
if command -v pm2 >/dev/null 2>&1; then
  ok "pm2 $(pm2 -v) already installed"
else
  $SUDO npm install -g pm2
  ok "pm2 $(pm2 -v) installed"
fi

# ---------------------------------------------------------------- firewall ---
# TWO firewalls exist on Oracle Cloud:
#   1. the VCN Security List (cloud side — you already opened 22/80/443)
#   2. the OS iptables rules, which on Oracle's Ubuntu images allow only SSH
# If only #1 is done, nginx is unreachable from the internet.
log "OS firewall (iptables)"

$SUDO mkdir -p /var/www/html
$SUDO chown -R www-data:www-data /var/www/html

open_port() {
  local port="$1"

  if $SUDO iptables -C INPUT -m state --state NEW -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    ok "port $port already allowed"
    return
  fi

  # Oracle's Ubuntu images end the INPUT chain with
  #   REJECT all -- reject-with icmp-host-prohibited
  # so appending would place the rule AFTER the reject and it would never be
  # reached. Insert BEFORE the first REJECT/DROP instead.
  local reject_line
  reject_line="$($SUDO iptables -L INPUT --line-numbers -n \
    | awk '$2 == "REJECT" || $2 == "DROP" { print $1; exit }')"

  if [[ -n "${reject_line:-}" ]]; then
    $SUDO iptables -I INPUT "$reject_line" -m state --state NEW -p tcp --dport "$port" -j ACCEPT
    ok "opened port $port (inserted before REJECT at line $reject_line)"
  else
    $SUDO iptables -A INPUT -m state --state NEW -p tcp --dport "$port" -j ACCEPT
    ok "opened port $port (appended)"
  fi
}

open_port 80
open_port 443

# Persist across reboots.
if command -v netfilter-persistent >/dev/null 2>&1; then
  $SUDO netfilter-persistent save >/dev/null 2>&1 || true
  ok "iptables rules persisted (/etc/iptables/rules.v4)"
else
  warn "netfilter-persistent missing — rules will NOT survive a reboot"
fi

# ------------------------------------------------------------------- summary --
log "Done"
cat <<EOF

  Node.js   $(node -v)   (${NODE_ARCH})
  npm       $(npm -v)
  PM2       $(pm2 -v 2>/dev/null || echo '?')

  Next steps (see DEPLOY.md):
    1. Clone the repo and create server/.env
    2. cd server && npm ci --omit=dev
    3. pm2 start ecosystem.config.js && pm2 save && pm2 startup
    4. Install the nginx site, then run certbot

  NOTE: these are the OS firewall rules. Ports 22/80/443 must ALSO be open in
  the Oracle VCN Security List, which is a separate layer.

EOF
