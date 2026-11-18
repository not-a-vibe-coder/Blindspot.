import type { Hex } from "viem";

/** Mirrors `BlindspotMarkets.Side`. */
export enum Side {
  Hidden = 0,
  Yes = 1,
  No = 2,
}

/** Mirrors `BlindspotMarkets.Outcome`. */
export enum Outcome {
  Unresolved = 0,
  Yes = 1,
  No = 2,
  Invalid = 3,
}

/** What a bettor must keep to self-reveal if the sealer ever goes dark. */
export interface BetReceipt {
  chainId: number;
  contract: Hex;
  marketId: bigint;
  betId?: bigint;
  bettor: Hex;
  side: Side.Yes | Side.No;
  salt: Hex;
  commitment: Hex;
}
