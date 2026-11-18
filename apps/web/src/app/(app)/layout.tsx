import { AppNav } from "@/components/AppNav";
import { WalletProvider } from "@/lib/wallet";
import { NotConfigured } from "@/components/NotConfigured";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <div className="void min-h-dvh px-4 pb-16 pt-4 sm:px-[5.5vw] sm:pt-[4vh]">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-[14px]">
          <AppNav />
          <NotConfigured />
          {children}
        </div>
        <footer className="mx-auto mt-14 flex max-w-[1500px] justify-between px-1 text-[11px] text-white/35">
          <span>© Blindspot</span>
          <span>ML-KEM-1024 · ML-DSA-87 · QoreChain</span>
        </footer>
      </div>
    </WalletProvider>
  );
}
