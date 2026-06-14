# BAAM — Dashboard

Frontend for the BAAM social prediction / accountability-bet
platform (the Figma "Design Social Prediction Dashboard"). React + Vite +
Tailwind v4, with four views: Group Chat, Escrow Card, Dev Bet (AI Git
Inspector) and Leaderboard.

## Run

```bash
npm install      # from this app/ directory
npm run dev      # http://localhost:5173
```

From the repo root you can also run `npm run app`.

## Wiring to the relayer

The dashboard talks to the on-chain `accountability` program through the
relayer's HTTP API (see `../relayer/index.ts`). Start it from the repo root:

```bash
npm run relayer  # http://localhost:8787
```

- **Live status bar** (`src/app/App.tsx`) polls `GET /health` and shows the real
  connection state, current devnet **slot**, and **oracle** pubkey. When the
  relayer is offline it degrades gracefully to a "RELAYER OFFLINE" indicator.
- The API client in `src/lib/relayer.ts` also wraps the relayer's other
  endpoints — `/scoreboard`, `/game`, `/verify`, `/settle-bet` — ready to drive
  the escrow/dev-bet flows on-chain.

During local Vite development, the app defaults to `http://localhost:8787`.
Production defaults to the web app's current HTTPS origin. Set
`VITE_RELAYER_URL` (see `.env.example`) only to point at a non-default relayer.

> The chat / escrow / leaderboard data is still design fixtures; the
> infrastructure to back them with real on-chain state lives in
> `src/lib/relayer.ts`.

---

Original Figma project:
https://www.figma.com/design/ZhxChvpt2CublNeyCm3pI3/Design-Social-Prediction-Dashboard
