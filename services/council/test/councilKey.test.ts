import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Outcome, signResolution, verifyResolution } from "@blindspot/sdk";
import { createCouncilKeyFile, readCouncilKeyFile, unlockCouncilKey } from "../src/councilKey.js";

const PASS = "council passphrase for tests";

describe("council key file", () => {
  const path = join(mkdtempSync(join(tmpdir(), "council-")), "council.json");
  const created = createCouncilKeyFile(path, PASS);

  it("stores the secret encrypted with 0600 permissions", () => {
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const raw = readFileSync(path, "utf8");
    const sk = unlockCouncilKey(created, PASS);
    // bytes 0..32 of an ML-DSA secret key are the public seed rho (also in the public key);
    // bytes 32..64 are the secret seed K — that must never appear in the file.
    const secretSeed = sk.slice(2 + 64, 2 + 128);
    expect(raw).not.toContain(secretSeed);
  });

  it("unlocks to a key that signs resolutions the public key verifies", () => {
    const file = readCouncilKeyFile(path);
    const sk = unlockCouncilKey(file, PASS);
    const args = { chainId: 9800, contract: "0x5FbDB2315678afecb367f032d93F642f64180aa3", marketId: 1n, outcome: Outcome.Yes } as const;
    expect(verifyResolution(file.publicKey, signResolution(sk, args), args)).toBe(true);
  });

  it("refuses to overwrite an existing council key", () => {
    expect(() => createCouncilKeyFile(path, PASS)).toThrow(/refusing/);
  });

  it("rejects the wrong passphrase", () => {
    expect(() => unlockCouncilKey(readCouncilKeyFile(path), "definitely the wrong one")).toThrow();
  });
}, 60_000);
