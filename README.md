# Blindspot

**The blind prediction market.**
On Polymarket every bet is public, so whales move the odds and everyone else copies them.
On Blindspot your side is sealed with **post-quantum encryption (ML-KEM-1024)** until the market closes:
everyone sees *how much* has been bet — nobody sees *which way*.

Built on **QoreChain** — testnet `qorechain-diana`, EVM lane chain id **9800**.

---

## How a market works

```
 OPEN ─────────────────► CLOSED ──────────────────► REVEAL DEADLINE ───────► CLAIMS
 bets are sealed         keyper releases its         pools are final         winners split
 (amount public,         ML-KEM secret key;          council / oracle        the losing pool
  side encrypted)        every bet is decrypted      resolves outcome
                         + revealed vs. commitment
```

1. **Create** — a market commits to an ML-KEM-1024 *sealer* key (public key emitted, secret key committed by hash) and an ML-DSA-87 *council* key.
2. **Bet blind** — `side ‖ salt` is encrypted to the sealer key and stored in the event log, alongside `commitment = keccak(chain, contract, market, bettor, side, salt)`. The pool only shows totals.
3. **Close → release** — after close, the keyper publishes the secret key on-chain (checked against its hash). From that moment **anyone** can decrypt every bet and audit the reveals.
4. **Reveal** — the keyper batch-reveals; bettors can always self-reveal with their receipt. A reveal must match the commitment, so sides can't be changed.
5. **Resolve** — UMA-style optimistic proposal with a bond, or a **post-quantum council signature (ML-DSA-87)** verified on-chain by QoreChain's `0x0a01` precompile. Disputes escalate to the council.
6. **Claim** — parimutuel: winners get `stake × (pool − fee) / winningPool`. Invalid markets refund everyone.

## Concepts borrowed from other chains

