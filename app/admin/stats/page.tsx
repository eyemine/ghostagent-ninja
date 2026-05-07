'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface AdminStats {
  on_chain: {
    total_accounts: string;
    breakdown: {
      molt_gno: string;
      nftmail_gno: string;
      openclaw_gno: string;
      picoclaw_gno: string;
      vault_gno: string;
      agent_gno: string;
    };
    chain_id: number;
    contracts: {
      molt_gno: string;
      nftmail_gno: string;
      openclaw_gno: string;
      picoclaw_gno: string;
      vault_gno: string;
      agent_gno: string;
    };
    last_updated: string;
  };
  off_chain: {
    active_inboxes: number;
    nft_accounts: number;
    sandbox_accounts: number;
    tracked_via_kv: boolean;
  };
  revenue: {
    total_revenue: string;
    currency: string;
  };
  last_updated: number;
  error?: string;
}

interface DMARCAttachment {
  filename: string;
  size: number;
  type: string;
  hasData: boolean;
}

interface DMARCReport {
  id: string;
  receivedAt: number;
  subject: string;
  hasAttachment: boolean;
  attachmentType?: string;
  attachmentCount: number;
  attachments: DMARCAttachment[];
  reportId: string;
  submitter: string;
  domain: string;
  body: string;
}

export default function NftmailAdminStats() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // DMARC reports state
  const [dmarcReports, setDmarcReports] = useState<DMARCReport[]>([]);
  const [dmarcLoading, setDmarcLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'stats' | 'dmarc'>('stats');

  const loadStats = async (secret?: string) => {
    try {
      setLoading(true);
      setError('');
      
      const headers: Record<string, string> = {};
      if (secret) {
        headers['authorization'] = `Bearer ${secret}`;
      }

      const [statsRes, dmarcRes] = await Promise.all([
        fetch('/api/admin/stats', { headers }),
        fetch('/api/admin/dmarc', { headers }),
      ]);
      
      console.log('Stats API Response status:', statsRes.status);
      console.log('DMARC API Response status:', dmarcRes.status);
      
      if (statsRes.status === 401) {
        setIsAuthenticated(false);
        setError('Invalid admin secret');
        return;
      }

      if (!statsRes.ok) {
        throw new Error(`Stats API returned ${statsRes.status}`);
      }

      const statsData = await statsRes.json();
      console.log('Stats API Response data:', statsData);
      setStats(statsData);
      
      // Load DMARC reports
      if (dmarcRes.ok) {
        const dmarcData = await dmarcRes.json();
        setDmarcReports(dmarcData.reports || []);
      }
      
      setIsAuthenticated(true);
    } catch (err: any) {
      console.error('Failed to load stats:', err);
      setError(err.message || 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };
  
  const loadDmarcReports = async () => {
    if (!isAuthenticated) return;
    
    try {
      setDmarcLoading(true);
      const headers: Record<string, string> = {};
      if (adminSecret) {
        headers['authorization'] = `Bearer ${adminSecret}`;
      }
      
      const response = await fetch('/api/admin/dmarc', { headers });
      if (response.ok) {
        const data = await response.json();
        setDmarcReports(data.reports || []);
      }
    } catch (err) {
      console.error('Failed to load DMARC reports:', err);
    } finally {
      setDmarcLoading(false);
    }
  };

  useEffect(() => {
    // Try loading without auth first (if ADMIN_SECRET is not set)
    loadStats();
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loadStats(adminSecret);
  };

  if (!isAuthenticated && !loading && !stats) {
    return (
      <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.10),transparent_40%),linear-gradient(180deg,#0a0a0f,#03040a)]">
        <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
          <div className="w-full space-y-6">
            <div className="text-center">
              <Image src="/ghost-logo.png" alt="NFTMail" width={64} height={64} className="mx-auto mb-4 opacity-95" />
              <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
              <p className="text-sm text-gray-400 mt-2">NFTMail Statistics</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="secret" className="block text-sm font-medium text-gray-300 mb-2">
                  Admin Secret
                </label>
                <input
                  type="password"
                  id="secret"
                  value={adminSecret}
                  onChange={(e) => setAdminSecret(e.target.value)}
                  placeholder="Enter admin secret"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-400 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition"
              >
                Access Dashboard
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const chartData = [
    {
      name: 'molt.gno',
      accounts: parseInt(stats?.on_chain.breakdown.molt_gno || '0'),
    },
    {
      name: 'nftmail.gno',
      accounts: parseInt(stats?.on_chain.breakdown.nftmail_gno || '0'),
    },
    {
      name: 'openclaw.gno',
      accounts: parseInt(stats?.on_chain.breakdown.openclaw_gno || '0'),
    },
    {
      name: 'picoclaw.gno',
      accounts: parseInt(stats?.on_chain.breakdown.picoclaw_gno || '0'),
    },
    {
      name: 'vault.gno',
      accounts: parseInt(stats?.on_chain.breakdown.vault_gno || '0'),
    },
    {
      name: 'agent.gno',
      accounts: parseInt(stats?.on_chain.breakdown.agent_gno || '0'),
    },
  ];

  const maxAccounts = Math.max(...chartData.map(d => d.accounts), 1);

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.10),transparent_40%),linear-gradient(180deg,#0a0a0f,#03040a)]">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition">
              <Image src="/ghost-logo.png" alt="NFTMail" width={40} height={40} className="opacity-95" />
              <span className="text-lg font-semibold text-white">nftmail.box</span>
            </Link>
            <span className="text-gray-500">/</span>
            <span className="text-lg font-semibold text-white">Admin Statistics</span>
          </div>
          <button
            onClick={() => {
              setIsAuthenticated(false);
              setStats(null);
            }}
            className="text-sm text-gray-400 hover:text-white transition"
          >
            Logout
          </button>
        </header>

        {stats?.error && (
          <div className="mb-6 p-4 bg-amber-900/20 border border-amber-500/30 rounded-lg">
            <p className="text-sm text-amber-300">{stats.error}</p>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('stats')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'stats'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-900 text-gray-400 hover:text-white'
            }`}
          >
            Statistics
          </button>
          <button
            onClick={() => { setActiveTab('dmarc'); loadDmarcReports(); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'dmarc'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-900 text-gray-400 hover:text-white'
            }`}
          >
            DMARC Reports {dmarcReports.length > 0 && `(${dmarcReports.length})`}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(0,163,255,0.4)] border-t-transparent" />
          </div>
        ) : stats ? (
          <div className="space-y-6">
            {activeTab === 'stats' && (
              <>
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Total Accounts */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-400">Total Accounts</span>
                  <span className="text-[10px] text-cyan-300">Worker KV</span>
                </div>
                <div className="text-3xl font-bold text-white mb-1">
                  {stats.on_chain.total_accounts}
                </div>
                <div className="text-xs text-gray-500">
                  {stats.off_chain.nft_accounts} NFT · {stats.off_chain.sandbox_accounts} Sandbox
                </div>
              </div>

              {/* Active Inboxes */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-400">Active Inboxes</span>
                  <span className="text-[10px] text-emerald-300">Cloudflare KV</span>
                </div>
                <div className="text-3xl font-bold text-white mb-1">
                  {stats.off_chain.active_inboxes}
                </div>
                <div className="text-xs text-gray-500">Agents with inbox data</div>
              </div>

              {/* Total Revenue */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-400">Total Revenue</span>
                  <span className="text-[10px] text-violet-300">Stamps Mapping</span>
                </div>
                <div className="text-3xl font-bold text-white mb-1">
                  {stats.revenue.total_revenue} {stats.revenue.currency}
                </div>
                <div className="text-xs text-gray-500">Lifetime revenue from minting</div>
              </div>
            </div>

            {/* Chart */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Account Distribution by Registrar</h3>
              <div className="space-y-4">
                {chartData.map((item) => (
                  <div key={item.name} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-300">{item.name}</span>
                      <span className="text-cyan-300 font-semibold">{item.accounts}</span>
                    </div>
                    <div className="h-8 bg-black/30 rounded-lg overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-cyan-500/80 to-blue-500/80 rounded-lg transition-all duration-500"
                        style={{ width: `${(item.accounts / maxAccounts) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Data Sources */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Data Sources</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg">
                  <div>
                    <div className="text-sm font-medium text-white">On-chain Registrars</div>
                    <div className="text-xs text-gray-500">Gnosis Chain ID: {stats.on_chain.chain_id}</div>
                  </div>
                  <div className="text-xs text-cyan-300">molt • nftmail • openclaw • picoclaw • vault • agent</div>
                </div>
                <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg">
                  <div>
                    <div className="text-sm font-medium text-white">Cloudflare KV</div>
                    <div className="text-xs text-gray-500">Active usage tracking</div>
                  </div>
                  <div className="text-xs text-emerald-300">{stats.off_chain.active_inboxes} active inboxes</div>
                </div>
                <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg">
                  <div>
                    <div className="text-sm font-medium text-white">Stamps Mapping</div>
                    <div className="text-xs text-gray-500">Revenue tracking</div>
                  </div>
                  <div className="text-xs text-violet-300">{stats.revenue.total_revenue} {stats.revenue.currency}</div>
                </div>
              </div>
            </div>

            {/* Last Updated */}
            <div className="text-center text-xs text-gray-500">
              Last updated: {new Date(stats.last_updated).toLocaleString()}
            </div>
              </>
            )}
            
            {/* DMARC Reports Tab */}
            {activeTab === 'dmarc' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
                  <h3 className="text-lg font-semibold text-white mb-4">DMARC Reports</h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Daily authentication reports from email providers (Gmail, Yahoo, etc.) showing SPF/DKIM alignment results for your domain.
                  </p>
                  
                  {dmarcLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                    </div>
                  ) : dmarcReports.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      No DMARC reports found
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {dmarcReports.map((report) => (
                        <div key={report.id} className="p-4 bg-black/20 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-white">
                              Report from {report.submitter}
                            </span>
                            <span className="text-xs text-gray-500">
                              {new Date(report.receivedAt).toLocaleString()}
                            </span>
                          </div>
                          <div className="text-xs text-gray-400 space-y-1">
                            <p>Domain: <span className="text-cyan-300">{report.domain}</span></p>
                            <p>Report ID: {report.reportId}</p>
                            {report.hasAttachment ? (
                              <div className="space-y-1">
                                <p className="text-emerald-300">
                                  ✓ {report.attachmentCount} attachment(s) stored
                                </p>
                                {report.attachments.map((att, idx) => (
                                  <div key={idx} className="flex items-center gap-2 ml-2">
                                    <span className="text-gray-500">
                                      {att.filename} ({(att.size / 1024).toFixed(1)} KB)
                                    </span>
                                    {att.hasData && (
                                      <a 
                                        href={`/api/admin/attachment?agent=dmarc&messageId=${report.id}&filename=${encodeURIComponent(att.filename)}`}
                                        className="text-blue-400 hover:text-blue-300 underline"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        Download
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-gray-500">No attachment found</p>
                            )}
                          </div>
                          <div className="mt-3 p-2 bg-gray-900 rounded text-xs font-mono text-gray-500">
                            Subject: {report.subject}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* DMARC Info */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
                  <h4 className="text-sm font-semibold text-white mb-3">About DMARC</h4>
                  <ul className="text-xs text-gray-400 space-y-2">
                    <li>• <strong>SPF</strong> — Validates sender IP address against your DNS</li>
                    <li>• <strong>DKIM</strong> — Cryptographic signature verification</li>
                    <li>• <strong>Alignment</strong> — Ensures From: header matches authenticated domain</li>
                    <li>• Reports help detect spoofing attempts and configuration issues</li>
                  </ul>
                  <div className="mt-4 p-3 bg-emerald-900/20 border border-emerald-500/30 rounded">
                    <p className="text-xs text-emerald-300">
                      <strong>Status:</strong> DMARC report attachments are now being stored in KV. 
                      Download the .xml.gz files and extract them locally to view SPF/DKIM authentication results.
                      XML parsing dashboard feature coming soon.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            No statistics available
          </div>
        )}
      </div>
    </div>
  );
}
