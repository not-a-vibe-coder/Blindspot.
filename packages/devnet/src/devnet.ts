#!/usr/bin/env -S npx tsx
/**
 * Blindspot local devnet.
 *
 *   pnpm --filter @blindspot/devnet devnet            # up: anvil + deploy + seed + keyper
 *   pnpm --filter @blindspot/devnet devnet warp 2h    # jump chain time forward
 *   pnpm --filter @blindspot/devnet devnet resolve 1 yes
 *
 * Anvil has no QoreChain precompiles, so MockPQCVerify is injected at 0x0a01 and `resolve`
 * signs with the mock. On QoreChain testnet, use services/council (real ML-DSA-87).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  BlindspotClient,
  blindspotMarketsAbi,
  generateCouncilKeypair,
  Outcome,
  resolutionMessage,
  Side,
} from "@blindspot/sdk";
import { Keystore } from "@blindspot/keyper/keystore";
import { Keyper, createSealedMarket } from "@blindspot/keyper/keyper";
import { parseDuration } from "@blindspot/keyper/config";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = resolve(ROOT, "contracts/out");
const STATE = resolve(ROOT, ".devnet");
const PORT = Number(process.env.DEVNET_PORT ?? 8545);
const RPC = `http://127.0.0.1:${PORT}`;
const ANVIL = process.env.ANVIL_BIN ?? resolve(homedir(), ".foundry/bin/anvil");
const PQC = "0x0000000000000000000000000000000000000a01" as const;

// Anvil's well-known dev keys — never use on a real chain.
const DEV_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];

const SEED_MARKETS = [
  { question: "Will BTC close above $150k on Dec 31, 2026?", close: "3d" },
  { question: "Will ETH trade above $10k before the end of 2026?", close: "2h" },
  { question: "Will a quantum computer break a 2048-bit RSA key before 2030?", close: "7d" },
  { question: "Will QoreChain mainnet process 1M transactions in a single day this month?", close: "30m" },
];

const artifact = (name: string) => JSON.parse(readFileSync(resolve(OUT, `${name}.sol`, `${name}.json`), "utf8"));
const publicClient = createPublicClient({ chain: foundry, transport: http(RPC) });
const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
const wallet = (i: number) =>
  createWalletClient({ chain: foundry, transport: http(RPC), account: privateKeyToAccount(DEV_KEYS[i]!) });

const log = (msg: string) => console.log(`\x1b[35m◆\x1b[0m ${msg}`);

function deploymentFile() {
  return resolve(ROOT, "contracts/deployments/31337.json");
}

function client(i = 0, address?: Hex) {
  const d = address ?? (JSON.parse(readFileSync(deploymentFile(), "utf8")).BlindspotMarkets as Hex);
  return new BlindspotClient({ address: d, publicClient: publicClient as never, walletClient: wallet(i) });
}

async function waitForRpc() {
  for (let i = 0; i < 100; i++) {
    try {
      return await publicClient.getChainId();
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("anvil didn't start");
}

async function up() {
  if (!existsSync(resolve(OUT, "BlindspotMarkets.sol"))) {
    throw new Error("contracts not built — run `cd contracts && forge build` first");
  }
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync(STATE, { recursive: true });

  const anvil = spawn(ANVIL, ["--port", String(PORT), "--silent"], { stdio: "inherit" });
  process.on("SIGINT", () => {
    anvil.kill();
    process.exit(0);
  });
  await waitForRpc();
  log(`anvil on ${RPC} (chain 31337)`);

  // contracts
  const deployer = wallet(0);
  const bs = artifact("BlindspotMarkets");
  const hash = await deployer.deployContract({
    abi: blindspotMarketsAbi,
    bytecode: bs.bytecode.object,
    args: [deployer.account.address, 200],
  });
  const address = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress! as Hex;
  const mock = artifact("MockPQCVerify");
  const mh = await deployer.deployContract({ abi: mock.abi, bytecode: mock.bytecode.object });
  const mockAddress = (await publicClient.waitForTransactionReceipt({ hash: mh })).contractAddress!;
  await testClient.setCode({ address: PQC, bytecode: mock.deployedBytecode.object });
  mkdirSync(resolve(ROOT, "contracts/deployments"), { recursive: true });
  writeFileSync(
    deploymentFile(),
    JSON.stringify({ BlindspotMarkets: address, chainId: 31337, deployedAtBlock: 0, feeBps: 200, treasury: deployer.account.address }, null, 2),
  );
  log(`BlindspotMarkets ${address}`);
  log(`MockPQCVerify    ${mockAddress} (code also at ${PQC})`);

  // council + keyper
  const council = generateCouncilKeypair();
  writeFileSync(resolve(STATE, "council.json"), JSON.stringify({ publicKey: council.publicKey, mock: mockAddress }, null, 2));
  const keystore = new Keystore(resolve(STATE, "keys"), "blindspot devnet passphrase");
  const admin = client(0, address);

  const now = await admin.chainTime();
  for (const m of SEED_MARKETS) {
    const closeTime = now + parseDuration(m.close);
    const { marketId } = await createSealedMarket(admin, keystore, {
      question: m.question,
      closeTime,
      revealDeadline: closeTime + 3600n,
      resolveDeadline: closeTime + 3600n + 7n * 86_400n,
      councilPublicKey: council.publicKey,
    });
    log(`market #${marketId}: ${m.question} (closes in ${m.close})`);
  }

  // sealed bets from dev accounts — the chain sees amounts only
  const bets: [number, bigint, Side.Yes | Side.No, string][] = [
    [1, 1n, Side.Yes, "2.5"], [2, 1n, Side.No, "1"], [3, 1n, Side.Yes, "0.75"], [4, 1n, Side.No, "4"],
    [1, 2n, Side.No, "1.2"], [2, 2n, Side.Yes, "0.3"], [5, 2n, Side.No, "2"],
    [3, 3n, Side.No, "10"], [4, 3n, Side.Yes, "0.5"],
    [5, 4n, Side.Yes, "3"], [1, 4n, Side.Yes, "1"], [2, 4n, Side.No, "0.8"],
  ];
  for (const [who, marketId, side, amt] of bets) {
    await client(who, address).placeSealedBet({ marketId, side, amount: parseEther(amt) });
  }
  log(`${bets.length} sealed bets placed`);
  for (let id = 1n; id <= BigInt(SEED_MARKETS.length); id++) {
    const p = await admin.read().pool(id);
    log(`  #${id}: ${formatEther(p.totalStaked)} QOR in ${p.betCount} bets — sides hidden`);
  }

  console.log(`
  RPC            ${RPC}   (chain id 31337)
  Contract       ${address}
  Dev wallets    ${DEV_KEYS.slice(0, 3).map((k) => privateKeyToAccount(k).address).join(", ")} …
                 (import any Anvil dev key into your wallet)

  Next
    devnet warp 2h          close market #2 → the keyper releases its key and reveals
    devnet resolve 2 no     council resolves (mock ML-DSA on anvil)
    devnet warp 1h          end the reveal window → winners can claim
`);

  // keyper loop (fast poll for local dev)
  const keyper = new Keyper(admin, keystore, (msg, extra) => log(`keyper: ${msg} ${extra ? JSON.stringify(extra) : ""}`));
  await keyper.run(2_000);
}

async function warp(duration: string) {
  const seconds = parseDuration(duration);
  await testClient.increaseTime({ seconds: Number(seconds) });
  await testClient.mine({ blocks: 1 });
  const ts = (await publicClient.getBlock()).timestamp;
  log(`warped +${duration} → chain time ${new Date(Number(ts) * 1000).toISOString()}`);
}

async function resolveMarket(marketId: string, outcomeStr: string) {
  const outcome = { yes: Outcome.Yes, no: Outcome.No, invalid: Outcome.Invalid }[outcomeStr.toLowerCase() as "yes"];
  if (outcome === undefined) throw new Error("outcome must be yes | no | invalid");
  const { publicKey, mock } = JSON.parse(readFileSync(resolve(STATE, "council.json"), "utf8"));
  const c = client(0);
  const msg = resolutionMessage({ chainId: 31337, contract: c.address, marketId: BigInt(marketId), outcome });
  const sig = (await publicClient.readContract({
    address: mock,
    abi: artifact("MockPQCVerify").abi,
    functionName: "fakeSign",
    args: [publicKey, msg],
  })) as Hex;
  const tx = await c.resolveByCouncil(BigInt(marketId), outcome, publicKey, sig);
  log(`market #${marketId} resolved ${outcomeStr.toUpperCase()} (${tx})`);
}

const [cmd = "up", ...args] = process.argv.slice(2);
const run = { up, warp: () => warp(args[0] ?? "1h"), resolve: () => resolveMarket(args[0]!, args[1]!) }[cmd];
if (!run) {
  console.log("usage: devnet [up | warp <1h|30m|2d> | resolve <marketId> <yes|no|invalid>]");
  process.exit(1);
}
run().catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});
