import type { Hex } from "viem";
import type { BlindspotClient } from "@blindspot/sdk";
import type { Keystore, StoredKey } from "./keystore.js";

export type Logger = (msg: string, extra?: Record<string, unknown>) => void;

export interface MarketReport {
  marketId: string;
  status: "open" | "released" | "revealed" | "nothing-to-do" | "expired" | "error";
  revealed?: number;
  undecryptable?: number;
  error?: string;
}

/**
 * The keyper (as in Shutter Network): one key per market, never released before close.
 *
 * Each tick, for every market this keyper holds a key for:
 *   1. before close  → do nothing (the key stays secret; sides stay blind)
 *   2. after close   → release the ML-KEM-1024 secret key on-chain (once)
 *   3. then          → decrypt every sealed bet and batch-reveal the ones still hidden
 *   4. after the reveal deadline → nothing can change; stop tracking
 *
 * Bets whose payload doesn't decrypt or doesn't match its commitment are left hidden — they
 * are forfeited by the contract, so a bettor can't use a bogus payload as a free option.
 */
export class Keyper {
  constructor(
    private readonly client: BlindspotClient,
    private readonly keystore: Keystore,
    private readonly log: Logger = () => {},
  ) {}

  async markets(): Promise<StoredKey[]> {
    return this.keystore.markets(await this.client.chainId(), this.client.address);
  }

  async tick(): Promise<MarketReport[]> {
    const now = await this.client.chainTime();
    const reports: MarketReport[] = [];
    for (const key of await this.markets()) {
      reports.push(await this.handle(key, now).catch((e: Error) => {
        this.log("market failed", { marketId: key.marketId, error: e.message });
        return { marketId: key.marketId!, status: "error" as const, error: e.message };
      }));
    }
    return reports;
  }

  private async handle(key: StoredKey, now: bigint): Promise<MarketReport> {
    const marketId = BigInt(key.marketId!);
    const id = key.marketId!;
    if (now < BigInt(key.closeTime!)) return { marketId: id, status: "open" };
    if (now >= BigInt(key.revealDeadline!)) return { marketId: id, status: "expired" };

    const secretKey = this.keystore.unlock(key);
    let status: MarketReport["status"] = "nothing-to-do";

    if (!(await this.client.read().keyReleased(marketId))) {
      await this.client.releaseSealerKey(marketId, secretKey);
      this.keystore.markReleased(key.secretKeyHash);
      this.log("released sealer key", { marketId: id });
      status = "released";
    }

    const [decrypted, alreadyRevealed] = await Promise.all([
      this.client.decryptAll(marketId, secretKey),
      this.client.getRevealedBetIds(marketId),
    ]);
    const pending = decrypted
      .filter((d) => d.reveal && !alreadyRevealed.has(d.bet.betId))
      .map((d) => d.reveal!);
    const undecryptable = decrypted.filter((d) => d.error).length;

    if (pending.length > 0) {
      await this.client.revealBets(marketId, pending);
      this.log("revealed bets", { marketId: id, count: pending.length, undecryptable });
      status = "revealed";
    }
    return { marketId: id, status, revealed: pending.length, undecryptable };
  }

  /** Poll forever. */
  async run(intervalMs: number, signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      try {
        const reports = await this.tick();
        for (const r of reports) if (r.status !== "open" && r.status !== "expired") this.log("tick", { ...r });
      } catch (e) {
        this.log("tick failed", { error: (e as Error).message });
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/** Create a market whose sealer key this keyper will hold. */
export async function createSealedMarket(
  client: BlindspotClient,
  keystore: Keystore,
  p: {
    question: string;
    closeTime: bigint;
    revealDeadline: bigint;
    resolveDeadline: bigint;
    councilPublicKey: Hex;
  },
): Promise<{ marketId: bigint; hash: Hex; sealerPublicKey: Hex }> {
  const kp = keystore.create();
  const { marketId, hash } = await client.createMarket({
    ...p,
    sealerPublicKey: kp.publicKey,
    sealerKeyHash: kp.secretKeyHash,
  });
  keystore.bind(kp.secretKeyHash, {
    chainId: await client.chainId(),
    contract: client.address,
    marketId: marketId.toString(),
    question: p.question,
    closeTime: p.closeTime.toString(),
    revealDeadline: p.revealDeadline.toString(),
  });
  return { marketId, hash, sealerPublicKey: kp.publicKey };
}
