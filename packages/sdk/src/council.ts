import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { bytesToHex, encodePacked, hexToBytes, type Hex } from "viem";
import { Outcome } from "./types.ts";

/** ML-DSA-87 sizes accepted by QoreChain's 0x0a01 precompile. */
export const MLDSA87 = {
  publicKeyLength: 2592,
  secretKeyLength: 4896,
  signatureLength: 4627,
} as const;

export interface CouncilKeypair {
  publicKey: Hex;
  secretKey: Hex;
}

/** Fresh ML-DSA-87 keypair for a market's resolution council. */
export function generateCouncilKeypair(seed?: Uint8Array): CouncilKeypair {
  const { publicKey, secretKey } = ml_dsa87.keygen(seed);
  return { publicKey: bytesToHex(publicKey), secretKey: bytesToHex(secretKey) };
}

/**
 * Same bytes as `BlindspotMarkets.resolutionMessage`:
 * abi.encodePacked("BLINDSPOT_RESOLVE_V1", chainid, contract, marketId, uint8(outcome))
 */
export function resolutionMessage(args: {
  chainId: number | bigint;
  contract: Hex;
  marketId: bigint;
  outcome: Outcome;
}): Hex {
  return encodePacked(
    ["string", "uint256", "address", "uint256", "uint8"],
    ["BLINDSPOT_RESOLVE_V1", BigInt(args.chainId), args.contract, args.marketId, args.outcome],
  );
}

/**
 * Deterministic ML-DSA-87 signature (no extra entropy, empty context) — the variant
 * QoreChain's verifier is specified against.
 */
export function signResolution(
  councilSecretKey: Hex,
  args: Parameters<typeof resolutionMessage>[0],
): Hex {
  const msg = hexToBytes(resolutionMessage(args));
  const sig = ml_dsa87.sign(msg, hexToBytes(councilSecretKey), { extraEntropy: false });
  return bytesToHex(sig);
}

/** Local check, same math as the on-chain precompile. */
export function verifyResolution(
  councilPublicKey: Hex,
  signature: Hex,
  args: Parameters<typeof resolutionMessage>[0],
): boolean {
  return ml_dsa87.verify(hexToBytes(signature), hexToBytes(resolutionMessage(args)), hexToBytes(councilPublicKey));
}
