'use client';

import { useState } from 'react';
import Link from 'next/link';

interface FootprintData {
  agent: string;
  onChain: {
    safeAddress: string | null;
    tbaAddress: string | null;
    totalTransactions: number;
    firstSeen: number | null;
    lastSeen: number | null;
    balances: { token: string; amount: string }[];
  };
  offChain: {
    tld: string;
    tier: string;
    totalXdaiBurned: number;
    surgeScore: number;
    mcpServers: string[];
    genomeUrl: string | null;
  };
  exposure: {
    hasPublicEndpoints: boolean;
    hasMCPServers: boolean;
    hasGenomeMetadata: boolean;
    riskLevel: 'low' | 'medium' | 'high';
  };
}

interface RelationsData {
  agent: string;
  handshakes: Array<{
    peer: string;
    status: string;
    timestamp: number;
  }>;
  sharedSafes: string[];
  networkSize: number;
  centrality: number;
}

interface ExposureData {
  agent: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  exposures: Array<{
    type: string;
    severity: string;
    description: string;
  }>;
  score: number;
}

export default function OSINTDashboard() {
  const [agentName, setAgentName] = useState('');
  const [loading, setLoading] = useState(false);
  const [footprint, setFootprint] = useState<FootprintData | null>(null);
  const [relations, setRelations] = useState<RelationsData | null>(null);
  const [exposure, setExposure] = useState<ExposureData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    if (!agentName.trim()) return;
    
    setLoading(true);
    setError(null);
    setFootprint(null);
    setRelations(null);
    setExposure(null);

    try {
      // Fetch all three modules in parallel
      const [footprintRes, relationsRes, exposureRes] = await Promise.all([
        fetch(`/api/osint/footprint?agent=${encodeURIComponent(agentName)}`),
        fetch(`/api/osint/relations?agent=${encodeURIComponent(agentName)}`),
        fetch(`/api/osint/exposure?agent=${encodeURIComponent(agentName)}`),
      ]);

      if (!footprintRes.ok) {
        const err = await footprintRes.json();
        throw new Error(err.error || 'Failed to fetch footprint');
      }

      const footprintData = await footprintRes.json();
      const relationsData = relationsRes.ok ? await relationsRes.json() : null;
      const exposureData = exposureRes.ok ? await exposureRes.json() : null;

      setFootprint(footprintData);
      setRelations(relationsData);
      setExposure(exposureData);
    } catch (err: any) {
      setError(err.message || 'Failed to analyze agent');
    } finally {
      setLoading(false);
    }
  }

  function getRiskColor(level: string) {
    switch (level) {
      case 'low': return 'text-emerald-400';
      case 'medium': return 'text-amber-400';
      case 'high': return 'text-orange-400';
      case 'critical': return 'text-red-400';
      default: return 'text-gray-400';
    }
  }

  function getSeverityColor(severity: string) {
    switch (severity) {
      case 'low': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'medium': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'high': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'critical': return 'bg-red-500/10 text-red-400 border-red-500/20';
      default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">OSINT Intelligence</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Agent footprint analysis, network mapping, and exposure assessment
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-[var(--border)] bg-black/20 px-4 py-2 text-sm text-white transition hover:bg-black/40"
          >
            ← Dashboard
          </Link>
        </header>

        {/* Search */}
        <div className="mb-8 rounded-xl border border-[var(--border)] bg-black/30 p-6">
          <label className="mb-2 block text-sm font-semibold text-white">
            Agent Name
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
              placeholder="ghostagent, eyemine, victor..."
              className="flex-1 rounded-lg border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-[var(--muted)] focus:border-amber-500/50 focus:outline-none"
            />
            <button
              onClick={handleAnalyze}
              disabled={loading || !agentName.trim()}
              className="rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
            >
              {loading ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
          {error && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {(footprint || relations || exposure) && (
          <div className="space-y-6">
            {/* Footprint */}
            {footprint && (
              <div className="rounded-xl border border-[var(--border)] bg-black/30 p-6">
                <h2 className="mb-4 text-xl font-bold text-white">Digital Footprint</h2>
                
                <div className="grid gap-6 md:grid-cols-2">
                  {/* On-chain */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-amber-400">On-Chain Data</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">Safe Address</span>
                        <span className="font-mono text-white">
                          {footprint.onChain.safeAddress ? 
                            `${footprint.onChain.safeAddress.slice(0, 6)}...${footprint.onChain.safeAddress.slice(-4)}` : 
                            '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">TBA Address</span>
                        <span className="font-mono text-white">
                          {footprint.onChain.tbaAddress ? 
                            `${footprint.onChain.tbaAddress.slice(0, 6)}...${footprint.onChain.tbaAddress.slice(-4)}` : 
                            '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">Total Transactions</span>
                        <span className="text-white">{footprint.onChain.totalTransactions}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">Balance</span>
                        <span className="text-white">
                          {footprint.onChain.balances[0]?.amount || '0'} {footprint.onChain.balances[0]?.token || 'xDAI'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Off-chain */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-amber-400">Off-Chain Data</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">TLD</span>
                        <span className="text-white">{footprint.offChain.tld}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">Tier</span>
                        <span className="text-white capitalize">{footprint.offChain.tier}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">xDAI Burned</span>
                        <span className="text-white">{footprint.offChain.totalXdaiBurned.toFixed(1)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">Surge Score</span>
                        <span className="text-white">{footprint.offChain.surgeScore}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">MCP Servers</span>
                        <span className="text-white">{footprint.offChain.mcpServers.length}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Exposure summary */}
                <div className="mt-6 rounded-lg border border-[var(--border)] bg-black/20 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">Risk Level</span>
                    <span className={`text-sm font-bold uppercase ${getRiskColor(footprint.exposure.riskLevel)}`}>
                      {footprint.exposure.riskLevel}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Relations */}
            {relations && (
              <div className="rounded-xl border border-[var(--border)] bg-black/30 p-6">
                <h2 className="mb-4 text-xl font-bold text-white">Network Relations</h2>
                
                <div className="mb-4 grid gap-4 md:grid-cols-3">
                  <div className="rounded-lg border border-[var(--border)] bg-black/20 p-4">
                    <div className="text-2xl font-bold text-amber-400">{relations.networkSize}</div>
                    <div className="text-xs text-[var(--muted)]">Connections</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-black/20 p-4">
                    <div className="text-2xl font-bold text-amber-400">{(relations.centrality * 100).toFixed(0)}%</div>
                    <div className="text-xs text-[var(--muted)]">Centrality</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-black/20 p-4">
                    <div className="text-2xl font-bold text-amber-400">{relations.sharedSafes.length}</div>
                    <div className="text-xs text-[var(--muted)]">Shared Safes</div>
                  </div>
                </div>

                {relations.handshakes.length > 0 && (
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-amber-400">A2A Handshakes</h3>
                    <div className="space-y-2">
                      {relations.handshakes.slice(0, 5).map((h, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-black/20 px-4 py-2 text-sm">
                          <span className="font-mono text-white">{h.peer}</span>
                          <span className="text-[var(--muted)]">{h.status}</span>
                        </div>
                      ))}
                      {relations.handshakes.length > 5 && (
                        <div className="text-center text-xs text-[var(--muted)]">
                          +{relations.handshakes.length - 5} more
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Exposure */}
            {exposure && (
              <div className="rounded-xl border border-[var(--border)] bg-black/30 p-6">
                <h2 className="mb-4 text-xl font-bold text-white">Exposure Assessment</h2>
                
                <div className="mb-6 flex items-center justify-between rounded-lg border border-[var(--border)] bg-black/20 p-4">
                  <div>
                    <div className="text-sm text-[var(--muted)]">Overall Risk Score</div>
                    <div className={`text-3xl font-bold ${getRiskColor(exposure.riskLevel)}`}>
                      {exposure.score}/100
                    </div>
                  </div>
                  <div className={`rounded-lg px-4 py-2 text-sm font-bold uppercase ${getRiskColor(exposure.riskLevel)}`}>
                    {exposure.riskLevel}
                  </div>
                </div>

                {exposure.exposures.length > 0 && (
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-amber-400">Identified Exposures</h3>
                    <div className="space-y-2">
                      {exposure.exposures.map((exp, i) => (
                        <div key={i} className={`rounded-lg border px-4 py-3 ${getSeverityColor(exp.severity)}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold">{exp.type}</span>
                            <span className="text-xs uppercase">{exp.severity}</span>
                          </div>
                          <div className="mt-1 text-xs opacity-80">{exp.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!loading && !footprint && !relations && !exposure && !error && (
          <div className="rounded-xl border border-[var(--border)] bg-black/30 p-12 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <h3 className="text-lg font-semibold text-white">No Analysis Yet</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Enter an agent name above to start OSINT analysis
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
