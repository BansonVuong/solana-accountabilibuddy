# Agent Guide

## Before Starting Work

- Always inspect `git status` first.
- Preserve all existing uncommitted changes; never discard or overwrite them.
- Before editing, fetch the latest remote state and integrate the current
  branch with its upstream:

```bash
git status --short
git fetch origin
git merge @{upstream}
```

- If the branch diverged, integrate upstream with a regular merge commit.
- If the merge conflicts, resolve them while preserving the intent of both
  sides. Stop and report only when a conflict cannot be resolved confidently.
- Never reset, rebase, force-push, or discard work to synchronize the branch.
- Run the synchronization again immediately before pushing.

## Environment Boundaries

- Local development and production are independent.
- Local web app: `http://localhost:5173`
- Local relayer: `http://localhost:8787`
- Production web app and API: `https://66.42.115.38.nip.io`
- The local web app automatically uses the local relayer.
- Production builds use their current HTTPS origin for API requests.
- Do not add a production `VITE_RELAYER_URL` override unless explicitly needed.

## Local Development

Run the local stack in two terminals:

```bash
npm run dev:relayer
npm run dev:web
```

The local relayer reads the repo-root `.env`. Prefer
`MONGODB_DB=accountabilibuddy-dev` locally so development does not modify
production data.

Before committing:

```bash
npm run check
```

## Production Deployment

- Only GitHub `main` deploys to production.
- Feature branch pushes do not deploy.
- The server checks `origin/main` every minute using
  `accountabilibuddy-update.timer`.
- A deploy installs locked root/app dependencies, typechecks the relayer,
  builds the Vite app, refreshes Caddy/systemd configuration, and restarts the
  relayer.
- Deployment infrastructure lives in `deploy/relayer/`.

Production verification:

```bash
curl https://66.42.115.38.nip.io/
curl https://66.42.115.38.nip.io/health
ssh root@66.42.115.38 \
  'systemctl is-active accountabilibuddy-relayer caddy accountabilibuddy-update.timer'
```

## Secrets And Safety

- Never commit `.env`, oracle keys, MongoDB credentials, or auth secrets.
- Production secrets live at `/etc/accountabilibuddy/relayer.env`.
- The production oracle key lives at `/etc/accountabilibuddy/oracle.json`.
- Do not overwrite or transfer production secrets unless explicitly requested.
- The relayer must bind to `127.0.0.1:8787`; public traffic goes through Caddy.
- MongoDB Atlas must allow production IP `66.42.115.38/32`.

## Relevant Files

- `README.md`: developer environment and deployment workflow
- `deploy/relayer/README.md`: production operations
- `deploy/relayer/update.sh`: automatic deployment process
- `deploy/relayer/Caddyfile`: web/API routing
- `app/src/lib/relayer.ts`: environment-dependent API endpoint selection
