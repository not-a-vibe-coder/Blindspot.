"use client";

/**
 * Blindspot account — a post-quantum QoreChain account that lives in this browser.
 *
 * QoreChain (chain v3.2.0+) admits an EVM transaction only from an account that has a
 * registered ML-DSA-87 key AND an open EVM authorisation window, opened by a hybrid-signed
 * Cosmos-lane transaction. Browser wallets can't produce that signature, so for betting we
 * create the account here: one secp256k1 key (EVM + Cosmos) and one QRC1 recovery code that
 * derives its ML-DSA-87 key. The user funds it, activates it (register key + open a window),
 * and bets; every EVM write is then signed locally and relayed as a raw transaction.
 *
 * Testnet convenience: secrets are kept in localStorage — the backup file is the real copy.
 */
import type { UnifiedAccount } from "@qorechain/sdk";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { config } from "./config";

const sdk = () => import("@qorechain/sdk");

export const QORE_CHAIN_ID = config.chainId === 9801 ? "qorechain-vladi" : "qorechain-diana";
export const quantumSupported = config.chainId === 9800 || config.chainId === 9801;
export const FAUCET_URL = "https://dashboard.qorechain.io/faucet";

const KEY = `blindspot:quantum-account:${config.chainId}`;

interface StoredSecret {
  version: 1;
  privateKey: Hex;
  recoveryCode: string;
  evm: Hex;
  qor: string;
  createdAt: number;
}

export interface QuantumSecret extends StoredSecret {}

function rest(): string {
  return `${window.location.origin}/api/qore`;
}

// ───────────────────────────── secrets ─────────────────────────────

export function loadSecret(): QuantumSecret | null {
  if (typeof window === "undefined" || !quantumSupported) return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QuantumSecret) : null;
  } catch {
    return null;
  }
}

function saveSecret(s: QuantumSecret) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("blindspot:quantum"));
}

export function forgetSecret() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("blindspot:quantum"));
}

export async function createSecret(): Promise<QuantumSecret> {
  const { generatePqcRecoveryCode, unifiedAccountFromSeed } = await sdk();
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const recoveryCode = generatePqcRecoveryCode();
  const acct = unifiedAccountFromSeed(seed, { recoveryCode });
  const s: QuantumSecret = {
    version: 1,
    privateKey: bytesToHex(seed),
    recoveryCode,
    evm: acct.evm as Hex,
    qor: acct.cosmos,
    createdAt: Date.now(),
  };
  saveSecret(s);
  return s;
}

export async function importSecret(json: string): Promise<QuantumSecret> {
  const s = JSON.parse(json) as Partial<QuantumSecret>;
  if (!s.privateKey || !s.recoveryCode) throw new Error("not a Blindspot account backup");
  const acct = await unified(s as QuantumSecret);
  const full: QuantumSecret = { version: 1, privateKey: s.privateKey, recoveryCode: s.recoveryCode, evm: acct.evm as Hex, qor: acct.cosmos, createdAt: s.createdAt ?? Date.now() };
  saveSecret(full);
  return full;
}

export function downloadBackup(s: QuantumSecret) {
  const blob = new Blob(
    [
      JSON.stringify(
        { ...s, warning: "Anyone with this file controls the account. Testnet only — keep it private." },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `blindspot-account-${s.evm.slice(2, 8)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function unified(s: Pick<QuantumSecret, "privateKey" | "recoveryCode">): Promise<UnifiedAccount> {
  const { unifiedAccountFromSeed } = await sdk();
  return unifiedAccountFromSeed(hexToBytes(s.privateKey), { recoveryCode: s.recoveryCode });
}

// ───────────────────────────── chain state ─────────────────────────────

export interface QuantumState {
  exists: boolean;
  balanceUqor: bigint;
  accountNumber: bigint;
  sequence: bigint;
  registered: boolean;
  window: {
    live: boolean;
    remainingBlocks: bigint;
    remainingTxs: bigint;
    remainingValue: bigint;
  } | null;
}

async function getJson(path: string) {
  const res = await fetch(`${rest()}/${path}`, { cache: "no-store" });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body };
}

export async function readState(s: QuantumSecret): Promise<QuantumState> {
  const { fetchPqcStatus, fetchEvmWindow } = await sdk();
  const [acc, bal] = await Promise.all([
    getJson(`cosmos/auth/v1beta1/accounts/${s.qor}`),
    getJson(`cosmos/bank/v1beta1/balances/${s.qor}/by_denom?denom=uqor`),
  ]);
  const balanceUqor = BigInt(((bal.body as { balance?: { amount?: string } })?.balance?.amount ?? "0") || "0");
  type Raw = { account_number?: string; sequence?: string; base_account?: Raw };
  const exists = acc.status < 400 && !!(acc.body as { account?: Raw })?.account;
  const a = (acc.body as { account?: Raw })?.account ?? {};
  const base = a.base_account ?? a;

  if (!exists) {
    return { exists: false, balanceUqor, accountNumber: 0n, sequence: 0n, registered: false, window: null };
  }
  const [pqc, w] = await Promise.all([
    fetchPqcStatus({ rest: rest(), address: s.qor }),
    fetchEvmWindow({ rest: rest(), address: s.qor }).catch(() => null),
  ]);
  return {
    exists,
    balanceUqor,
    accountNumber: BigInt(base.account_number ?? "0"),
    sequence: BigInt(base.sequence ?? "0"),
    registered: pqc.registered,
    window: w?.found
      ? { live: w.live, remainingBlocks: w.remainingBlocks, remainingTxs: w.remainingTxs, remainingValue: w.remainingValue }
      : null,
  };
}

// ───────────────────────────── signed Cosmos-lane txs ─────────────────────────────

const GAS = { register: 600_000n, window: 400_000n } as const;
const fee = (gas: bigint) => ({ amount: [{ denom: "uqor", amount: ((gas * 15n + 99n) / 100n).toString() }], gas: gas.toString() });

async function broadcastSigned(txRawBytes: Uint8Array): Promise<string> {
  let b64 = "";
  for (const byte of txRawBytes) b64 += String.fromCharCode(byte);
  const res = await fetch(`${rest()}/cosmos/tx/v1beta1/txs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx_bytes: btoa(b64), mode: "BROADCAST_MODE_SYNC" }),
  });
  const body = (await res.json()) as { tx_response?: { code: number; txhash: string; raw_log?: string } };
  const r = body.tx_response;
  if (!r) throw new Error(`broadcast failed (HTTP ${res.status})`);
  if (r.code !== 0) throw new Error(r.raw_log || `transaction refused (code ${r.code})`);
  // wait for inclusion
  for (let i = 0; i < 30; i++) {
    await new Promise((x) => setTimeout(x, 1200));
    const t = await getJson(`cosmos/tx/v1beta1/txs/${r.txhash}`);
    const tr = (t.body as { tx_response?: { code: number; raw_log?: string } })?.tx_response;
    if (tr) {
      if (tr.code !== 0) throw new Error(tr.raw_log || `transaction failed (code ${tr.code})`);
      return r.txhash;
    }
  }
  throw new Error("transaction not included after 36 s — check the explorer");
}

