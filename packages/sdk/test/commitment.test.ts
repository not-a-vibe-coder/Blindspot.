import { describe, expect, it } from "vitest";
import { commitmentFor, randomSalt, Side } from "../src/index.js";

// Vector produced by `cast call commitmentFor(...)` against BlindspotMarkets on Anvil (chain 31337).
const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const BETTOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SALT = `0x${"11".repeat(32)}` as const;

describe("commitmentFor", () => {
  it("matches the Solidity implementation byte for byte", () => {
    expect(
      commitmentFor({ chainId: 31337, contract: CONTRACT, marketId: 7n, bettor: BETTOR, side: Side.Yes, salt: SALT }),
    ).toBe("0x7c892348f0419d10e2ca68b4d14261ffa67df00c762b07ceb8d412edbb15e3c9");
  });

  it("changes with the side", () => {
    const base = { chainId: 31337, contract: CONTRACT, marketId: 7n, bettor: BETTOR, salt: SALT } as const;
    expect(commitmentFor({ ...base, side: Side.Yes })).not.toBe(commitmentFor({ ...base, side: Side.No }));
  });

  it("random salts are 32 bytes and unique", () => {
    const a = randomSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(randomSalt()).not.toBe(a);
  });
});
