import { encodeAbiParameters, keccak256, toHex, type Hex } from "viem";
import { randomBytes } from "@noble/hashes/utils.js";
import { Side } from "./types.js";

/**
 * Same as `BlindspotMarkets.commitmentFor`:
 * keccak256(abi.encode(chainid, contract, marketId, bettor, side, salt))
 */
export function commitmentFor(args: {
  chainId: number | bigint;
  contract: Hex;
  marketId: bigint;
  bettor: Hex;
  side: Side;
  salt: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint8" },
        { type: "bytes32" },
      ],
      [BigInt(args.chainId), args.contract, args.marketId, args.bettor, args.side, args.salt],
    ),
  );
}

/** 32 bytes of CSPRNG salt. */
export function randomSalt(): Hex {
  return toHex(randomBytes(32));
}
