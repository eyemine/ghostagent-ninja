'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { gnosis } from 'wagmi/chains';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';

const config = createConfig({
  chains: [gnosis],
  transports: { [gnosis.id]: http('https://rpc.gnosischain.com') },
  connectors: [farcasterMiniApp()],
});

const queryClient = new QueryClient();

export function MiniAppProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
