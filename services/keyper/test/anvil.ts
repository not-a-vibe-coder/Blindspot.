import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createPublicClient, createTestClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { blindspotMarketsAbi } from "@blindspot/sdk";

/** Throwaway Anvil node with BlindspotMarkets deployed and MockPQCVerify at 0x0a01. */
export const ANVIL = process.env.ANVIL_BIN ?? resolve(homedir(), ".foundry/bin/anvil");
const OUT = resolve(import.meta.dirname, "../../../contracts/out");
export const anvilAvailable = existsSync(ANVIL) && existsSync(resolve(OUT, "BlindspotMarkets.sol"));

export const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const;

export const artifact = (name: string) =>
  JSON.parse(readFileSync(resolve(OUT, `${name}.sol`, `${name}.json`), "utf8"));

export async function startAnvil() {
  const port = 8900 + Math.floor(Math.random() * 500);
  const rpc = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn(ANVIL, ["--port", String(port), "--silent"], { stdio: "ignore" });
  const publicClient = createPublicClient({ chain: foundry, transport: http(rpc) });
  const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(rpc) });
  const wallets = KEYS.map((k) => createWalletClient({ chain: foundry, transport: http(rpc), account: privateKeyToAccount(k) }));

  for (let i = 0; i < 50; i++) {
    try {
      await publicClient.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const bs = artifact("BlindspotMarkets");
  const hash = await wallets[0]!.deployContract({
    abi: blindspotMarketsAbi,
    bytecode: bs.bytecode.object,
    args: [wallets[0]!.account.address, 200],
  });
  const address = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress! as Hex;

  const mock = artifact("MockPQCVerify");
  const mh = await wallets[0]!.deployContract({ abi: mock.abi, bytecode: mock.bytecode.object });
  const mockAddress = (await publicClient.waitForTransactionReceipt({ hash: mh })).contractAddress! as Hex;
  await test.setCode({ address: "0x0000000000000000000000000000000000000a01", bytecode: mock.deployedBytecode.object });

  const warpTo = async (ts: bigint) => {
    await test.setNextBlockTimestamp({ timestamp: ts });
    await test.mine({ blocks: 1 });
  };

  return { rpc, proc, publicClient, test, wallets, address, mockAddress, mockAbi: mock.abi, warpTo, stop: () => proc.kill() };
}