async function signAndSend(s: QuantumSecret, messages: unknown[], gas: bigint, signMode: "hybrid" | "classical") {
  const { EthNativeSigner } = await sdk();
  const st = await readState(s);
  if (!st.exists) throw new Error("Fund this account from the faucet first.");
  const f = fee(gas);
  if (st.balanceUqor < BigInt(f.amount[0]!.amount)) throw new Error("Not enough QOR for the network fee — claim from the faucet.");
  const acct = await unified(s);
  const signer = new EthNativeSigner(acct, { signMode, rest: rest() });
  const signBytesVersion = await signer.resolveSignBytesVersion(QORE_CHAIN_ID);
  const signed = signer.sign({
    chainId: QORE_CHAIN_ID,
    accountNumber: st.accountNumber,
    sequence: st.sequence,
    fee: f,
    messages: messages as never,
    signBytesVersion,
  });
  return broadcastSigned(signed.txRawBytes);
}

/** One-time: register the account's ML-DSA-87 key (with proof of possession). */
export async function registerKey(s: QuantumSecret): Promise<string> {
  const { buildRegisterPqcKeyMsg, signProofOfPossession } = await sdk();
  const acct = await unified(s);
  const msg = buildRegisterPqcKeyMsg(acct.cosmos, {
    pqcKeypair: acct.pqc,
    ecdsaPubkey: hexToBytes(acct.publicKey as Hex),
    proofOfPossession: signProofOfPossession({ chainId: QORE_CHAIN_ID, account: acct.cosmos, keypair: acct.pqc }),
  });
  return signAndSend(s, [msg], GAS.register, "classical");
}

export interface SessionParams {
  blocks: number; // ≤ 17280
  maxTxs: number; // ≤ 1000
  maxValueUqor: bigint; // value + fees cap
}

/** A betting session = an EVM authorisation window, opened with the post-quantum key. */
export function defaultSession(balanceUqor: bigint): SessionParams {
  const cap = (balanceUqor * 9n) / 10n; // never let the window spend more than 90% of the balance
  return { blocks: 17_280, maxTxs: 200, maxValueUqor: cap > 0n ? cap : 1n };
}

export async function openSession(s: QuantumSecret, p: SessionParams): Promise<string> {
  const { openEvmWindowMsg } = await sdk();
  const msg = openEvmWindowMsg({ sender: s.qor, blocks: p.blocks, maxTxs: p.maxTxs, maxValue: p.maxValueUqor.toString() });
  return signAndSend(s, [msg], GAS.window, "hybrid");
}

/** QoreChain's own words for a refused EVM tx → what the user should do. */
export async function explainWindowError(e: unknown): Promise<string | null> {
  const { classifyEvmWindowRejection } = await sdk();
  switch (classifyEvmWindowRejection(e)) {
    case "no-pqc-key":
      return "This account has no post-quantum key registered on QoreChain yet — activate it first.";
    case "no-window":
      return "No open betting session (EVM window) — open one to keep betting.";
    case "exhausted":
      return "Your betting session ran out — open a new one.";
    case "invalid":
      return "QoreChain refused the session limits.";
    default:
      return null;
  }
}

export function fmtUqor(u: bigint): string {
  const whole = u / 1_000_000n;
  const frac = (u % 1_000_000n).toString().padStart(6, "0").slice(0, 3).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
