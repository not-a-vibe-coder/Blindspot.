import {
  parseEventLogs,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { blindspotMarketsAbi } from "./abi.js";
import { commitmentFor, randomSalt } from "./commitment.js";
import { sealSide, openSealedSide, type SealContext } from "./seal.js";
import { Outcome, Side, type BetReceipt } from "./types.js";

export interface MarketInfo {
  marketId: bigint;
  creator: Hex;
  question: string;
  closeTime: bigint;
  revealDeadline: bigint;
  resolveDeadline: bigint;
  sealerPublicKey: Hex;
  councilPublicKey: Hex;
  createdAtBlock: bigint;
}

export interface SealedBet {
  marketId: bigint;
  betId: bigint;
  bettor: Hex;
  amount: bigint;
  commitment: Hex;
  sealedSide: Hex;
  blockNumber: bigint;
}

export interface Reveal {
  betId: bigint;
  side: Side.Yes | Side.No;
  salt: Hex;
}

export interface BlindspotClientConfig {
  address: Hex;
  publicClient: PublicClient;
  walletClient?: WalletClient<Transport, Chain, Account>;
  /** Block the contract was deployed at — log scans start here. */
  fromBlock?: bigint;
  /** Max block range per eth_getLogs call (public RPCs cap this). */
  logChunk?: bigint;
}

/**
 * High-level Blindspot client for the frontend and the keeper services.
 * Reads go through `publicClient`; writes need `walletClient`.
 */
export class BlindspotClient {
  readonly address: Hex;
  readonly publicClient: PublicClient;
  readonly walletClient?: WalletClient<Transport, Chain, Account>;
  readonly fromBlock: bigint;
  readonly logChunk: bigint;

  constructor(cfg: BlindspotClientConfig) {
    this.address = cfg.address;
    this.publicClient = cfg.publicClient;
    this.walletClient = cfg.walletClient;
    this.fromBlock = cfg.fromBlock ?? 0n;
    this.logChunk = cfg.logChunk ?? 5_000n;
  }

  // ───────────────────────────── reads ─────────────────────────────

  async chainId(): Promise<number> {
    return this.publicClient.getChainId();
  }

  async sealContext(marketId: bigint): Promise<SealContext> {
    return { chainId: await this.chainId(), contract: this.address, marketId };
  }

  read() {
    const base = { address: this.address, abi: blindspotMarketsAbi } as const;
    const pc = this.publicClient;
    return {
      marketCount: () => pc.readContract({ ...base, functionName: "marketCount" }),
      market: (id: bigint) => pc.readContract({ ...base, functionName: "getMarket", args: [id] }),
      pool: (id: bigint) => pc.readContract({ ...base, functionName: "getPool", args: [id] }),
      bet: (id: bigint, betId: bigint) => pc.readContract({ ...base, functionName: "getBet", args: [id, betId] }),
      resolution: (id: bigint) => pc.readContract({ ...base, functionName: "getResolution", args: [id] }),
      proposal: (id: bigint) => pc.readContract({ ...base, functionName: "getProposal", args: [id] }),
      keyReleased: (id: bigint) => pc.readContract({ ...base, functionName: "sealerKeyReleased", args: [id] }),
      previewPayout: (id: bigint, betId: bigint) =>
        pc.readContract({ ...base, functionName: "previewPayout", args: [id, betId] }),
      credits: (who: Hex) => pc.readContract({ ...base, functionName: "credits", args: [who] }),
      proposalBond: () => pc.readContract({ ...base, functionName: "proposalBond" }),
    };
  }

  /** Market metadata + the public keys, from its MarketCreated log. */
  async getMarketInfo(marketId: bigint): Promise<MarketInfo> {
    const logs = await this.scan("MarketCreated", { marketId });
    const log = logs[0];
    if (!log) throw new Error(`market ${marketId} not found`);
    const a = log.args as {
      marketId: bigint;
      creator: Hex;
      question: string;
      closeTime: bigint;
      revealDeadline: bigint;
      resolveDeadline: bigint;
      sealerPublicKey: Hex;
      councilPublicKey: Hex;
    };
    return { ...a, createdAtBlock: log.blockNumber };
  }

  async listMarkets(): Promise<MarketInfo[]> {
    const logs = await this.scan("MarketCreated");
    return logs.map((log) => ({ ...(log.args as Omit<MarketInfo, "createdAtBlock">), createdAtBlock: log.blockNumber }));
  }

  /** Every sealed bet in a market (the "blind tape"). */
  async getSealedBets(marketId: bigint, fromBlock?: bigint): Promise<SealedBet[]> {
    const logs = await this.scan("BetPlaced", { marketId }, fromBlock);
    return logs.map((log) => ({
      ...(log.args as Omit<SealedBet, "blockNumber">),
      blockNumber: log.blockNumber,
    }));
  }

  /** The released ML-KEM secret key, if the keyper has published it. */
  async getReleasedSealerKey(marketId: bigint): Promise<Hex | undefined> {
    const logs = await this.scan("SealerKeyReleased", { marketId });
    return (logs[0]?.args as { secretKey: Hex } | undefined)?.secretKey;
  }

  /** Once the key is public, anyone can decrypt every bet and audit the reveals. */
  async decryptAll(marketId: bigint, secretKey: Hex): Promise<{ bet: SealedBet; reveal?: Reveal; error?: string }[]> {
    const ctx = await this.sealContext(marketId);
    const bets = await this.getSealedBets(marketId);
    return bets.map((bet) => {
      try {
        const { side, salt } = openSealedSide(secretKey, bet.sealedSide, ctx);
        const ok = commitmentFor({ ...ctx, bettor: bet.bettor, side, salt }) === bet.commitment;
        return ok ? { bet, reveal: { betId: bet.betId, side, salt } } : { bet, error: "commitment mismatch" };
      } catch (e) {
        return { bet, error: (e as Error).message };
      }
    });
  }

  // ───────────────────────────── writes ────────────────────────────

  private wallet() {
    if (!this.walletClient) throw new Error("walletClient required for writes");
    return this.walletClient;
  }

  private async write(functionName: string, args: readonly unknown[], value?: bigint): Promise<Hex> {
    const wc = this.wallet();
    const { request } = await this.publicClient.simulateContract({
      address: this.address,
      abi: blindspotMarketsAbi,
      functionName: functionName as never,
      args: args as never,
      value,
      account: wc.account,
    } as never);
    const hash = await wc.writeContract(request as never);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
    return hash;
  }

  async createMarket(p: {
    question: string;
    closeTime: bigint;
    revealDeadline: bigint;
    resolveDeadline: bigint;
    sealerPublicKey: Hex;
    sealerKeyHash: Hex;
    councilPublicKey: Hex;
  }): Promise<{ hash: Hex; marketId: bigint }> {
    const hash = await this.write("createMarket", [
      p.question,
      p.closeTime,
      p.revealDeadline,
      p.resolveDeadline,
      p.sealerPublicKey,
      p.sealerKeyHash,
      p.councilPublicKey,
    ]);
    const receipt = await this.publicClient.getTransactionReceipt({ hash });
    const [ev] = parseEventLogs({ abi: blindspotMarketsAbi, logs: receipt.logs, eventName: "MarketCreated" });
    return { hash, marketId: ev!.args.marketId };
  }

  /**
   * Bet blind: seals the side to the market's ML-KEM-1024 key and commits to it.
   * Returns a receipt the bettor should keep — it lets them self-reveal if the sealer goes dark.
   */
  async placeSealedBet(p: { marketId: bigint; side: Side.Yes | Side.No; amount: bigint }): Promise<{
    hash: Hex;
    receipt: BetReceipt;
  }> {
    const wc = this.wallet();
    const info = await this.getMarketInfo(p.marketId);
    const ctx = await this.sealContext(p.marketId);
    const salt = randomSalt();
    const bettor = wc.account.address;
    const commitment = commitmentFor({ ...ctx, bettor, side: p.side, salt });
    const sealedSide = sealSide(info.sealerPublicKey, p.side, salt, ctx);

    const hash = await this.write("placeBet", [p.marketId, commitment, sealedSide], p.amount);
    const txr = await this.publicClient.getTransactionReceipt({ hash });
    const [ev] = parseEventLogs({ abi: blindspotMarketsAbi, logs: txr.logs, eventName: "BetPlaced" });

    return {
      hash,
      receipt: {
        chainId: Number(ctx.chainId),
        contract: this.address,
        marketId: p.marketId,
        betId: ev?.args.betId,
        bettor,
        side: p.side,
        salt,
        commitment,
      },
    };
  }

  releaseSealerKey(marketId: bigint, secretKey: Hex) {
    return this.write("releaseSealerKey", [marketId, secretKey]);
  }

  /** Reveal in batches (QoreChain gas limits) — returns one tx hash per batch. */
  async revealBets(marketId: bigint, reveals: Reveal[], batchSize = 50): Promise<Hex[]> {
    const hashes: Hex[] = [];
    for (let i = 0; i < reveals.length; i += batchSize) {
      const chunk = reveals.slice(i, i + batchSize);
      hashes.push(
        await this.write("revealBets", [
          marketId,
          chunk.map((r) => r.betId),
          chunk.map((r) => r.side),
          chunk.map((r) => r.salt),
        ]),
      );
    }
    return hashes;
  }

  /** Self-reveal from a saved BetReceipt. */
  selfReveal(receipt: BetReceipt) {
    if (receipt.betId === undefined) throw new Error("receipt has no betId");
    return this.revealBets(receipt.marketId, [{ betId: receipt.betId, side: receipt.side, salt: receipt.salt }]);
  }

  async proposeOutcome(marketId: bigint, outcome: Outcome.Yes | Outcome.No | Outcome.Invalid) {
    const bond = await this.read().proposalBond();
    return this.write("proposeOutcome", [marketId, outcome], bond);
  }

  async disputeOutcome(marketId: bigint) {
    const p = await this.read().proposal(marketId);
    return this.write("disputeOutcome", [marketId], p.bond);
  }

  settle(marketId: bigint) {
    return this.write("settle", [marketId]);
  }

  resolveByCouncil(marketId: bigint, outcome: Outcome, councilPublicKey: Hex, signature: Hex) {
    return this.write("resolveByCouncil", [marketId, outcome, councilPublicKey, signature]);
  }

  claim(marketId: bigint, betId: bigint) {
    return this.write("claim", [marketId, betId]);
  }

  collectFees(marketId: bigint) {
    return this.write("collectFees", [marketId]);
  }

  withdrawCredits() {
    return this.write("withdrawCredits", []);
  }

  // ───────────────────────────── logs ─────────────────────────────

  private async scan(
    eventName: "MarketCreated" | "BetPlaced" | "SealerKeyReleased" | "BetRevealed" | "MarketResolved",
    args?: Record<string, unknown>,
    fromBlock?: bigint,
  ) {
    const latest = await this.publicClient.getBlockNumber({ cacheTime: 0 });
    const out = [];
    for (let from = fromBlock ?? this.fromBlock; from <= latest; from += this.logChunk) {
      const to = from + this.logChunk - 1n > latest ? latest : from + this.logChunk - 1n;
      const logs = await this.publicClient.getContractEvents({
        address: this.address,
        abi: blindspotMarketsAbi,
        eventName,
        args: args as never,
        fromBlock: from,
        toBlock: to,
      });
      out.push(...logs);
    }
    return out;
  }
}
