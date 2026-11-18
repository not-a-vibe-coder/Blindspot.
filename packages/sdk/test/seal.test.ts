import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import {
  generateSealerKeypair,
  MLKEM1024,
  openSealedSide,
  randomSalt,
  SEALED_SIDE_LENGTH,
  sealSide,
  Side,
} from "../src/index.ts";

const ctx = { chainId: 9800, contract: "0x5FbDB2315678afecb367f032d93F642f64180aa3", marketId: 1n } as const;

describe("ML-KEM-1024 sealing", () => {
  const keys = generateSealerKeypair();

  it("generates FIPS 203 ML-KEM-1024 sized keys and commits the secret by keccak", () => {
    expect((keys.publicKey.length - 2) / 2).toBe(MLKEM1024.publicKeyLength);
    expect((keys.secretKey.length - 2) / 2).toBe(MLKEM1024.secretKeyLength);
    expect(keys.secretKeyHash).toBe(keccak256(keys.secretKey));
  });

  it("round-trips side + salt", () => {
    for (const side of [Side.Yes, Side.No] as const) {
      const salt = randomSalt();
      const sealed = sealSide(keys.publicKey, side, salt, ctx);
      expect((sealed.length - 2) / 2).toBe(SEALED_SIDE_LENGTH);
      expect(openSealedSide(keys.secretKey, sealed, ctx)).toEqual({ side, salt });
    }
  });

  it("produces the exact minimum length the contract accepts (1629 bytes)", () => {
    expect(SEALED_SIDE_LENGTH).toBe(1568 + 12 + 16 + 33);
  });

  it("is randomized: same side never produces the same ciphertext", () => {
    const salt = randomSalt();
    expect(sealSide(keys.publicKey, Side.Yes, salt, ctx)).not.toBe(sealSide(keys.publicKey, Side.Yes, salt, ctx));
  });

  it("can't be moved into another market (AAD binding)", () => {
    const sealed = sealSide(keys.publicKey, Side.Yes, randomSalt(), ctx);
    expect(() => openSealedSide(keys.secretKey, sealed, { ...ctx, marketId: 2n })).toThrow();
  });

  it("can't be opened with another sealer's key", () => {
    const other = generateSealerKeypair();
    const sealed = sealSide(keys.publicKey, Side.No, randomSalt(), ctx);
    expect(() => openSealedSide(other.secretKey, sealed, ctx)).toThrow();
  });

  it("detects tampering", () => {
    const sealed = sealSide(keys.publicKey, Side.No, randomSalt(), ctx);
    const flipped = (sealed.slice(0, -2) + (sealed.endsWith("00") ? "01" : "00")) as `0x${string}`;
    expect(() => openSealedSide(keys.secretKey, flipped, ctx)).toThrow();
  });

  it("rejects bad inputs", () => {
    expect(() => sealSide("0x1234", Side.Yes, randomSalt(), ctx)).toThrow();
    expect(() => sealSide(keys.publicKey, Side.Hidden as never, randomSalt(), ctx)).toThrow();
    expect(() => sealSide(keys.publicKey, Side.Yes, "0x12", ctx)).toThrow();
  });
});
