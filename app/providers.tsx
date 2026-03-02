'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { PropsWithChildren } from 'react';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

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
  if (!isValidPrivyAppId(PRIVY_APP_ID)) {
    return (
      <>
        <div className="fixed top-14 left-0 right-0 z-50 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-[11px] text-amber-300">
          <span className="font-semibold">SETUP REQUIRED</span>
          {' — '}Set <code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code> in Netlify environment variables, then redeploy.
        </div>
        <div className="pt-8">{children}</div>
      </>
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
        defaultChain: GNOSIS_CHAIN, // Gnosis Chain
        supportedChains: [GNOSIS_CHAIN], // Gnosis only for MVP
      }}
    >
      {children}
    </PrivyProvider>
  );
}
