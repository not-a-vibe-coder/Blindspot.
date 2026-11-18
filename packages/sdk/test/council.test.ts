import { describe, expect, it } from "vitest";
import {
  generateCouncilKeypair,
  MLDSA87,
  Outcome,
  resolutionMessage,
  signResolution,
  verifyResolution,
} from "../src/index.ts";

const args = {
  chainId: 31337,
  contract: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  marketId: 7n,
  outcome: Outcome.No,
} as const;

describe("ML-DSA-87 council", () => {
  const council = generateCouncilKeypair();

  it("matches BlindspotMarkets.resolutionMessage byte for byte", () => {
    // from `cast call resolutionMessage(7, 2)` on Anvil
    expect(resolutionMessage(args)).toBe(
      "0x424c494e4453504f545f5245534f4c56455f56310000000000000000000000000000000000000000000000000000000000007a695fbdb2315678afecb367f032d93f642f64180aa3000000000000000000000000000000000000000000000000000000000000000702",
    );
  });

  it("produces precompile-sized keys and signatures", () => {
    expect((council.publicKey.length - 2) / 2).toBe(MLDSA87.publicKeyLength);
    expect((council.secretKey.length - 2) / 2).toBe(MLDSA87.secretKeyLength);
    const sig = signResolution(council.secretKey, args);
    expect((sig.length - 2) / 2).toBe(MLDSA87.signatureLength);
  });

  it("signs deterministically and verifies", () => {
    const a = signResolution(council.secretKey, args);
    expect(signResolution(council.secretKey, args)).toBe(a);
    expect(verifyResolution(council.publicKey, a, args)).toBe(true);
  });

  it("a signature is bound to its outcome and market", () => {
    const sig = signResolution(council.secretKey, args);
    expect(verifyResolution(council.publicKey, sig, { ...args, outcome: Outcome.Yes })).toBe(false);
    expect(verifyResolution(council.publicKey, sig, { ...args, marketId: 8n })).toBe(false);
  });
});
