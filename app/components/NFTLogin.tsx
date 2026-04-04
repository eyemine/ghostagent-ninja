'use client';

import { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';

// Safe wallet detection via Gnosis Safe API
async function isSafeAddress(address: string): Promise<boolean> {
  try {
    const res = await fetch(`https://safe-global.api.gnosischain.com/api/v1/safes/${address}/`);
    return res.ok;
  } catch {
    return false;
  }
}

// TBA detection via ERC-6551 registry
async function isTokenboundAccount(address: string): Promise<boolean> {
  try {
    // Check if address is a TBA by calling ERC-6551 registry
    const data = '0x30185c4c'; // account() function selector
    const res = await fetch('https://rpc.gnosischain.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: '0x000000006551c19487814612e58FE06813775758', data }, 'latest'],
      }),
    });
    const result = await res.json() as { result?: string };
    return !!(result?.result && result.result !== '0x');
  } catch {
    return false;
  }
}

// Get the NFT owner for a TBA
async function getTBAOwner(tbaAddress: string): Promise<string | null> {
  try {
    // Call owner() on the TBA to get the NFT owner
    const data = '0x8da5cb5b'; // owner() function selector
    const res = await fetch('https://rpc.gnosischain.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: tbaAddress, data }, 'latest'],
      }),
    });
    const result = await res.json() as { result?: string };
    if (result?.result && result.result !== '0x') {
      return result.result;
    }
    return null;
  } catch {
    return null;
  }
}

// localStorage keys for Safe auth
const SAFE_AUTH_KEY = 'nftmail_safe_auth';
const SAFE_ADDRESS_KEY = 'nftmail_safe_address';