| Concept | From | In Blindspot |
| --- | --- | --- |
| Keyper threshold encryption | Shutter Network / Gnosis Chain | per-market ML-KEM-1024 sealer key, released only after close |
| Commit–reveal | ENS Vickrey auctions | every bet binds its side with a domain-separated commitment |
| Optimistic oracle | UMA (Polymarket's resolver) | bonded proposals, 2h liveness, disputes |
| Parimutuel pools | Augur / tote betting | winners split the losing pool pro rata |
| Post-quantum signatures | — (native to QoreChain) | ML-DSA-87 council, verified by precompile `0x0a01` |

## Why QoreChain

- **ML-DSA-87 precompile** (`0x…0a01`) — the council's resolution is verified on-chain with a NIST post-quantum signature. Blindspot can't fake this on another chain: without the precompile, council resolution fails closed.
- **Harvest-now-decrypt-later resistance** — sides are sealed with ML-KEM-1024, so even an adversary recording the chain today for a future quantum computer can't peek before close.
- **Standard EVM lane** — Solidity, Foundry and viem work as-is.

## Repo layout

```
apps/web/           Next.js frontend — WebGL smoked-glass landing + markets, market, portfolio pages
contracts/          Foundry — BlindspotMarkets.sol, QorePQC precompile wrapper, 58 tests (incl. solvency fuzz)
packages/sdk/       TypeScript SDK — chains, ABI, ML-KEM sealing, ML-DSA signing, BlindspotClient
packages/devnet/    one-command local chain with seeded sealed markets + running keyper
services/keyper/    keyper daemon — encrypted keystore, release + batch reveal, CLI
services/council/   ML-DSA-87 council — keygen, offline signing, relay, precompile check
```

## Quick start (local)

Requires Node 22+, pnpm 10, Foundry.

```bash
pnpm install
cd contracts && forge build && cd ..
pnpm test            # contracts + sdk + services
pnpm devnet          # anvil :8545, deploy, 4 seeded markets, 12 sealed bets, keyper loop
                     # (also writes apps/web/.env.local)
pnpm --filter @blindspot/web dev     # http://localhost:3000
```

Import an Anvil dev key into your wallet (e.g. `0x59c6995e…690d`) and add the network
`http://127.0.0.1:8545`, chain id 31337 — the app offers to add it for you.

In a second terminal:

```bash
pnpm devnet warp 2h          # close market #2 → keyper releases the key + reveals
pnpm devnet resolve 2 no     # council resolves (mock ML-DSA on anvil)
pnpm devnet warp 1h          # reveal window over → winners can claim
```

## Deploy

Three pieces: the **contract** on QoreChain, the **keyper** on Render (backend), the **web app** on Vercel.
You need a wallet with testnet QOR for the deployer and another (or the same) for the keyper.

### 1 · Contract → QoreChain testnet (from your machine)

```bash
cd contracts && forge build && cd ..

# a) prove real ML-DSA-87 signatures verify on QoreChain's 0x0a01 precompile — must print
#    realSignature: "valid", tamperedSignature: "invalid"
RPC_URL=https://evm-testnet.qore.host pnpm council check-precompile

# b) deploy (writes contracts/deployments/9800.json → BlindspotMarkets + deployedAtBlock)
cd contracts
PRIVATE_KEY=0x... forge script script/Deploy.s.sol --rpc-url qorechain_testnet --broadcast --legacy
cd ..
```

### 2 · Council key (offline, on your machine)

```bash
cp services/council/.env.example services/council/.env    # set COUNCIL_PASSPHRASE
pnpm council keygen                                        # → services/council/council.json
node -p "require('./services/council/council.json').publicKey" > council.pub   # public half only
```

Keep `council.json` offline — signing needs no network (`pnpm council sign <id> yes`, then
`pnpm council relay resolution-<id>-yes.json` from any machine).

### 3 · Keyper → Render (backend)

The keyper must run continuously and **keep its keys on a persistent disk** — a lost key means
that market can only be refunded. `render.yaml` sets this up as a background worker with a 1 GB disk.

1. Render → **New → Blueprint** → select this repo → it reads `render.yaml`.
2. Fill the secret env vars: `BLINDSPOT_ADDRESS`, `FROM_BLOCK` (from `deployments/9800.json`),
   `PRIVATE_KEY` (funded keyper wallet), `KEYPER_PASSPHRASE` (≥ 12 chars — store it safely).
3. Deploy. Logs should show `keyper running`.
4. Create markets **on the Render instance** (Shell tab) so their keys land on the disk:

```bash
pnpm keyper create-market --question "Will BTC close above \$150k on Dec 31?" \
  --close +3d --reveal-window 1h --resolve-window 7d --council 0x<contents of council.pub>
```

(`pnpm keyper status` lists the markets this keyper holds keys for. If the Shell says `pnpm: not found`,
run `corepack enable` first.)

### 4 · Web app → Vercel (frontend)

1. Vercel → **Add New Project** → import this repo → **Root Directory: `apps/web`** (framework: Next.js;
   Vercel installs the pnpm workspace from the repo root automatically).
2. Environment variables:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` | `9800` |
| `NEXT_PUBLIC_RPC_URL` | `https://evm-testnet.qore.host` |
| `NEXT_PUBLIC_BLINDSPOT_ADDRESS` | `BlindspotMarkets` from `deployments/9800.json` |
| `NEXT_PUBLIC_FROM_BLOCK` | `deployedAtBlock` from the same file |
| `NEXT_PUBLIC_LOG_CHUNK` | `5000` (lower it if the RPC rejects large `eth_getLogs` ranges) |

3. Deploy. Browser reads go through the app's own read-only `/api/rpc` proxy (no CORS issues);
   transactions go from the user's wallet. Set `RPC_UPSTREAM` to point the proxy at a different RPC.

### 5 · Resolve

After a market closes the keyper releases its key and reveals every bet. Anyone can then propose the
outcome in the app (bond, 2 h dispute window), or the council resolves directly:

```bash
pnpm council resolve 1 yes
```

## Trust model (read this)

| Actor | Can | Cannot |
| --- | --- | --- |
| **Keyper** (sealer) | see sides before close (it holds the key); grief by never releasing → market refunds everyone | change any side (commitments); steal funds; release the key before close |
| **Council** | decide disputed outcomes | resolve without a valid ML-DSA-87 signature; resolve after the deadline |
| **Proposer** | finalize an outcome if nobody disputes within 2h | avoid losing the bond if the council disagrees |
| **Bettor** | self-reveal with their receipt | hide a losing side — unrevealed bets in a normal market are forfeited once the key is public |

Known limits / next steps:
- One keyper per market is a trust point. Next: **threshold keypers** (t-of-n ML-KEM shares), as in Shutter.
- Keep the reveal window ≥ 1h so the keyper and bettors have time to reveal; valid bets left unrevealed past the deadline are forfeited.
- The AI precompiles (`0x0b01` risk score, `0x0b02` anomaly check) are inactive on testnet today; once live they can flag wash bets at placement.

## License

MIT
