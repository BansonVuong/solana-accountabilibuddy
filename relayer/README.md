# Accountability relayer

The relayer uses its configured keypair as both transaction payer and commitment
oracle. Commitments must store this keypair's public key as `oracle_pubkey`.

```bash
export ORACLE_KEYPAIR=~/.config/solana/id.json
export SOLANA_RPC_URL=https://api.devnet.solana.com
yarn relayer
```

The shared deployment is available at `https://66.42.115.38`. It runs behind
Caddy, and `deploy/relayer/accountabilibuddy-update.timer` checks the GitHub
`main` branch every minute. See `deploy/relayer/README.md` for provisioning and
operations.

Resolve a commitment successfully:

```bash
curl -X POST http://localhost:8787/verify \
  -H 'content-type: application/json' \
  -d '{"commitmentId":"COMMITMENT_PDA"}'
```

The process also scans active commitments every 15 seconds and submits
permissionless `timeout` transactions for expired commitments.

## Sports bets (ESPN-settled, no witness)

1v1 and group-chat wagers on real game results. Both sides stake an equal
amount; the winner takes the pot once the relayer scrapes the final score from
ESPN. No witness is needed — the outcome is publicly verifiable.

On-chain instructions (`programs/accountability`):

- `create_bet` — creator stakes and picks a game, side (home/away), kickoff and
  settle time.
- `accept_bet` — opponent matches the stake and takes the other side (locks it).
- `cancel_bet` — creator reclaims their stake while the bet is still **open**.
- `back_out` — either party mutually cancels a **locked** bet, refunding both.
  Allowed only up to **5 minutes before kickoff** — never after.
- `settle_bet(home_won)` — oracle-only payout from the scraped result
  (`true`=home, `false`=away, `null`=draw → both refunded).

The relayer polls and settles locked bets whose `settle_after` has passed.

```bash
# List today's games + ESPN ids (soccer accepts a league, e.g. worldcup)
curl 'http://localhost:8787/scoreboard?sport=soccer&league=worldcup'
curl 'http://localhost:8787/scoreboard?sport=nba'

# Inspect one game's result (null until final)
curl 'http://localhost:8787/game?sport=nba&id=401584793'

# List all on-chain sports bets, or force a settlement sweep
curl  http://localhost:8787/sports-bets
curl -X POST http://localhost:8787/settle-bet
```

Drive the full lifecycle from the CLI (`yarn bet <cmd>`):

```bash
# Creator backs the home team of an NBA game
yarn bet create --sport nba --game 401584793 --side home --amount 0.1

# Opponent (different keypair) matches the stake
yarn bet accept --creator <creatorPubkey> --game 401584793 --keypair ~/opp.json

# Back out of a locked bet (>5 min before kickoff) — both refunded
yarn bet backout --creator <creatorPubkey> --game 401584793 --keypair ~/opp.json

yarn bet list
```
