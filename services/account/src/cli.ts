#!/usr/bin/env -S npx tsx
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { generatePrivateKey } from "viem/accounts";
import {
  accountFromEnv,
  accountState,
  closeWindow,
  evmWindow,
  fmtQor,
  loadAccount,
  networkFromEnv,
  newRecoveryCode,
  openWindow,
  pqcStatus,
  registerPqcKey,
  MAX_WINDOW_BLOCKS,
} from "./qore.ts";

// load ./.env when present (Node ≥ 20.12); real env vars always win
try {
  if (existsSync(".env")) process.loadEnvFile(".env");
} catch {
  /* malformed .env — fall back to the process env */
}

const HELP = `blindspot-account — QoreChain post-quantum account setup (needed before ANY EVM write)

Every EVM transaction on QoreChain needs (1) a registered ML-DSA-87 key and
(2) an open EVM authorisation window, opened by a hybrid-signed Cosmos tx.

Commands
  init [--new-key]     print a fresh PQC recovery code (QRC1-…) for PRIVATE_KEY
                       (--new-key also generates a fresh private key)
  status               addresses, QOR balance, PQC key, current EVM window
  register             one-time: register this account's ML-DSA-87 key
  open [--blocks 3000] [--txs 25] [--value 25] [--targets 0xA,0xB]
                       open an EVM window (blocks ≤ ${MAX_WINDOW_BLOCKS}, txs ≤ 1000, value in QOR = cap on value + fees)
  setup                register (if needed) + open a default window
  close                close the current window early

Env: PRIVATE_KEY, PQC_RECOVERY_CODE, [QORE_NETWORK=testnet|mainnet, QORE_REST, QORE_RPC]`;

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ msg, ...extra }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      "new-key": { type: "boolean", default: false },
      blocks: { type: "string", default: "3000" },
      txs: { type: "string", default: "25" },
      value: { type: "string", default: "25" },
      targets: { type: "string" },
    },
  });
  if (!cmd || cmd === "help" || cmd === "--help") return console.log(HELP);
  const net = networkFromEnv();

  if (cmd === "init") {
    const privateKey = values["new-key"] ? generatePrivateKey() : process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("set PRIVATE_KEY first, or pass --new-key to generate one");
    const code = newRecoveryCode();
    const acct = loadAccount(privateKey, code);
    console.log(`
  0x address     ${acct.evm}
  qor1 address   ${acct.cosmos}      ← use this one at the faucet
${values["new-key"] ? `  PRIVATE_KEY    ${privateKey}\n` : ""}  PQC_RECOVERY_CODE
                 ${code}

  Save the recovery code now — it is shown once and it is the only way to re-derive this
  account's ML-DSA-87 key. Keep it apart from the private key. Put both in .env:
    PRIVATE_KEY=…
    PQC_RECOVERY_CODE=${code}
`);
    return;
  }

  const acct = accountFromEnv();
  switch (cmd) {
    case "status": {
      const [state, pqc, w] = await Promise.all([accountState(net, acct.cosmos), pqcStatus(net, acct), evmWindow(net, acct)]);
      log("account", {
        network: net.chainId,
        evm: acct.evm,
        qor: acct.cosmos,
        exists: state.exists,
        balanceQOR: fmtQor(state.balanceUqor),
        pqcKeyRegistered: pqc.registered,
        window: w.found
          ? {
              live: w.live,
              remainingBlocks: w.remainingBlocks,
              remainingTxs: w.remainingTxs,
              remainingQOR: fmtQor(w.remainingValue),
              allowedTargets: w.allowedTargets,
            }
          : null,
      });
      break;
    }
    case "register": {
      const r = await registerPqcKey(net, acct);
      log(r.alreadyRegistered ? "already registered" : "ML-DSA-87 key registered", r);
      break;
    }
    case "open": {
      const r = await openWindow(net, acct, {
        blocks: Number(values.blocks),
        maxTxs: Number(values.txs),
        maxValueQor: Number(values.value),
        allowedTargets: values.targets ? values.targets.split(",").map((s) => s.trim()) : undefined,
      });
      log("EVM window opened", r);
      break;
    }
    case "setup": {
      const reg = await registerPqcKey(net, acct);
      log(reg.alreadyRegistered ? "PQC key already registered" : "ML-DSA-87 key registered", reg);
      if (!reg.alreadyRegistered) await new Promise((r) => setTimeout(r, 4000)); // let the next block include it
      const w = await openWindow(net, acct, {
        blocks: Number(values.blocks),
        maxTxs: Number(values.txs),
        maxValueQor: Number(values.value),
      });
      log("EVM window opened", w);
      break;
    }
    case "close": {
      log("EVM window closed", await closeWindow(net, acct));
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});
