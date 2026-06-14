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

## iMessage betting extension (new)

The betting flow now has an iMessage-oriented client scaffold under:

- `ios/AccountabiliBuddyMessages/BetModels.swift`
- `ios/AccountabiliBuddyMessages/RelayerClient.swift`
- `ios/AccountabiliBuddyMessages/BetMessageViewModel.swift`
- `ios/AccountabiliBuddyMessages/BetMessageRootView.swift`
- `ios/AccountabiliBuddyMessages/MessagesViewController.swift`

The relayer now exposes iMessage helper routes:

- `GET /imessage/bets/:id` — compact bet-card payload for message rendering
- `GET /imessage/deeplink?betId=...` — canonical deep-link for a bet
- `GET /imessage/deeplink?url=...` — parse a deep-link back to `betId`

### Xcode project

The repo now includes a ready-to-open project:

- `ios/AccountabiliBuddy.xcodeproj`
- App target: `AccountabiliBuddy`
- iMessage extension target: `AccountabiliBuddyMessages`

Open it directly in Xcode and run the app/extension pair:

```bash
open ios/AccountabiliBuddy.xcodeproj
```

CLI validation commands:

```bash
xcodebuild -list -project ios/AccountabiliBuddy.xcodeproj
xcodebuild -project ios/AccountabiliBuddy.xcodeproj -target AccountabiliBuddy -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build
```

### Runtime configuration

Inside the iMessage UI, set:

- **Relayer URL** (for local: `http://127.0.0.1:8787`)
- **Bearer token** (same auth token used by the web app)
- **Default group id** (target chat group in relayer Mongo data)

Optional relayer deep-link base can be customized with:

```dotenv
IMESSAGE_DEEP_LINK_BASE=accountabilibuddy://bet
```

### Local verification flow

1. Start relayer + web app:
   - `npm run dev:relayer`
   - `npm run dev:web`
2. In web, create/login and create a group so you have a valid group id.
3. In iMessage extension, create a bet and insert the card into a conversation.
4. Tap the sent message; the extension should resolve `betId` and load card state from `/imessage/bets/:id`.
5. Use **Accept** or **Vote** actions; card refresh should reflect updated relayer state.
