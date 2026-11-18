import { defineChain, type Chain } from "viem";

/** QoreChain testnet — Cosmos chain id `qorechain-diana`, EVM lane chain id 9800. */
export const qorechainTestnet: Chain = defineChain({
  id: 9800,
  name: "QoreChain Testnet (Diana)",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evm-testnet.qore.host"] },
  },
  testnet: true,
});

/** QoreChain mainnet — Cosmos chain id `qorechain-vladi`, EVM lane chain id 9801. */
export const qorechainMainnet: Chain = defineChain({
  id: 9801,
  name: "QoreChain",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evm.qore.host"] },
  },
  blockExplorers: {
    default: { name: "QoreChain Explorer", url: "https://explore.qore.network" },
  },
});

/** QoreChain precompiles used by Blindspot. */
export const QORE_PRECOMPILES = {
  pqcVerify: "0x0000000000000000000000000000000000000a01",
  pqcKeyStatus: "0x0000000000000000000000000000000000000a02",
} as const;
