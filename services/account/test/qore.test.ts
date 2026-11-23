import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  openEvmWindowMsg,
  signProofOfPossession,
  verifyProofOfPossession,
} from "@qorechain/sdk";
import { hexToBytes, type Hex } from "viem";
import { loadAccount, newRecoveryCode, qorToUqor, TESTNET, fmtQor } from "../src/qore.ts";

// anvil dev key #0 — public test vector, never funded on QoreChain
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("operator account", () => {
  const code = newRecoveryCode();
  const acct = loadAccount(PK, code);

  it("maps the private key to the same 0x address forge/viem use, plus its qor1 form", () => {
    expect(acct.evm.toLowerCase()).toBe(privateKeyToAccount(PK).address.toLowerCase());
    expect(acct.cosmos.startsWith("qor1")).toBe(true);
  });

  it("derives a deterministic ML-DSA-87 key from the recovery code", () => {
    const again = loadAccount(PK, code);
    expect(Buffer.from(again.pqc.publicKey).equals(Buffer.from(acct.pqc.publicKey))).toBe(true);
    expect(acct.pqc.publicKey.length).toBe(2592);
    const other = loadAccount(PK, newRecoveryCode());
    expect(Buffer.from(other.pqc.publicKey).equals(Buffer.from(acct.pqc.publicKey))).toBe(false);
  });

  it("rejects bad inputs", () => {
    expect(() => loadAccount("0x1234", code)).toThrow(/32-byte/);
    expect(() => loadAccount(PK, "QRC1-NOPE")).toThrow(/recovery code/);
  });

  it("proof of possession verifies for this account and chain only", () => {
    const proof = signProofOfPossession({ chainId: TESTNET.chainId, account: acct.cosmos, keypair: acct.pqc });
    expect(verifyProofOfPossession({ chainId: TESTNET.chainId, account: acct.cosmos, publicKey: acct.pqc.publicKey, proof })).toBe(true);
    expect(verifyProofOfPossession({ chainId: "qorechain-vladi", account: acct.cosmos, publicKey: acct.pqc.publicKey, proof })).toBe(false);
  });

  it("builds and classically signs the registration tx offline", () => {
    const msg = buildRegisterPqcKeyMsg(acct.cosmos, {
      pqcKeypair: acct.pqc,
      ecdsaPubkey: hexToBytes(acct.publicKey as Hex),
      proofOfPossession: signProofOfPossession({ chainId: TESTNET.chainId, account: acct.cosmos, keypair: acct.pqc }),
    });
    expect(msg.typeUrl).toBe("/qorechain.pqc.v1.MsgRegisterPQCKeyV2");
    const signer = new EthNativeSigner(acct, { signMode: "classical", signBytesVersion: "v2" });
    const signed = signer.sign({
      chainId: TESTNET.chainId,
      accountNumber: 7n,
      sequence: 0n,
      fee: { amount: [{ denom: "uqor", amount: "90000" }], gas: "600000" },
      messages: [msg],
      signBytesVersion: "v2",
    });
    expect(signed).toBeTruthy();
  });

  it("builds and hybrid-signs an EVM window tx offline", () => {
    const msg = openEvmWindowMsg({ sender: acct.cosmos, blocks: 3000, maxTxs: 25, maxValue: qorToUqor(25).toString() });
    expect(msg.typeUrl).toMatch(/MsgOpenEVMWindow$/);
    const signer = new EthNativeSigner(acct, { signMode: "hybrid", signBytesVersion: "v2" });
    const signed = signer.sign({
      chainId: TESTNET.chainId,
      accountNumber: 7n,
      sequence: 1n,
      fee: { amount: [{ denom: "uqor", amount: "60000" }], gas: "400000" },
      messages: [msg],
      signBytesVersion: "v2",
    });
    expect(signed).toBeTruthy();
  });

  it("window bounds are checked before anything is sent", () => {
    expect(() => openEvmWindowMsg({ sender: acct.cosmos, blocks: 20_000, maxTxs: 1, maxValue: "1" })).toThrow();
    expect(() => openEvmWindowMsg({ sender: acct.cosmos, blocks: 10, maxTxs: 1, maxValue: "0" })).toThrow();
  });

  it("formats uqor", () => {
    expect(qorToUqor(25)).toBe(25_000_000n);
    expect(fmtQor(1_500_000n)).toBe("1.5");
    expect(fmtQor(100_000_000n)).toBe("100");
  });
}, 60_000);
