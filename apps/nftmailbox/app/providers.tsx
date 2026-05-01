'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { PropsWithChildren, useEffect, useState } from 'react';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

const ETHEREUM_MAINNET = {
  id: 1,
  name: 'Ethereum',
  network: 'homestead',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://eth.llamarpc.com'] },
    public:  { http: ['https://eth.llamarpc.com'] },
  },
  blockExplorers: {
    default: { name: 'Etherscan', url: 'https://etherscan.io' },
  },
} as const;

const GNOSIS_CHAIN = {
  id: 100,
  name: 'Gnosis',
  network: 'gnosis',
  nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com'],
    },
    public: {
      http: [process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com'],
    },
  },
  blockExplorers: {
    default: { name: 'Gnosisscan', url: 'https://gnosisscan.io' },
  },
} as const;

function isValidPrivyAppId(appId: string | undefined) {
  if (!appId) return false;
  const v = appId.trim();
  if (!v) return false;
  if (v === 'your_privy_app_id') return false;
  if (v.includes('...')) return false;
  return true;
}

export function Providers({ children }: PropsWithChildren) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  if (!isValidPrivyAppId(PRIVY_APP_ID)) {
    return (
      <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-4 py-8">
          <div className="w-full rounded-2xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] p-5">
            <div className="text-xs font-semibold tracking-[0.18em] text-[rgb(160,220,255)]">SETUP REQUIRED</div>
            <div className="mt-2 text-lg font-semibold">Add a valid Privy App ID</div>
            <div className="mt-2 text-sm text-[var(--muted)]">
              Set <code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code> in your Netlify environment variables, then redeploy.
            </div>
          </div>
          <div className="w-full opacity-70">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID!}
      config={{
        loginMethods: ['wallet', 'email', 'google', 'twitter'],
        appearance: {
          theme: 'dark',
          accentColor: '#00A3FF',
          showWalletLoginFirst: true,
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          noPromptOnSignature: false,
        },
        defaultChain: ETHEREUM_MAINNET,
        supportedChains: [ETHEREUM_MAINNET, GNOSIS_CHAIN],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
