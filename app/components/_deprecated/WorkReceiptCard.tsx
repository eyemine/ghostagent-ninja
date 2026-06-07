'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';

interface WorkReceiptProps {
  cid: string;
  licenseId: string;
  revenue: number;
  agentAddress: string;
  receiptNumber: number;
  storyIpId?: string;
  x402Status?: 'active' | 'inactive' | 'pending';
  cdrVaultUuid?: string | null;
  isNewlyPro?: boolean;
  storyTxHash?: string;
  timestamp?: number;
}

const STORY_EXPLORER_URL = 'https://explorer.storyprotocol.xyz/tx/';
const STORY_IPA_URL = 'https://explorer.storyprotocol.xyz/ipa/';

function formatDate(timestamp: number = Date.now()) {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

export function WorkReceiptCard({ 
  cid, 
  licenseId, 
  revenue, 
  agentAddress, 
  receiptNumber,
  storyIpId,
  x402Status = 'inactive',
  cdrVaultUuid = null,
  isNewlyPro = false,
  storyTxHash,
  timestamp = Date.now()
}: WorkReceiptProps) {
  const [showMoltEffect, setShowMoltEffect] = useState(false);
  const [mounted, setMounted] = useState(false);

  const truncateHash = (hash: string) => `${hash.slice(0, 6)}...${hash.slice(-4)}`;

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Trigger molt animation for new Pro agents
  useEffect(() => {
    if (isNewlyPro) {
      setShowMoltEffect(true);
      const timer = setTimeout(() => setShowMoltEffect(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isNewlyPro]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ 
          opacity: 1, 
          y: 0,
          scale: showMoltEffect ? 1.02 : 1,
          boxShadow: showMoltEffect 
            ? '0 0 30px rgba(167, 139, 250, 0.3)' 
            : '0 0 0 rgba(0,0,0,0)'
        }}
        transition={{ 
          duration: 0.4,
          boxShadow: { duration: 1.5 }
        }}
        className="relative bg-gradient-to-br from-zinc-900 to-zinc-800 rounded-xl p-6 shadow-xl border border-[rgba(176,128,92,0.35)] overflow-hidden"
      >
        {/* Molt Effect Overlay */}
        {showMoltEffect && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.2, 0] }}
            transition={{ duration: 2, times: [0, 0.5, 1] }}
            className="absolute inset-0 bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20"
          />
        )}

        <div className="flex items-start justify-between mb-4">
          <h3 className="text-xl font-semibold text-zinc-100">
            Work Receipt #{receiptNumber}
          </h3>
          <a
            href={storyTxHash ? `${STORY_EXPLORER_URL}${storyTxHash}` : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="group px-3 py-1 bg-emerald-500/10 text-emerald-300 text-sm rounded-full hover:bg-emerald-500/20 transition-colors"
          >
            Verified by Story Protocol
            <span className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
          </a>
        </div>

        <div className="space-y-4">
          {/* Status: Story IP / x402 / CDR Vault */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">Story IP</span>
              {storyIpId ? (
                <a href={`${STORY_IPA_URL}${storyIpId}`} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium text-violet-300 hover:text-violet-200 transition-colors">
                  {storyIpId.slice(0, 6)}…{storyIpId.slice(-4)}
                </a>
              ) : <span className="text-sm text-zinc-500">—</span>}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">x402</span>
              <span className={`text-sm font-medium ${x402Status === 'active' ? 'text-emerald-300' : x402Status === 'pending' ? 'text-amber-300' : 'text-zinc-500'}`}>
                {x402Status === 'active' ? 'Active' : x402Status === 'pending' ? 'Pending' : 'Inactive'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">CDR Vault</span>
              {cdrVaultUuid
                ? <span className="text-sm font-medium text-cyan-300">#{cdrVaultUuid}</span>
                : <span className="text-sm text-zinc-500">—</span>}
            </div>
          </div>
          <div className="h-px bg-zinc-700/50" />

          <div className="flex flex-col gap-1">
            <span className="text-sm text-zinc-400">IPFS Content ID</span>
            <div className="flex items-center gap-2">
              <code className="text-amber-300 bg-amber-500/10 px-2 py-1 rounded">
                {truncateHash(cid)}
              </code>
              <button 
                onClick={() => navigator.clipboard.writeText(cid)}
                className="text-zinc-400 hover:text-zinc-200 text-sm"
              >
                Copy
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm text-zinc-400">License Token</span>
            <div className="flex items-center gap-2">
              <code className="text-violet-300 bg-violet-500/10 px-2 py-1 rounded">
                {truncateHash(licenseId)}
              </code>
              <a 
                href={`https://storyprotocol.xyz/license/${licenseId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-zinc-200 text-sm"
              >
                View
              </a>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm text-zinc-400">Agent</span>
            <div className="flex items-center gap-2">
              <code className="text-blue-300 bg-blue-500/10 px-2 py-1 rounded">
                {truncateHash(agentAddress)}
              </code>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm text-zinc-400">Revenue</span>
            <div className="flex items-center gap-2 text-lg font-medium text-zinc-100">
              {revenue} xDAI
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-[rgba(176,128,92,0.2)]">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">
              {mounted ? formatDate(timestamp) : null}
            </span>
            <a
              href={`https://ipfs.io/ipfs/${cid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 hover:text-zinc-100 font-medium"
            >
              View Content →
            </a>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
