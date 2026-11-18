import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { gcm } from "@noble/ciphers/aes.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generateSealerKeypair, type SealerKeypair } from "@blindspot/sdk";

/**
 * On-disk store of every market's ML-KEM-1024 sealer key.
 *
 * Secret keys are encrypted at rest (scrypt N=2^17 → AES-256-GCM) with KEYPER_PASSPHRASE.
 * A key is "pending" until a market is created with it, then bound to (contract, marketId).
 */
export interface StoredKey {
  version: 1;
  publicKey: Hex;
  secretKeyHash: Hex;
  createdAt: number;
  chainId?: number;
  contract?: Hex;
  marketId?: string;
  question?: string;
  closeTime?: string;
  revealDeadline?: string;
  released?: boolean;
  crypto: { kdf: "scrypt"; n: number; r: number; p: number; salt: Hex; nonce: Hex; ciphertext: Hex };
}

const KDF = { n: 2 ** 17, r: 8, p: 1 };

export class Keystore {
  constructor(
    readonly dir: string,
    private readonly passphrase: string,
  ) {
    if (!passphrase || passphrase.length < 12) throw new Error("KEYPER_PASSPHRASE must be at least 12 characters");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private path(secretKeyHash: Hex) {
    return join(this.dir, `${secretKeyHash.slice(2, 18)}.keystore.json`);
  }

  private deriveKey(salt: Uint8Array, n = KDF.n, r = KDF.r, p = KDF.p) {
    return scrypt(new TextEncoder().encode(this.passphrase), salt, { N: n, r, p, dkLen: 32 });
  }

  /** Generate a new sealer keypair and persist it (encrypted). */
  create(): SealerKeypair {
    const kp = generateSealerKeypair();
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const ciphertext = gcm(this.deriveKey(salt), nonce, hexToBytes(kp.secretKeyHash)).encrypt(hexToBytes(kp.secretKey));

    const stored: StoredKey = {
      version: 1,
      publicKey: kp.publicKey,
      secretKeyHash: kp.secretKeyHash,
      createdAt: Date.now(),
      crypto: { kdf: "scrypt", ...KDF, salt: bytesToHex(salt), nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) },
    };
    this.write(stored);
    return kp;
  }

  /** Decrypt a stored secret key. Throws on a wrong passphrase or a tampered file. */
  unlock(stored: StoredKey): Hex {
    const c = stored.crypto;
    const key = this.deriveKey(hexToBytes(c.salt), c.n, c.r, c.p);
    const sk = gcm(key, hexToBytes(c.nonce), hexToBytes(stored.secretKeyHash)).decrypt(hexToBytes(c.ciphertext));
    return bytesToHex(sk);
  }

  /** Bind a pending key to the market it was used for. */
  bind(secretKeyHash: Hex, meta: Required<Pick<StoredKey, "chainId" | "contract" | "marketId" | "question" | "closeTime" | "revealDeadline">>) {
    const stored = this.get(secretKeyHash);
    this.write({ ...stored, ...meta, released: false });
  }

  markReleased(secretKeyHash: Hex) {
    this.write({ ...this.get(secretKeyHash), released: true });
  }

  get(secretKeyHash: Hex): StoredKey {
    const p = this.path(secretKeyHash);
    if (!existsSync(p)) throw new Error(`no key ${secretKeyHash}`);
    return JSON.parse(readFileSync(p, "utf8"));
  }

  list(): StoredKey[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".keystore.json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as StoredKey);
  }

  /** Keys bound to markets on this deployment. */
  markets(chainId: number, contract: Hex): StoredKey[] {
    return this.list().filter(
      (k) => k.marketId !== undefined && k.chainId === chainId && k.contract?.toLowerCase() === contract.toLowerCase(),
    );
  }

  private write(stored: StoredKey) {
    const p = this.path(stored.secretKeyHash);
    writeFileSync(p, JSON.stringify(stored, null, 2));
    chmodSync(p, 0o600);
  }
}
