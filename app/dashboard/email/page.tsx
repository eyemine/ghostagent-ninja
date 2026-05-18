'use client';

import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

// Dynamic imports to avoid SSR issues
const EmailCompose = dynamic(() => import('../../components/EmailCompose'), { ssr: false });
const EmailInbox = dynamic(() => import('../../components/EmailInbox'), { ssr: false });
const SentBox = dynamic(() => import('../../components/SentBox'), { ssr: false });

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

type Tab = 'compose' | 'inbox' | 'sent';

interface Agent {
  name: string;
  email: string;
  tier: 'free' | 'pro' | 'premium';
}

export default function EmailDashboard() {
  const { authenticated, user } = usePrivy();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('compose');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Redirect if not authenticated
  useEffect(() => {
    if (!authenticated && !loading) {
      router.push('/');
    }
  }, [authenticated, loading, router]);

  // Fetch user's agents
  useEffect(() => {
    if (!authenticated || !user?.wallet?.address) return;

    const fetchAgents = async () => {
      try {
        const res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'listAgents',
            safeAddress: user.wallet?.address,
          }),
        });

        const data = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }

        // Map to Agent interface with tier info
        const agentList: Agent[] = await Promise.all(
          (data.agents || []).map(async (name: string) => {
            const profileRes = await fetch(WORKER_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'getAgentProfile',
                label: name,
              }),
            });
            const profile = await profileRes.json();
            return {
              name,
              email: `${name}@nftmail.box`,
              tier: profile.tier || 'free',
            };
          })
        );

        setAgents(agentList);
        if (agentList.length > 0) {
          setSelectedAgent(agentList[0].name);
        }
      } catch (e: any) {
        setError(e.message || 'Failed to load agents');
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
  }, [authenticated, user?.wallet?.address]);

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-[#b0805c] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  const currentAgent = agents.find(a => a.name === selectedAgent);

  return (
    <div className="min-h-screen bg-black text-[#f2eee4]">
      {/* Header */}
      <header className="border-b border-gray-800 bg-black/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold">📧 Email</h1>
              
              {/* Agent Selector */}
              {agents.length > 1 && (
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="bg-black/50 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#b0805c]"
                >
                  {agents.map(agent => (
                    <option key={agent.name} value={agent.name}>
                      {agent.name}@nftmail.box
                    </option>
                  ))}
                </select>
              )}

              {currentAgent && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  currentAgent.tier === 'premium' ? 'bg-purple-500/20 text-purple-400' :
                  currentAgent.tier === 'pro' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-gray-700 text-gray-400'
                }`}>
                  {currentAgent.tier.toUpperCase()}
                </span>
              )}
            </div>

            <a
              href="/dashboard"
              className="text-sm text-gray-500 hover:text-[#f2eee4] transition-colors"
            >
              ← Back to Dashboard
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Tab Navigation */}
        <div className="flex items-center gap-1 mb-8 border-b border-gray-800">
          {[
            { id: 'compose' as Tab, label: 'Compose', icon: '✍️' },
            { id: 'inbox' as Tab, label: 'Inbox', icon: '📥' },
            { id: 'sent' as Tab, label: 'Sent', icon: '📤' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-[#b0805c]'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#b0805c]" />
              )}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-2 border-[#b0805c] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500">Loading agents...</p>
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No agents found.</p>
            <p className="text-sm text-gray-600 mt-2">
              Create an agent first to access email features.
            </p>
          </div>
        ) : currentAgent ? (
          <div className="animate-fadeIn">
            {activeTab === 'compose' && (
              <EmailCompose
                agentName={currentAgent.name}
                agentEmail={currentAgent.email}
                tier={currentAgent.tier}
                onSent={() => setActiveTab('sent')}
              />
            )}

            {activeTab === 'inbox' && (
              <EmailInbox
                agentName={currentAgent.name}
                agentEmail={currentAgent.email}
              />
            )}

            {activeTab === 'sent' && (
              <SentBox
                agentName={currentAgent.name}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
