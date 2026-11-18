import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { Keystore } from "../src/keystore.js";

const PASS = "correct horse battery staple";

describe("Keystore", () => {
  const dir = mkdtempSync(join(tmpdir(), "keyper-"));
  const ks = new Keystore(dir, PASS);
  const kp = ks.create();

  it("never writes the secret key in plaintext", () => {
    const [file] = readdirSync(dir);
    const raw = readFileSync(join(dir, file!), "utf8");
    expect(raw).not.toContain(kp.secretKey.slice(2, 66));
    expect(statSync(join(dir, file!)).mode & 0o777).toBe(0o600);
  });

  it("unlocks back to the exact secret key", () => {
    const stored = ks.get(kp.secretKeyHash);
    const sk = ks.unlock(stored);
    expect(sk).toBe(kp.secretKey);
    expect(keccak256(sk)).toBe(stored.secretKeyHash);
  });

  it("rejects a wrong passphrase", () => {
    const other = new Keystore(dir, "not the right passphrase");
    expect(() => other.unlock(ks.get(kp.secretKeyHash))).toThrow();
  });

  it("detects a tampered file", () => {
    const [file] = readdirSync(dir);
    const p = join(dir, file!);
    const stored = JSON.parse(readFileSync(p, "utf8"));
    const evil = { ...stored, crypto: { ...stored.crypto, ciphertext: stored.crypto.ciphertext.replace(/.$/, "0") } };
    if (evil.crypto.ciphertext === stored.crypto.ciphertext) evil.crypto.ciphertext = stored.crypto.ciphertext.replace(/.$/, "1");
    writeFileSync(p, JSON.stringify(evil));
    expect(() => ks.unlock(ks.get(kp.secretKeyHash))).toThrow();
    writeFileSync(p, JSON.stringify(stored));
  });

  it("binds keys to markets and filters by deployment", () => {
    ks.bind(kp.secretKeyHash, {
      chainId: 9800,
      contract: "0x00000000000000000000000000000000000000AA",
      marketId: "1",
      question: "q",
      closeTime: "1",
      revealDeadline: "2",
    });
    expect(ks.markets(9800, "0x00000000000000000000000000000000000000aa")).toHaveLength(1);
    expect(ks.markets(9801, "0x00000000000000000000000000000000000000aa")).toHaveLength(0);
    ks.markReleased(kp.secretKeyHash);
    expect(ks.get(kp.secretKeyHash).released).toBe(true);
  });

  it("refuses weak passphrases", () => {
    expect(() => new Keystore(dir, "short")).toThrow();
  });
}, 60_000);
