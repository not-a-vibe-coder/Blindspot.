import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { Side } from "./types.js";

/**
 * Sealed side format (1629 bytes, = BlindspotMarkets.MIN_SEALED_LEN):
 *
 *   ML-KEM-1024 ciphertext (1568) ‖ nonce (12) ‖ AES-256-GCM( side (1) ‖ salt (32) ) ‖ tag (16)
 *
 * The AES key is HKDF-SHA256 of the ML-KEM shared secret. The market context
 * (chain, contract, market id) is bound in as AAD so a sealed side can't be
 * replayed into another market. ML-KEM-1024 keeps it safe against
 * "harvest now, decrypt later" — a quantum adversary recording the chain
 * today still can't peek at sides before the sealer key is released.
 */
export const MLKEM1024 = {
  publicKeyLength: 1568,
  secretKeyLength: 3168,
  cipherTextLength: 1568,
} as const;
const NONCE_LEN = 12;
const TAG_LEN = 16;
export const SEALED_SIDE_LENGTH = MLKEM1024.cipherTextLength + NONCE_LEN + 1 + 32 + TAG_LEN;

const HKDF_INFO = new TextEncoder().encode("blindspot/seal/v1");

export interface SealContext {
  chainId: number | bigint;
  contract: Hex;
  marketId: bigint;
}

export interface SealerKeypair {
  publicKey: Hex;
  secretKey: Hex;
  /** keccak256(secretKey) — committed on-chain at market creation. */
  secretKeyHash: Hex;
}

/** Fresh ML-KEM-1024 keypair for a market's sealer (the "keyper"). */
export function generateSealerKeypair(seed?: Uint8Array): SealerKeypair {
  const { publicKey, secretKey } = ml_kem1024.keygen(seed);
  return {
    publicKey: bytesToHex(publicKey),
    secretKey: bytesToHex(secretKey),
    secretKeyHash: bytesToHex(keccak_256(secretKey)),
  };
}

function aad(ctx: SealContext): Uint8Array {
  return new TextEncoder().encode(
    `blindspot:${BigInt(ctx.chainId)}:${ctx.contract.toLowerCase()}:${ctx.marketId}`,
  );
}

function aesKey(sharedSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
}

/** Encrypt (side, salt) to the market's sealer public key. */
export function sealSide(
  sealerPublicKey: Hex,
  side: Side.Yes | Side.No,
  salt: Hex,
  ctx: SealContext,
): Hex {
  if (side !== Side.Yes && side !== Side.No) throw new Error("side must be Yes or No");
  const saltBytes = hexToBytes(salt);
  if (saltBytes.length !== 32) throw new Error("salt must be 32 bytes");

  const pk = hexToBytes(sealerPublicKey);
  if (pk.length !== MLKEM1024.publicKeyLength) throw new Error("bad ML-KEM-1024 public key");

  const { cipherText, sharedSecret } = ml_kem1024.encapsulate(pk);
  const nonce = randomBytes(NONCE_LEN);
  const plaintext = new Uint8Array(33);
  plaintext[0] = side;
  plaintext.set(saltBytes, 1);

  const sealed = gcm(aesKey(sharedSecret), nonce, aad(ctx)).encrypt(plaintext);
  sharedSecret.fill(0);

  const out = new Uint8Array(SEALED_SIDE_LENGTH);
  out.set(cipherText, 0);
  out.set(nonce, MLKEM1024.cipherTextLength);
  out.set(sealed, MLKEM1024.cipherTextLength + NONCE_LEN);
  return bytesToHex(out);
}

/** Decrypt a sealed side with the sealer secret key (before or after it's released on-chain). */
export function openSealedSide(
  sealerSecretKey: Hex,
  sealedSide: Hex,
  ctx: SealContext,
): { side: Side.Yes | Side.No; salt: Hex } {
  const data = hexToBytes(sealedSide);
  if (data.length !== SEALED_SIDE_LENGTH) throw new Error("bad sealed side length");

  const ct = data.subarray(0, MLKEM1024.cipherTextLength);
  const nonce = data.subarray(MLKEM1024.cipherTextLength, MLKEM1024.cipherTextLength + NONCE_LEN);
  const body = data.subarray(MLKEM1024.cipherTextLength + NONCE_LEN);

  const sharedSecret = ml_kem1024.decapsulate(ct, hexToBytes(sealerSecretKey));
  const plaintext = gcm(aesKey(sharedSecret), nonce, aad(ctx)).decrypt(body);
  sharedSecret.fill(0);

  const side = plaintext[0];
  if (side !== Side.Yes && side !== Side.No) throw new Error("sealed side holds no valid side");
  return { side, salt: bytesToHex(plaintext.subarray(1, 33)) };
}
