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
systemctl restart accountabilibuddy-relayer.service
printf '%s\n' "$incoming" >"$deployed_sha_file"
