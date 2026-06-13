# Accountability relayer

The relayer uses its configured keypair as both transaction payer and commitment
oracle. Commitments must store this keypair's public key as `oracle_pubkey`.

```bash
export ORACLE_KEYPAIR=~/.config/solana/id.json
export SOLANA_RPC_URL=https://api.devnet.solana.com
yarn relayer
```

Resolve a commitment successfully:

```bash
curl -X POST http://localhost:8787/verify \
  -H 'content-type: application/json' \
  -d '{"commitmentId":"COMMITMENT_PDA"}'
```

The process also scans active commitments every 15 seconds and submits
permissionless `timeout` transactions for expired commitments.
