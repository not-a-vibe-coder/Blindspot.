/**
 * QoreChain account plumbing for Blindspot's operators (deployer, keyper, council relayer).
 *
 * Since chain v3.2.0 an EVM transaction is admitted only from an account that
 *   (a) has a registered ML-DSA-87 (post-quantum) key, and
 *   (b) has an open, unexhausted EVM authorisation window,
 * and the window can only be opened by a Cosmos-lane message carrying a HYBRID
 * (secp256k1 + ML-DSA-87) signature — so a stolen classical key can't authorise itself.
 *
 * An operator account here = one secp256k1 private key (the same 0x key forge / viem use)
 * + one QRC1 recovery code from which its ML-DSA-87 key is derived. Keep both secret,
 * and keep them apart.
 */
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  PUBLIC_ENDPOINTS,
  buildRegisterPqcKeyMsg,
  closeEvmWindowMsg,
  fetchEvmWindow,
  fetchPqcStatus,
  generatePqcRecoveryCode,
  isValidRecoveryCode,
  openEvmWindowMsg,
  signProofOfPossession,
  unifiedAccountFromSeed,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { hexToBytes, type Hex } from "viem";

export const TESTNET = {
  chainId: "qorechain-diana",
  evmChainId: 9800,
  ...PUBLIC_ENDPOINTS.testnet,
} as const;

export const MAINNET = {
  chainId: "qorechain-vladi",
  evmChainId: 9801,
  ...PUBLIC_ENDPOINTS.mainnet,
} as const;

export type QoreNetwork = { chainId: string; evmChainId: number; rest: string; rpc: string; evmRpc?: string };

/** Window bounds enforced by the chain. */
export const MAX_WINDOW_BLOCKS = 17_280;
export const MAX_WINDOW_TXS = 1_000;
export const UQOR_PER_QOR = 1_000_000n;

/** Gas used by the Cosmos-lane admin txs (docs: register 600k, window 400k) at 0.15 uqor/gas. */
const GAS_PRICE_UQOR_NUM = 15n; // 0.15 = 15 / 100
const GAS_PRICE_UQOR_DEN = 100n;
const GAS = { register: 600_000n, window: 400_000n, close: 300_000n } as const;

function fee(gas: bigint) {
  const amount = (gas * GAS_PRICE_UQOR_NUM + GAS_PRICE_UQOR_DEN - 1n) / GAS_PRICE_UQOR_DEN;
  return { amount: [{ denom: "uqor", amount: amount.toString() }], gas: gas.toString() };
}

export function networkFromEnv(env: NodeJS.ProcessEnv = process.env): QoreNetwork {
  const base = env.QORE_NETWORK === "mainnet" ? MAINNET : TESTNET;
  return {
    ...base,
    rest: env.QORE_REST || base.rest,
    rpc: env.QORE_RPC || base.rpc,
    evmRpc: env.RPC_URL || base.evmRpc,
  };
}

/** A fresh QRC1 recovery code (shown once; store it apart from the private key). */
export function newRecoveryCode(): string {
  return generatePqcRecoveryCode();
}

/** Build the unified account (0x / qor1 + ML-DSA-87 key) from a private key and a recovery code. */
export function loadAccount(privateKey: string, recoveryCode: string): UnifiedAccount {
  const pk = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("PRIVATE_KEY must be a 32-byte hex key");
  if (!isValidRecoveryCode(recoveryCode)) throw new Error("PQC_RECOVERY_CODE is not a valid QRC1 recovery code");
  return unifiedAccountFromSeed(hexToBytes(pk), { recoveryCode });
}

export function accountFromEnv(env: NodeJS.ProcessEnv = process.env): UnifiedAccount {
  if (!env.PRIVATE_KEY) throw new Error("missing env PRIVATE_KEY");
  if (!env.PQC_RECOVERY_CODE) {
    throw new Error("missing env PQC_RECOVERY_CODE — run `pnpm account init` once and store the code it prints");
  }
  return loadAccount(env.PRIVATE_KEY, env.PQC_RECOVERY_CODE);
}

// ───────────────────────────── reads ─────────────────────────────

export interface AccountState {
  exists: boolean;
  accountNumber: bigint;
  sequence: bigint;
  balanceUqor: bigint;
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty / non-JSON */
  }
  return { status: res.status, body };
}

/** account_number / sequence (works for BaseAccount and eth-style wrapped accounts) + QOR balance. */
export async function accountState(net: QoreNetwork, address: string): Promise<AccountState> {
  const [acc, bal] = await Promise.all([
    getJson(`${net.rest}/cosmos/auth/v1beta1/accounts/${address}`),
    getJson(`${net.rest}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=uqor`),
  ]);
  const balanceUqor = BigInt(((bal.body as { balance?: { amount?: string } })?.balance?.amount ?? "0") || "0");
  if (acc.status === 404 || (acc.body as { code?: number })?.code === 5) {
    return { exists: false, accountNumber: 0n, sequence: 0n, balanceUqor };
  }
  if (acc.status >= 400) throw new Error(`REST ${acc.status} reading account ${address}`);
  type Raw = { account_number?: string; sequence?: string; base_account?: Raw };
  const a = (acc.body as { account?: Raw }).account ?? {};
  const base = a.base_account ?? a;
  return {
    exists: true,
    accountNumber: BigInt(base.account_number ?? "0"),
    sequence: BigInt(base.sequence ?? "0"),
    balanceUqor,
  };
}

