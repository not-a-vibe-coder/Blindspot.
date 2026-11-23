import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEther, toHex } from "viem";
import { BlindspotClient, commitmentFor, generateCouncilKeypair, randomSalt, SEALED_SIDE_LENGTH, Side } from "@blindspot/sdk";
import { Keystore } from "../src/keystore.js";
import { Keyper, createSealedMarket } from "../src/keyper.js";
import { anvilAvailable, startAnvil } from "./anvil.js";

describe.skipIf(!anvilAvailable)("Keyper e2e (anvil)", () => {
  let env: Awaited<ReturnType<typeof startAnvil>>;
  beforeAll(async () => {
    env = await startAnvil();
  }, 30_000);
  afterAll(() => env?.stop());

  it("keeps sides blind until close, then releases the key and reveals every valid bet", async () => {
    const [operator, alice, bob] = env.wallets;
    const client = (wc = operator) => new BlindspotClient({ address: env.address, publicClient: env.publicClient, walletClient: wc! });
    const keystore = new Keystore(mkdtempSync(join(tmpdir(), "keyper-e2e-")), "e2e passphrase, not for prod");
    const logs: string[] = [];
    let windowChecks = 0;
    const keyper = new Keyper(client(), keystore, (m) => logs.push(m), async () => {
      windowChecks++;
    });

    const now = await client().chainTime();
    const { marketId } = await createSealedMarket(client(), keystore, {
      question: "Will ETH flip BTC by 2030?",
      closeTime: now + 3600n,
      revealDeadline: now + 7200n,
      resolveDeadline: now + 86_400n,
      councilPublicKey: generateCouncilKeypair().publicKey,
    });

    await client(alice).placeSealedBet({ marketId, side: Side.Yes, amount: parseEther("1") });
    await client(bob).placeSealedBet({ marketId, side: Side.No, amount: parseEther("2") });

    // a "free option" attempt: valid commitment but a garbage payload nobody can decrypt
    const salt = randomSalt();
    const ctx = await client().sealContext(marketId);
    const commitment = commitmentFor({ ...ctx, bettor: alice!.account.address, side: Side.Yes, salt });
    const junk = toHex(new Uint8Array(SEALED_SIDE_LENGTH).fill(7));
    await alice!.writeContract({
      address: env.address,
      abi: (await import("@blindspot/sdk")).blindspotMarketsAbi,
      functionName: "placeBet",
      args: [marketId, commitment, junk],
      value: parseEther("5"),
    });
    await env.publicClient.waitForTransactionReceipt({
      hash: await alice!.sendTransaction({ to: alice!.account.address, value: 0n }),
    });

    // before close: nothing happens, key stays secret
    expect((await keyper.tick())[0]).toMatchObject({ status: "open" });
    expect(await client().read().keyReleased(marketId)).toBe(false);

    // after close: release + reveal the two valid bets, leave the junk one hidden
    await env.warpTo(now + 3600n);
    const [report] = await keyper.tick();
    expect(report).toMatchObject({ status: "revealed", revealed: 2, undecryptable: 1 });
    expect(windowChecks).toBe(2); // once before the key release, once before the reveal batch
    expect(await client().read().keyReleased(marketId)).toBe(true);

    const pool = await client().read().pool(marketId);
    expect(pool.revealedYes).toBe(parseEther("1"));
    expect(pool.revealedNo).toBe(parseEther("2"));
    expect(pool.revealedCount).toBe(2);
    expect(pool.totalStaked).toBe(parseEther("8"));
    expect((await client().read().bet(marketId, 3n)).side).toBe(Side.Hidden);

    // idempotent: a second tick has nothing to do
    expect((await keyper.tick())[0]).toMatchObject({ status: "nothing-to-do", revealed: 0 });
    expect(windowChecks).toBe(2); // idle ticks never touch the window

    // after the reveal deadline the keyper stops touching the market
    await env.warpTo(now + 7200n);
    expect((await keyper.tick())[0]).toMatchObject({ status: "expired" });
    expect(keystore.markets(31337, env.address)[0]!.released).toBe(true);
  }, 120_000);
});
