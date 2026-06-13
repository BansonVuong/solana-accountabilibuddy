#!/usr/bin/env bash
set -euo pipefail

repo_url=${REPO_URL:-https://github.com/BansonVuong/solana-accountabilibuddy.git}
repo=/opt/accountabilibuddy
env_dir=/etc/accountabilibuddy

if [[ $EUID -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git gnupg openssl

if ! command -v node >/dev/null || [[ $(node -p 'Number(process.versions.node.split(".")[0])') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt |
    tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

id accountabilibuddy >/dev/null 2>&1 ||
  useradd --system --create-home --home-dir /var/lib/accountabilibuddy --shell /usr/sbin/nologin accountabilibuddy

if [[ ! -d "$repo/.git" ]]; then
  git clone "$repo_url" "$repo"
fi
chown -R accountabilibuddy:accountabilibuddy "$repo"

cd "$repo"
runuser -u accountabilibuddy -- git fetch origin main
runuser -u accountabilibuddy -- git merge --ff-only origin/main
runuser -u accountabilibuddy -- npm ci
runuser -u accountabilibuddy -- npm run relayer:deploy-check

install -d -m 750 -o root -g accountabilibuddy "$env_dir"
if [[ ! -f "$env_dir/relayer.env" ]]; then
  auth_secret=$(openssl rand -hex 32)
  install -m 640 -o root -g accountabilibuddy /dev/null "$env_dir/relayer.env"
  cat >"$env_dir/relayer.env" <<EOF
HOST=127.0.0.1
PORT=8787
POLL_INTERVAL_MS=60000
SOLANA_RPC_URL=https://api.devnet.solana.com
ORACLE_KEYPAIR=/etc/accountabilibuddy/oracle.json
AUTH_SECRET=$auth_secret
MONGODB_URI=
MONGODB_DB=accountabilibuddy
EOF
fi

install -m 644 deploy/relayer/accountabilibuddy-relayer.service /etc/systemd/system/
install -m 644 deploy/relayer/accountabilibuddy-update.service /etc/systemd/system/
install -m 644 deploy/relayer/accountabilibuddy-update.timer /etc/systemd/system/
install -m 644 deploy/relayer/Caddyfile /etc/caddy/Caddyfile
chmod +x deploy/relayer/update.sh

systemctl daemon-reload
systemctl enable accountabilibuddy-relayer.service accountabilibuddy-update.timer caddy.service
systemctl restart caddy.service
systemctl start accountabilibuddy-update.timer
git rev-parse HEAD >/var/lib/accountabilibuddy/deployed-sha

if [[ -f "$env_dir/oracle.json" ]]; then
  chown root:accountabilibuddy "$env_dir/oracle.json"
  chmod 640 "$env_dir/oracle.json"
  systemctl restart accountabilibuddy-relayer.service
else
  echo "Relayer installed but not started: provision $env_dir/oracle.json first." >&2
fi