export function NFTLogin() {
  const { login, logout, authenticated, ready, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const [error, setError] = useState<string | null>(null);
  const [safeAddress, setSafeAddress] = useState<string | null>(null);
  const [isSafeAuth, setIsSafeAuth] = useState(false);

  // Add null check for wallets array
  const safeWallets = wallets || [];
  const preferredWallet = safeWallets.find((w: any) => w?.walletClientType === 'injected') || safeWallets[0];

  // Check for existing Safe auth on mount
  useEffect(() => {
    const stored = localStorage.getItem(SAFE_AUTH_KEY);
    const addr = localStorage.getItem(SAFE_ADDRESS_KEY);
    if (stored === 'true' && addr) {
      setSafeAddress(addr);
      setIsSafeAuth(true);
    }
  }, []);

  // Listen for WalletConnect sessions to detect TBA connections
  useEffect(() => {
    const handleWalletConnectSession = async (event: any) => {
      if (event.detail?.accounts?.length > 0) {
        const address = event.detail.accounts[0];
        const isTBA = await isTokenboundAccount(address);
        if (isTBA) {
          const owner = await getTBAOwner(address);
          if (owner) {
            setError(`Tokenbound wallet detected. Please connect with the NFT owner: ${owner.slice(0, 6)}...${owner.slice(-4)} to authenticate. The TBA ${address.slice(0, 6)}...${address.slice(-4)} is controlled by this owner.`);
          }
        }
      }
    };

    window.addEventListener('walletconnect_session', handleWalletConnectSession);
    return () => window.removeEventListener('walletconnect_session', handleWalletConnectSession);
  }, []);

  if (!ready) return null;

  // Detect if connected wallet is a Safe (for Privy-authenticated wallets)
  const [detectedSafe, setDetectedSafe] = useState(false);
  useEffect(() => {
    if (authenticated && safeWallets.length > 0 && preferredWallet?.address) {
      isSafeAddress(preferredWallet.address).then(setDetectedSafe).catch(() => setDetectedSafe(false));
    } else {
      setDetectedSafe(false);
    }
  }, [authenticated, safeWallets, preferredWallet?.address]);

  // Show connected state for either Privy auth or Safe auth
  if ((authenticated && safeWallets.length > 0) || isSafeAuth) {
    const addr = isSafeAuth ? safeAddress : preferredWallet?.address;
    const isSafe = isSafeAuth || detectedSafe;
    
    const handleLogout = () => {
      if (isSafeAuth) {
        localStorage.removeItem(SAFE_AUTH_KEY);
        localStorage.removeItem(SAFE_ADDRESS_KEY);
        setSafeAddress(null);
        setIsSafeAuth(false);
      } else {
        logout();
      }
    };

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex flex-1 items-center gap-2 rounded-xl border ${isSafe ? 'border-violet-500/30 bg-violet-500/8' : 'border-emerald-500/30 bg-emerald-500/8'} px-4 py-3`}>
            <div className="relative flex h-2.5 w-2.5">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${isSafe ? 'bg-violet-400' : 'bg-emerald-400'} opacity-75`} />
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isSafe ? 'bg-violet-400' : 'bg-emerald-400'}`} />
            </div>
            <span className={`text-sm font-medium ${isSafe ? 'text-violet-300' : 'text-emerald-300'}`}>
              {addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : 'Unknown'}
            </span>
            {isSafe && (
              <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[9px] font-semibold text-violet-300">
                Safe
              </span>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="rounded-xl border border-[var(--border)] bg-black/30 px-4 py-3 text-sm text-[var(--muted)] transition hover:border-red-500/30 hover:text-red-400"
          >
            Disconnect
          </button>
        </div>
        <p className="text-center text-[10px] text-[var(--muted)]">
          {isSafe 
            ? 'Safe wallet connected — ready to manage your nftmail.gno identity'
            : 'Wallet connected — ready to mint your nftmail.gno identity'
          }
        </p>
        {!isSafe && safeWallets.length > 1 && (
          <p className="text-center text-[10px] text-[var(--muted)]">
            Using: {(preferredWallet as any)?.walletClientType || 'wallet'}
          </p>
        )}
      </div>
    );
  }

  if (authenticated && safeWallets.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
          <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-sm text-amber-300">Logged in — connecting wallet...</span>
        </div>
        <button
          onClick={async () => {
            try {
              await connectWallet();
            } catch (err: any) {
              setError(err?.message || 'Failed to connect wallet');
            }
          }}
          className="w-full rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] px-6 py-3 text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.18)]"
        >
          Connect External Wallet
        </button>
      </div>
    );
  }

  const handleLogin = async () => {
    setError(null);
    try {
      await login();
      
      // After Privy login, check if the connected wallet is a Safe
      // If it is, store it for Safe auth flow
      if (authenticated && safeWallets.length > 0 && preferredWallet?.address) {
        const isSafe = await isSafeAddress(preferredWallet.address).catch(() => false);
        if (isSafe) {
          localStorage.setItem(SAFE_AUTH_KEY, 'true');
          localStorage.setItem(SAFE_ADDRESS_KEY, preferredWallet.address);
          setSafeAddress(preferredWallet.address);
          setIsSafeAuth(true);
          return;
        }
      }
    } catch (err: any) {
      // If Privy login fails, check if user is trying to connect a Safe or TBA directly
      const walletProvider = (window as any).ethereum;
      if (walletProvider) {
        try {
          const accounts = await walletProvider.request({ method: 'eth_accounts' });
          if (accounts.length > 0) {
            const address = accounts[0] as string;
            
            // Check if it's a Safe
            const isSafe = await isSafeAddress(address);
            if (isSafe) {
              localStorage.setItem(SAFE_AUTH_KEY, 'true');
              localStorage.setItem(SAFE_ADDRESS_KEY, address);
              setSafeAddress(address);
              setIsSafeAuth(true);
              return; // Success - Safe authenticated
            }
            
            // Check if it's a TBA
            const isTBA = await isTokenboundAccount(address);
            if (isTBA) {
              // Get the NFT owner for this TBA
              const owner = await getTBAOwner(address);
              if (owner) {
                setError(`Tokenbound wallet detected. Please connect with the NFT owner: ${owner.slice(0, 6)}...${owner.slice(-4)} to authenticate. The TBA ${address.slice(0, 6)}...${address.slice(-4)} is controlled by this owner.`);
              } else {
                setError(`Tokenbound wallet detected. Please connect with the NFT's owner wallet instead. The TBA ${address.slice(0, 6)}...${address.slice(-4)} cannot sign messages directly.`);
              }
              return;
            }
          }
        } catch {
          // Continue to error display
        }
      }
      
      setError(err?.message || 'Connection failed. Try email login or a different wallet.');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={handleLogin}
        className="group relative w-full overflow-hidden rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.08)] px-6 py-4 text-sm font-semibold text-[rgb(160,220,255)] transition-all hover:bg-[rgba(0,163,255,0.16)] hover:shadow-[0_0_32px_rgba(0,163,255,0.12)]"
      >
        <div className="flex items-center justify-center gap-3">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M22 8l-10 5L2 8" />
          </svg>
          Connect Wallet or Safe
          <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </div>
      </button>
      <p className="text-center text-[10px] text-[var(--muted)]">
        Connect wallet, Safe, or sign in with email to mint your nftmail.box address
      </p>
      <p className="text-center text-[10px] text-[var(--muted)]">
        By connecting you agree to our{' '}
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#b0805c] underline hover:text-[#ffca92]">Terms of Use</a>
        {' '}and{' '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#b0805c] underline hover:text-[#ffca92]">Privacy Policy</a>
      </p>
      {error && (
        <p className="text-center text-xs text-amber-400">{error}</p>
      )}
    </div>
  );
}
