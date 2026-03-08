'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  type ConsensusRound, type CoordinationMethod,
  METHOD_LABEL, METHOD_BADGE, strategyLabel,
} from '../services/swarm-coordination';

function timeAgo(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const RESULT_COLOR: Record<string, string> = {
  approved: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20',
  rejected: 'text-red-400 bg-red-500/8 ring-red-500/20',
  pending:  'text-amber-300 bg-amber-500/10 ring-amber-500/20',
  timeout:  'text-zinc-400 bg-zinc-500/10 ring-zinc-500/20',
};

const METHOD_COLOR: Record<CoordinationMethod, string> = {
  xmtp:  'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20',
  email: 'text-[rgb(160,220,255)] bg-[rgba(0,163,255,0.08)] ring-[rgba(0,163,255,0.2)]',
};

interface Props {
  vaultName: string;
  walletAddress: string;
  xmtpEnabled: boolean;
  memberCount: number;
}
// COMPONENT_PLACEHOLDER
