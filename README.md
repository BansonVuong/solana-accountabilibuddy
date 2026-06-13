# AccountabiliBuddy

## Environments

Local development and production run independently:

| Environment | Web app | Relayer | Deploy source |
| --- | --- | --- | --- |
| Local | `http://localhost:5173` | `http://localhost:8787` | Current working tree |
| Production | `https://66.42.115.38.nip.io` | Same HTTPS origin | GitHub `main` |

In two terminals, start the local stack:

```bash
npm run dev:relayer
npm run dev:web
```

The local web app automatically calls the local relayer. Production builds
automatically call their own HTTPS origin. Set `VITE_RELAYER_URL` in
`app/.env.local` only when intentionally overriding that behavior.

The local relayer reads the repo-root `.env`. To keep development data separate
from production while using the same Atlas cluster, use a different local
database name:

```dotenv
MONGODB_DB=accountabilibuddy-dev
```

## Production Workflow

Do development on a feature branch:

```bash
git switch -c feature/my-change
npm run check
```

Push feature branches freely; they do not deploy. Production deploys only when
changes reach `main`:

```bash
git switch main
git merge --ff-only feature/my-change
git push origin main
```

The server checks GitHub `main` every minute, installs locked dependencies,
typechecks the relayer, builds the web app, and restarts the relayer. Production
secrets and the oracle key remain server-local under `/etc/accountabilibuddy`.