export async function pqcStatus(net: QoreNetwork, account: UnifiedAccount) {
  return fetchPqcStatus({ rest: net.rest, address: account.cosmos });
}

export async function evmWindow(net: QoreNetwork, account: UnifiedAccount) {
  return fetchEvmWindow({ rest: net.rest, address: account.cosmos });
}

// ───────────────────────────── writes ─────────────────────────────

async function broadcast(
  net: QoreNetwork,
  account: UnifiedAccount,
  messages: Parameters<EthNativeSigner["signAndBroadcast"]>[1]["messages"],
  gas: bigint,
  signMode: "hybrid" | "classical",
) {
  const state = await accountState(net, account.cosmos);
  if (!state.exists) {
    throw new Error(`account ${account.cosmos} doesn't exist on-chain yet — fund it from the faucet first`);
  }
  const f = fee(gas);
  if (state.balanceUqor < BigInt(f.amount[0]!.amount)) {
    throw new Error(`not enough QOR for the fee (${f.amount[0]!.amount} uqor needed) — fund ${account.cosmos}`);
  }
  const signer = new EthNativeSigner(account, { signMode, rest: net.rest });
  const transport = await StargateClient.connect(net.rpc);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: net.chainId,
      accountNumber: state.accountNumber,
      sequence: state.sequence,
      fee: f,
      messages,
    });
    if (res.code !== 0) throw new Error(`tx ${res.transactionHash} failed (code ${res.code}): ${res.rawLog ?? ""}`);
    return res;
  } finally {
    transport.disconnect();
  }
}

/**
 * Register the account's ML-DSA-87 key (one time, idempotent). The only Cosmos-lane tx
 * that may be signed classically; carries a proof of possession of the new key.
 */
export async function registerPqcKey(net: QoreNetwork, account: UnifiedAccount) {
  const status = await pqcStatus(net, account);
  if (status.registered) return { alreadyRegistered: true as const };
  const proofOfPossession = signProofOfPossession({ chainId: net.chainId, account: account.cosmos, keypair: account.pqc });
  const msg = buildRegisterPqcKeyMsg(account.cosmos, {
    pqcKeypair: account.pqc,
    ecdsaPubkey: hexToBytes(account.publicKey as Hex),
    proofOfPossession,
  });
  const res = await broadcast(net, account, [msg], GAS.register, "classical");
  return { alreadyRegistered: false as const, txHash: res.transactionHash };
}

export interface WindowParams {
  /** 1 … 17,280 blocks (~1.0–1.3 s each on testnet) */
  blocks: number;
  /** 1 … 1,000 EVM transactions */
  maxTxs: number;
  /** cap on value + max fee of every admitted tx, in QOR */
  maxValueQor: number;
  /** optional: only these 0x recipients (contract creation then refused) */
  allowedTargets?: string[];
}

export function qorToUqor(qor: number): bigint {
  return BigInt(Math.round(qor * 1_000_000));
}

/** Open an EVM authorisation window (hybrid-signed). Note: it advances the account's EVM nonce. */
export async function openWindow(net: QoreNetwork, account: UnifiedAccount, p: WindowParams) {
  const status = await pqcStatus(net, account);
  if (!status.registered) throw new Error("no ML-DSA-87 key registered yet — run `pnpm account register` first");
  const blocks = Math.min(Math.max(1, Math.floor(p.blocks)), MAX_WINDOW_BLOCKS);
  const maxTxs = Math.min(Math.max(1, Math.floor(p.maxTxs)), MAX_WINDOW_TXS);
  const msg = openEvmWindowMsg({
    sender: account.cosmos,
    blocks,
    maxTxs,
    maxValue: qorToUqor(p.maxValueQor).toString(),
    ...(p.allowedTargets?.length ? { allowedTargets: p.allowedTargets } : {}),
  });
  const res = await broadcast(net, account, [msg], GAS.window, "hybrid");
  return { txHash: res.transactionHash, blocks, maxTxs };
}

export async function closeWindow(net: QoreNetwork, account: UnifiedAccount) {
  const res = await broadcast(net, account, [closeEvmWindowMsg(account.cosmos)], GAS.close, "hybrid");
  return { txHash: res.transactionHash };
}

/**
 * Make sure a usable window is open, opening a new one when there is none or it is
 * close to running out (blocks, txs or value). Returns whether it opened one.
 */
export async function ensureWindow(
  net: QoreNetwork,
  account: UnifiedAccount,
  p: WindowParams & { minBlocks?: number; minTxs?: number; minValueQor?: number },
): Promise<{ opened: boolean; txHash?: string }> {
  const w = await evmWindow(net, account);
  const enough =
    w.live &&
    w.remainingBlocks >= BigInt(p.minBlocks ?? 200) &&
    w.remainingTxs >= BigInt(p.minTxs ?? 3) &&
    w.remainingValue >= qorToUqor(p.minValueQor ?? 1);
  if (enough) return { opened: false };
  try {
    const r = await openWindow(net, account, p);
    return { opened: true, txHash: r.txHash };
  } catch (e) {
    // a chain that refuses re-opening over a stored window: close it, then open again
    if (w.found && /window/i.test((e as Error).message) && /exist|already|open/i.test((e as Error).message)) {
      await closeWindow(net, account);
      const r = await openWindow(net, account, p);
      return { opened: true, txHash: r.txHash };
    }
    throw e;
  }
}

export function fmtQor(uqor: bigint): string {
  const whole = uqor / UQOR_PER_QOR;
  const frac = (uqor % UQOR_PER_QOR).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
