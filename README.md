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
```

In a second terminal:

```bash
pnpm devnet warp 2h          # close market #2 → keyper releases the key + reveals
pnpm devnet resolve 2 no     # council resolves (mock ML-DSA on anvil)
pnpm devnet warp 1h          # reveal window over → winners can claim
```

## Deploy to QoreChain testnet

Fund a wallet with testnet QOR first.

```bash
# 1. confirm real ML-DSA-87 signatures verify on 0x0a01
RPC_URL=https://evm-testnet.qore.host pnpm council check-precompile

# 2. deploy
cd contracts
PRIVATE_KEY=0x... forge script script/Deploy.s.sol --rpc-url qorechain_testnet --broadcast --legacy
cd ..                         # writes contracts/deployments/9800.json

# 3. council key (keep council.json offline)
cp services/council/.env.example services/council/.env   # set COUNCIL_PASSPHRASE
pnpm council keygen

# 4. create a market + run the keyper
cp services/keyper/.env.example services/keyper/.env     # set PRIVATE_KEY, KEYPER_PASSPHRASE
pnpm keyper create-market --question "Will BTC close above \$150k on Dec 31?" --close +3d --council services/council/council.json
pnpm keyper run

# 5. after close + reveals: resolve
pnpm council resolve 1 yes      # or: sign offline, then `council relay resolution-1-yes.json`
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
