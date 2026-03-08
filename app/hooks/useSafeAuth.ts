'use client';

import { useState, useEffect } from 'react';

const SAFE_AUTH_KEY = 'nftmail_safe_auth';
const SAFE_ADDRESS_KEY = 'nftmail_safe_address';

export function useSafeAuth() {
  const [isSafeAuth, setIsSafeAuth] = useState(false);
  const [safeAddress, setSafeAddress] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(SAFE_AUTH_KEY);
    const addr = localStorage.getItem(SAFE_ADDRESS_KEY);
    if (stored === 'true' && addr) {
      setSafeAddress(addr);
      setIsSafeAuth(true);
    }
  }, []);

  const clearSafeAuth = () => {
    localStorage.removeItem(SAFE_AUTH_KEY);
    localStorage.removeItem(SAFE_ADDRESS_KEY);
    setSafeAddress(null);
    setIsSafeAuth(false);
  };

  return {
    isSafeAuth,
    safeAddress,
    clearSafeAuth,
  };
}
