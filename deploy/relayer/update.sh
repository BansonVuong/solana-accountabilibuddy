#!/usr/bin/env bash
set -euo pipefail

repo=/opt/accountabilibuddy
branch=main
deployed_sha_file=/var/lib/accountabilibuddy/deployed-sha

cd "$repo"
runuser -u accountabilibuddy -- git fetch --quiet origin "$branch"

current=$(runuser -u accountabilibuddy -- git rev-parse HEAD)
incoming=$(runuser -u accountabilibuddy -- git rev-parse "origin/$branch")
deployed=$(cat "$deployed_sha_file" 2>/dev/null || true)
if [[ "$deployed" == "$incoming" ]]; then
  exit 0
fi

if [[ "$current" != "$incoming" ]]; then
  runuser -u accountabilibuddy -- git merge --ff-only "origin/$branch"
fi
runuser -u accountabilibuddy -- npm ci
runuser -u accountabilibuddy -- npm run relayer:deploy-check
runuser -u accountabilibuddy -- npm --prefix app ci
runuser -u accountabilibuddy -- npm --prefix app run build

install -m 644 deploy/relayer/accountabilibuddy-relayer.service /etc/systemd/system/
install -m 644 deploy/relayer/accountabilibuddy-update.service /etc/systemd/system/
install -m 644 deploy/relayer/accountabilibuddy-update.timer /etc/systemd/system/
install -m 644 deploy/relayer/Caddyfile /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl reload caddy.service

if [[ -f /etc/accountabilibuddy/oracle.json ]]; then
  systemctl restart accountabilibuddy-relayer.service
else
  systemctl stop accountabilibuddy-relayer.service
fi
printf '%s\n' "$incoming" >"$deployed_sha_file"
