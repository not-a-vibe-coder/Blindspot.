#!/usr/bin/env -S npx tsx
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import type { Hex } from "viem";
import { Keystore } from "./keystore.js";
import { Keyper, createSealedMarket } from "./keyper.js";
import { keysDir, loadClient, parseDuration, parseTime, passphrase, pollMs } from "./config.js";

// load ./.env when present (Node ≥ 20.12); real env vars always win
try {
  if (existsSync(".env")) process.loadEnvFile(".env");
} catch {
  /* malformed .env — fall back to the process env */
}

const HELP = `blindspot-keyper — holds each market's ML-KEM-1024 key and reveals bets after close

Commands
  create-market  --question "..." --close <+2h|unix|ISO> --council <pubkey hex | council.json>
                 [--reveal-window 1h] [--resolve-window 7d]
  run            poll forever: release keys after close, batch-reveal sealed bets
  tick           run one pass and exit
  status         list the markets this keyper holds keys for

Env: RPC_URL, PRIVATE_KEY, KEYPER_PASSPHRASE, [BLINDSPOT_ADDRESS, FROM_BLOCK, KEYS_DIR, POLL_MS, LOG_CHUNK]`;

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

function councilKey(input: string): Hex {
  if (input.startsWith("0x")) return input as Hex;
  // `pnpm keyper …` runs inside services/keyper; resolve paths from where the user typed it
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), input);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).publicKey as Hex;
  throw new Error("--council must be an ML-DSA-87 public key (0x…) or a council.json file");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      question: { type: "string" },
      close: { type: "string" },
      council: { type: "string" },
      "reveal-window": { type: "string", default: "1h" },
      "resolve-window": { type: "string", default: "7d" },
    },
  });

  if (!cmd || cmd === "help" || cmd === "--help") return console.log(HELP);

  const client = await loadClient();
  const keystore = new Keystore(keysDir(), passphrase());
  const keyper = new Keyper(client, keystore, log);

  switch (cmd) {
    case "create-market": {
      if (!values.question || !values.close || !values.council) throw new Error("need --question, --close, --council");
      const now = await client.chainTime();
      const closeTime = parseTime(values.close, now);
      const revealDeadline = closeTime + parseDuration(values["reveal-window"]!);
      const resolveDeadline = revealDeadline + parseDuration(values["resolve-window"]!);
      const res = await createSealedMarket(client, keystore, {
        question: values.question,
        closeTime,
        revealDeadline,
        resolveDeadline,
        councilPublicKey: councilKey(values.council),
      });
      log("market created", {
        marketId: res.marketId.toString(),
        tx: res.hash,
        closeTime: new Date(Number(closeTime) * 1000).toISOString(),
        revealDeadline: new Date(Number(revealDeadline) * 1000).toISOString(),
      });
      break;
    }
    case "run": {
      const chainId = await client.chainId();
      log("keyper running", { contract: client.address, chainId, pollMs: pollMs(), markets: (await keyper.markets()).length });
      // optional health/status endpoint (Render web services and uptime monitors need a port)
      if (process.env.PORT) {
        const started = Date.now();
        createServer((_req, res) => {
          const t = keyper.lastTick;
          const stale = !t || Date.now() - t.at > pollMs() * 4 + 30_000;
          res.writeHead(stale && Date.now() - started > 60_000 ? 503 : 200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              ok: !stale,
              contract: client.address,
              chainId,
              lastTick: t ? new Date(t.at).toISOString() : null,
              error: t?.error,
              markets: t?.reports ?? [],
            }),
          );
        }).listen(Number(process.env.PORT), () => log("health endpoint", { port: process.env.PORT }));
      }
      await keyper.run(pollMs());
      break;
    }
    case "tick":
      for (const r of await keyper.tick()) log("market", { ...r });
      break;
    case "status":
      for (const k of await keyper.markets()) {
        log("market", {
          marketId: k.marketId,
          question: k.question,
          closes: new Date(Number(k.closeTime) * 1000).toISOString(),
          released: k.released ?? false,
        });
      }
      break;
    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});
