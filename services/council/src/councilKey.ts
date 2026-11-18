import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { gcm } from "@noble/ciphers/aes.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { bytesToHex, hexToBytes, keccak256, type Hex } from "viem";
import { generateCouncilKeypair, MLDSA87 } from "@blindspot/sdk";

/**
 * council.json — the ML-DSA-87 public key in the clear (it goes on-chain at market creation)
 * and the secret key encrypted with COUNCIL_PASSPHRASE (scrypt → AES-256-GCM).
 * Keep this file offline; signing needs no RPC, so the council can sign air-gapped.
 */
export interface CouncilKeyFile {
  version: 1;
  algorithm: "ML-DSA-87";
  publicKey: Hex;
  publicKeyHash: Hex;
  crypto: { kdf: "scrypt"; n: number; r: number; p: number; salt: Hex; nonce: Hex; ciphertext: Hex };
}

const KDF = { n: 2 ** 17, r: 8, p: 1 };

function derive(passphrase: string, salt: Uint8Array, n: number, r: number, p: number) {
  if (!passphrase || passphrase.length < 12) throw new Error("COUNCIL_PASSPHRASE must be at least 12 characters");
  return scrypt(new TextEncoder().encode(passphrase), salt, { N: n, r, p, dkLen: 32 });
}

export function createCouncilKeyFile(path: string, passphrase: string, overwrite = false): CouncilKeyFile {
  if (existsSync(path) && !overwrite) throw new Error(`${path} exists — refusing to overwrite a council key`);
  const kp = generateCouncilKeypair();
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const publicKeyHash = keccak256(kp.publicKey);
  const ciphertext = gcm(derive(passphrase, salt, KDF.n, KDF.r, KDF.p), nonce, hexToBytes(publicKeyHash)).encrypt(
    hexToBytes(kp.secretKey),
  );
  const file: CouncilKeyFile = {
    version: 1,
    algorithm: "ML-DSA-87",
    publicKey: kp.publicKey,
    publicKeyHash,
    crypto: { kdf: "scrypt", ...KDF, salt: bytesToHex(salt), nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) },
  };
  writeFileSync(path, JSON.stringify(file, null, 2));
  chmodSync(path, 0o600);
  return file;
}

export function readCouncilKeyFile(path: string): CouncilKeyFile {
  const file = JSON.parse(readFileSync(path, "utf8")) as CouncilKeyFile;
  if (file.algorithm !== "ML-DSA-87") throw new Error("not an ML-DSA-87 council key");
  if ((file.publicKey.length - 2) / 2 !== MLDSA87.publicKeyLength) throw new Error("bad public key length");
  if (keccak256(file.publicKey) !== file.publicKeyHash) throw new Error("public key hash mismatch");
  return file;
}

export function unlockCouncilKey(file: CouncilKeyFile, passphrase: string): Hex {
  const c = file.crypto;
  const key = derive(passphrase, hexToBytes(c.salt), c.n, c.r, c.p);
  return bytesToHex(gcm(key, hexToBytes(c.nonce), hexToBytes(file.publicKeyHash)).decrypt(hexToBytes(c.ciphertext)));
}
