"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, http, numberToHex, type Account, type Chain, type EIP1193Provider, type Hex, type Transport, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BlindspotClient } from "@blindspot/sdk";
import { chain, config, publicClient, readUrl } from "./config";
import { createSecret, forgetSecret, loadSecret, quantumSupported, type QuantumSecret } from "./quantum";

/** EIP-6963 announced wallet. */
export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
  provider: EIP1193Provider;
}

interface WalletState {
  /** "quantum" = the in-browser post-quantum Blindspot account; "injected" = MetaMask & co. */
  kind: "quantum" | "injected" | null;
  quantum: {
    supported: boolean;
    secret: QuantumSecret | null;
    create: () => Promise<void>;
    use: () => void;
    forget: () => void;
  };
  wallets: WalletInfo[];
  address: Hex | null;
  chainId: number | null;
  wrongChain: boolean;
  connecting: boolean;
  error: string | null;
  connect: (w?: WalletInfo) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  /** read-only client (no wallet needed) */
  reader: BlindspotClient;
  /** client that can write — null until connected on the right chain */
  writer: BlindspotClient | null;
}

const Ctx = createContext<WalletState | null>(null);
const LAST = "blindspot:last-wallet";

type WC = WalletClient<Transport, Chain, Account>;

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [active, setActive] = useState<WalletInfo | null>(null);
  const [address, setAddress] = useState<Hex | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<QuantumSecret | null>(null);
  const [useQuantum, setUseQuantum] = useState(false);

  // the in-browser Blindspot account (QoreChain only)
  useEffect(() => {
    if (!quantumSupported) return;
    const load = () => {
      const s = loadSecret();
      setSecret(s);
      if (!s) setUseQuantum(false);
    };
    load();
    if (localStorage.getItem(LAST) === "quantum" && loadSecret()) setUseQuantum(true);
    window.addEventListener("blindspot:quantum", load);
    return () => window.removeEventListener("blindspot:quantum", load);
  }, []);

  // discover wallets (EIP-6963), falling back to window.ethereum
  useEffect(() => {
    const seen = new Map<string, WalletInfo>();
    const onAnnounce = (e: Event) => {
      const { info, provider } = (e as CustomEvent).detail as { info: Omit<WalletInfo, "provider">; provider: EIP1193Provider };
      if (seen.has(info.uuid)) return;
      seen.set(info.uuid, { ...info, provider });
      setWallets([...seen.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => {
      const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (seen.size === 0 && eth) {
        setWallets([{ uuid: "injected", name: "Browser wallet", icon: "", rdns: "injected", provider: eth }]);
      }
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  // silent reconnect to the last wallet (eth_accounts never prompts)
  useEffect(() => {
    const last = localStorage.getItem(LAST);
    const w = wallets.find((x) => x.rdns === last);
    if (!w || active) return;
    void (async () => {
      const accounts = (await w.provider.request({ method: "eth_accounts" })) as Hex[];
      if (accounts[0]) {
        setActive(w);
        setAddress(accounts[0]);
        setChainId(Number(await w.provider.request({ method: "eth_chainId" })));
      }
    })().catch(() => {});
  }, [wallets, active]);

  // follow account / chain changes
  useEffect(() => {
    if (!active) return;
    const p = active.provider as EIP1193Provider & {
      on?: (e: string, f: (...a: unknown[]) => void) => void;
      removeListener?: (e: string, f: (...a: unknown[]) => void) => void;
    };
    const onAccounts = (a: unknown) => {
      const list = a as Hex[];
      setAddress(list[0] ?? null);
      if (!list[0]) setActive(null);
    };
    const onChain = (c: unknown) => setChainId(Number(c as string));
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [active]);

  const switchChain = useCallback(async () => {
    if (!active) return;
    const hex = numberToHex(chain.id);
    try {
      await active.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      const code = (e as { code?: number; data?: { originalError?: { code?: number } } }).code;
      if (code === 4902 || (e as { data?: { originalError?: { code?: number } } }).data?.originalError?.code === 4902) {
        await active.provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hex,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: chain.rpcUrls.default.http as string[],
              blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
            },
          ],
        });
      } else throw e;
    }
    setChainId(Number(await active.provider.request({ method: "eth_chainId" })));
  }, [active]);

  const connect = useCallback(
    async (w?: WalletInfo) => {
      const target = w ?? wallets[0];
      setError(null);
      if (!target) {
        setError("No wallet found — install MetaMask, Rabby or another EVM wallet.");
        return;
      }
      setConnecting(true);
      try {
        const accounts = (await target.provider.request({ method: "eth_requestAccounts" })) as Hex[];
        setActive(target);
        setAddress(accounts[0] ?? null);
        localStorage.setItem(LAST, target.rdns);
        const id = Number(await target.provider.request({ method: "eth_chainId" }));
        setChainId(id);
        if (id !== chain.id) {
          try {
            const hex = numberToHex(chain.id);
            await target.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }).catch(async (e: { code?: number }) => {
              if (e?.code !== 4902) throw e;
              await target.provider.request({
                method: "wallet_addEthereumChain",
                params: [{ chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http as string[] }],
              });
            });
            setChainId(Number(await target.provider.request({ method: "eth_chainId" })));
          } catch {
            /* user can switch later from the banner */
          }
        }
      } catch (e) {
        setError((e as Error).message ?? "Connection rejected");
      } finally {
        setConnecting(false);
      }
    },
    [wallets],
  );

  const disconnect = useCallback(() => {
    localStorage.removeItem(LAST);
    setActive(null);
    setAddress(null);
    setChainId(null);
    setUseQuantum(false);
  }, []);

  const quantum = useMemo(
    () => ({
      supported: quantumSupported,
      secret,
      create: async () => {
        const s = await createSecret();
        setSecret(s);
        localStorage.setItem(LAST, "quantum");
        setActive(null);
        setUseQuantum(true);
      },
      use: () => {
        if (!loadSecret()) return;
        localStorage.setItem(LAST, "quantum");
        setActive(null);
        setUseQuantum(true);
      },
      forget: () => {
        forgetSecret();
        localStorage.removeItem(LAST);
        setUseQuantum(false);
      },
    }),
    [secret],
  );

  const reader = useMemo(
    () => new BlindspotClient({ address: config.address, publicClient: publicClient(), fromBlock: config.fromBlock, logChunk: config.logChunk }),
    [],
  );

  const kind: WalletState["kind"] = useQuantum && secret ? "quantum" : active && address ? "injected" : null;
  const effectiveAddress = kind === "quantum" ? secret!.evm : address;
  const wrongChain = kind === "injected" && chainId !== null && chainId !== chain.id;

  const writer = useMemo(() => {
    if (kind === "quantum" && secret) {
      // signs locally; raw transactions are relayed through our /api/rpc proxy
      const walletClient = createWalletClient({
        chain,
        transport: http(readUrl()),
        account: privateKeyToAccount(secret.privateKey),
      }) as unknown as WC;
      return new BlindspotClient({ address: config.address, publicClient: publicClient(), walletClient, fromBlock: config.fromBlock, logChunk: config.logChunk });
    }
    if (!active || !address || wrongChain) return null;
    const walletClient = createWalletClient({ chain, transport: custom(active.provider), account: address }) as unknown as WC;
    return new BlindspotClient({
      address: config.address,
      publicClient: publicClient(),
      walletClient,
      fromBlock: config.fromBlock,
      logChunk: config.logChunk,
    });
  }, [kind, secret, active, address, wrongChain]);

  const value: WalletState = {
    kind,
    quantum,
    wallets,
    address: effectiveAddress,
    chainId: kind === "quantum" ? chain.id : chainId,
    wrongChain,
    connecting,
    error,
    connect: async (w?: WalletInfo) => {
      setUseQuantum(false);
      await connect(w);
    },
    disconnect,
    switchChain,
    reader,
    writer,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
