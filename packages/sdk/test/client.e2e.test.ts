import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
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
  generateSealerKeypair,
  Outcome,
  resolutionMessage,
  Side,
} from "../src/index.js";

// End-to-end against a throwaway Anvil node with real ML-KEM-1024 sealing.
// Anvil has no QoreChain precompiles, so MockPQCVerify is injected at 0x0a01.

const ANVIL = process.env.ANVIL_BIN ?? resolve(homedir(), ".foundry/bin/anvil");
const OUT = resolve(__dirname, "../../../contracts/out");
const PORT = 8600 + Math.floor(Math.random() * 300);
const RPC = `http://127.0.0.1:${PORT}`;
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const;

const artifact = (name: string, file = `${name}.sol`) =>
  JSON.parse(readFileSync(resolve(OUT, file, `${name}.json`), "utf8"));

const enabled = existsSync(ANVIL) && existsSync(resolve(OUT, "BlindspotMarkets.sol"));

describe.skipIf(!enabled)("BlindspotClient e2e (anvil)", () => {
  let anvil: ChildProcess;
  const publicClient = createPublicClient({ chain: foundry, transport: http(RPC) });
  const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
  const [deployer, alice, bob] = KEYS.map((k) =>
    createWalletClient({ chain: foundry, transport: http(RPC), account: privateKeyToAccount(k) }),
  );
  let address: Hex;
  let mock: Hex;

  const as = (wc: typeof alice) => new BlindspotClient({ address, publicClient, walletClient: wc! });
  const warpTo = async (ts: bigint) => {
    await test.setNextBlockTimestamp({ timestamp: ts });
    await test.mine({ blocks: 1 });
  };

  beforeAll(async () => {
    anvil = spawn(ANVIL, ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try {
        await publicClient.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const bs = artifact("BlindspotMarkets");
    const hash = await deployer!.deployContract({
      abi: blindspotMarketsAbi,
      bytecode: bs.bytecode.object,
      args: [deployer!.account.address, 200],
    });
    address = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;

    const m = artifact("MockPQCVerify");
    const mh = await deployer!.deployContract({ abi: m.abi, bytecode: m.bytecode.object });
    mock = (await publicClient.waitForTransactionReceipt({ hash: mh })).contractAddress!;
    await test.setCode({ address: "0x0000000000000000000000000000000000000a01", bytecode: m.deployedBytecode.object });
  }, 30_000);

  afterAll(() => anvil?.kill());

  it("runs a full blind market: create → sealed bets → key release → reveal → PQ resolve → claim", async () => {
    const sealer = generateSealerKeypair();
    const council = generateCouncilKeypair();
    const now = (await publicClient.getBlock()).timestamp;

    // 1. create
    const admin = as(deployer);
    const { marketId } = await admin.createMarket({
      question: "Will QoreChain hit 10k TPS on testnet this week?",
      closeTime: now + 3600n,
      revealDeadline: now + 7200n,
      resolveDeadline: now + 86400n,
      sealerPublicKey: sealer.publicKey,
      sealerKeyHash: sealer.secretKeyHash,
      councilPublicKey: council.publicKey,
    });
    expect(marketId).toBe(1n);
    const info = await admin.getMarketInfo(marketId);
    expect(info.sealerPublicKey).toBe(sealer.publicKey);

    // 2. sealed bets — the chain sees amounts, never sides
    const a = await as(alice).placeSealedBet({ marketId, side: Side.Yes, amount: parseEther("2") });
    const b = await as(bob).placeSealedBet({ marketId, side: Side.No, amount: parseEther("1") });
    expect(a.receipt.betId).toBe(1n);
    const pool = await admin.read().pool(marketId);
    expect(pool.totalStaked).toBe(parseEther("3"));
    expect(pool.revealedYes + pool.revealedNo).toBe(0n);
    expect((await admin.read().bet(marketId, 1n)).side).toBe(Side.Hidden);

    // 3. close → keyper releases the ML-KEM-1024 secret key
    await warpTo(now + 3600n);
    await admin.releaseSealerKey(marketId, sealer.secretKey);
    const released = await admin.getReleasedSealerKey(marketId);
    expect(released).toBe(sealer.secretKey);

    // 4. anyone can now decrypt every bet and reveal them
    const decrypted = await admin.decryptAll(marketId, released!);
    expect(decrypted.map((d) => d.reveal?.side)).toEqual([Side.Yes, Side.No]);
    await admin.revealBets(marketId, decrypted.map((d) => d.reveal!));
    const revealed = await admin.read().pool(marketId);
    expect(revealed.revealedYes).toBe(parseEther("2"));
    expect(revealed.revealedNo).toBe(parseEther("1"));

    // 5. post-quantum council resolves YES (mock signature on anvil; real ML-DSA-87 on QoreChain)
    const msg = resolutionMessage({ chainId: foundry.id, contract: address, marketId, outcome: Outcome.Yes });
    const sig = (await publicClient.readContract({
      address: mock,
      abi: artifact("MockPQCVerify").abi,
      functionName: "fakeSign",
      args: [council.publicKey, msg],
    })) as Hex;
    await admin.resolveByCouncil(marketId, Outcome.Yes, council.publicKey, sig);

    // 6. claim after the reveal window
    await warpTo(now + 7200n);
    const [preview] = await admin.read().previewPayout(marketId, 1n);
    // pool 3, losing 1, fee 2% of 1 = 0.02 → alice gets 2.98
    expect(preview).toBe(parseEther("2.98"));
    const before = await publicClient.getBalance({ address: alice!.account.address });
    await admin.claim(marketId, 1n); // relayed — funds still go to alice
    const after = await publicClient.getBalance({ address: alice!.account.address });
    expect(after - before).toBe(parseEther("2.98"));

    // bob lost; his preview is zero
    const [bobPreview] = await admin.read().previewPayout(marketId, b.receipt.betId!);
    expect(bobPreview).toBe(0n);
  }, 60_000);
});
