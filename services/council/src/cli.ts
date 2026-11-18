#!/usr/bin/env -S npx tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex } from "viem";
import { Outcome, signResolution, verifyResolution } from "@blindspot/sdk";
import { loadClient } from "@blindspot/keyper/config";
import { createCouncilKeyFile, readCouncilKeyFile, unlockCouncilKey } from "./councilKey.js";

const HELP = `blindspot-council — post-quantum (ML-DSA-87) resolution council

Commands
  keygen                                   create council.json (secret key encrypted)
  sign    <marketId> <yes|no|invalid>      sign offline (needs CHAIN_ID + BLINDSPOT_ADDRESS, no RPC)
                                           writes resolution-<market>-<outcome>.json
  relay   <resolution.json>                submit a signed resolution (any funded wallet can relay)
  resolve <marketId> <yes|no|invalid>      sign + submit in one go
  status                                   every market: proposal, dispute, final outcome

Env: COUNCIL_KEY (default ./council.json), COUNCIL_PASSPHRASE, RPC_URL, PRIVATE_KEY,
     [BLINDSPOT_ADDRESS, CHAIN_ID, FROM_BLOCK]`;

const OUTCOMES = { yes: Outcome.Yes, no: Outcome.No, invalid: Outcome.Invalid } as const;
const keyPath = () => resolve(process.env.COUNCIL_KEY ?? "council.json");
const pass = () => {
  const p = process.env.COUNCIL_PASSPHRASE;
  if (!p) throw new Error("missing env COUNCIL_PASSPHRASE");
  return p;
};
const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

interface SignedResolution {
  chainId: number;
  contract: Hex;
  marketId: string;
  outcome: Outcome;
  councilPublicKey: Hex;
  signature: Hex;
}

function parseOutcome(s?: string): Outcome {
  const o = OUTCOMES[(s ?? "").toLowerCase() as keyof typeof OUTCOMES];
  if (o === undefined) throw new Error("outcome must be yes | no | invalid");
  return o;
}

function sign(chainId: number, contract: Hex, marketId: bigint, outcome: Outcome): SignedResolution {
  const file = readCouncilKeyFile(keyPath());
  const sk = unlockCouncilKey(file, pass());
  const args = { chainId, contract, marketId, outcome };
  const signature = signResolution(sk, args);
  if (!verifyResolution(file.publicKey, signature, args)) throw new Error("self-check failed");
  return { chainId, contract, marketId: marketId.toString(), outcome, councilPublicKey: file.publicKey, signature };
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case "keygen": {
      const f = createCouncilKeyFile(keyPath(), pass());
      log("council key created", { file: keyPath(), publicKeyHash: f.publicKeyHash });
      console.log(`\nPublic key (pass to --council when creating markets):\n${keyPath()}`);
      break;
    }
    case "sign": {
      const chainId = Number(process.env.CHAIN_ID ?? 9800);
      const contract = process.env.BLINDSPOT_ADDRESS as Hex | undefined;
      if (!contract) throw new Error("offline signing needs BLINDSPOT_ADDRESS (and CHAIN_ID, default 9800)");
      const outcome = parseOutcome(b);
      const signed = sign(chainId, contract, BigInt(a!), outcome);
      const out = `resolution-${a}-${b!.toLowerCase()}.json`;
      writeFileSync(out, JSON.stringify(signed, null, 2));
      log("signed", { marketId: a, outcome: b, file: out });
      break;
    }
    case "relay": {
      if (!a || !existsSync(a)) throw new Error("relay needs a resolution-*.json file");
      const s = JSON.parse(readFileSync(a, "utf8")) as SignedResolution;
      const client = await loadClient();
      if (s.chainId !== (await client.chainId())) throw new Error("signed for a different chain");
      if (s.contract.toLowerCase() !== client.address.toLowerCase()) throw new Error("signed for a different contract");
      const tx = await client.resolveByCouncil(BigInt(s.marketId), s.outcome, s.councilPublicKey, s.signature);
      log("resolved", { marketId: s.marketId, outcome: Outcome[s.outcome], tx });
      break;
    }
    case "resolve": {
      const client = await loadClient();
      const outcome = parseOutcome(b);
      const s = sign(await client.chainId(), client.address, BigInt(a!), outcome);
      const tx = await client.resolveByCouncil(BigInt(s.marketId), outcome, s.councilPublicKey, s.signature);
      log("resolved", { marketId: a, outcome: Outcome[outcome], tx });
      break;
    }
    case "status": {
      const client = await loadClient();
      const now = await client.chainTime();
      for (const m of await client.listMarkets()) {
        const [res, prop] = await Promise.all([client.read().resolution(m.marketId), client.read().proposal(m.marketId)]);
        log("market", {
          marketId: m.marketId,
          question: m.question,
          closed: now >= m.closeTime,
          final: Outcome[res.outcome],
          proposed: prop.proposer === "0x0000000000000000000000000000000000000000" ? null : Outcome[prop.outcome],
          disputed: prop.disputer !== "0x0000000000000000000000000000000000000000",
          needsCouncil: res.outcome === Outcome.Unresolved && prop.disputer !== "0x0000000000000000000000000000000000000000",
        });
      }
      break;
    }
    default:
      console.log(HELP);
      if (cmd && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});
