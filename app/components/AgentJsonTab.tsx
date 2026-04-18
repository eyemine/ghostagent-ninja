/// Agent JSON Tab component for message detail view
/// Shows structured email data with syntax highlighting
/// Competes directly with agentmail.to's developer features

'use client';

import { useState, useEffect } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';

interface AgentJsonTabProps {
  agentName: string;
  messageId: string;
  isActive: boolean;
}

interface AgentJsonData {
  id: string;
  metadata: {
    tier: string;
    timestamp: string;
    encoding: string;
    safeAddress?: string;
  };
  content: {
    from: string;
    subject: string;
    summary: string;
  };
  agent_features: {
    is_otp: boolean;
    otp_code: string | null;
    intent: string;
    trust_score_impact: string;
  };
  encrypted?: boolean;
  safeAddress?: string;
  parsed_data?: any;
}

export default function AgentJsonTab({ agentName, messageId, isActive }: AgentJsonTabProps) {
  const [jsonData, setJsonData] = useState<AgentJsonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isActive && agentName && messageId) {
      fetchAgentJson();
    }
  }, [isActive, agentName, messageId]);

  const fetchAgentJson = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/agent/message/${messageId}/json?agentName=${encodeURIComponent(agentName)}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch Agent JSON: ${response.statusText}`);
      }
      
      const data = await response.json();
      setJsonData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isActive) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-gray-400">Loading Agent JSON...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-400 mb-4">Error loading Agent JSON</div>
        <div className="text-gray-500 text-sm">{error}</div>
        <button 
          onClick={fetchAgentJson}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!jsonData) {
    return (
      <div className="p-8 text-center text-gray-500">
        No Agent JSON data available
      </div>
    );
  }

  // Darkbox/Locked state
  if (jsonData.encrypted) {
    return (
      <div className="p-8 text-center">
        {/* Locked Graphic */}
        <div className="mb-6">
          <svg className="w-16 h-16 mx-auto text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
        </div>
        
        <h3 className="text-xl font-semibold text-white mb-2">Privacy Active</h3>
        <p className="text-gray-400 mb-4">
          Content encrypted for Safe {jsonData.safeAddress || '0x...'}
        </p>
        <p className="text-sm text-gray-500 mb-6">
          Use the GhostSDK to decrypt locally
        </p>
        
        {/* Show available metadata */}
        <div className="bg-gray-800 rounded-lg p-4 text-left max-w-md mx-auto">
          <h4 className="text-sm font-semibold text-gray-300 mb-2">Available Metadata:</h4>
          <div className="text-xs text-gray-400 space-y-1">
            <div><span className="text-gray-500">Tier:</span> {jsonData.metadata.tier}</div>
            <div><span className="text-gray-500">Timestamp:</span> {jsonData.metadata.timestamp}</div>
            <div><span className="text-gray-500">Intent:</span> {jsonData.agent_features.intent}</div>
            <div><span className="text-gray-500">Trust Impact:</span> {jsonData.agent_features.trust_score_impact}</div>
          </div>
        </div>
      </div>
    );
  }

  // Glassbox - Show full JSON
  return (
    <div className="relative">
      {/* Header with copy button */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-sm font-medium text-green-400">Glassbox Active</span>
          <span className="text-xs text-gray-500">AI-Ready Structured Data</span>
        </div>
        
        <CopyToClipboard 
          text={JSON.stringify(jsonData, null, 2)}
          onCopy={handleCopy}
        >
          <button className="flex items-center gap-2 px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {copied ? 'Copied!' : 'Copy JSON'}
          </button>
        </CopyToClipboard>
      </div>

      {/* JSON Display */}
      <div className="p-4 overflow-auto" style={{ maxHeight: '600px' }}>
        <pre className="text-xs text-gray-300 font-mono leading-relaxed">
          <code>{JSON.stringify(jsonData, null, 2)}</code>
        </pre>
      </div>

      {/* Key Insights Bar */}
      <div className="border-t border-gray-700 p-4 bg-gray-800">
        <h4 className="text-sm font-semibold text-gray-300 mb-2">Key Insights for Your Agent</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-gray-500">Intent:</span>
            <div className="font-medium text-blue-400">{jsonData.agent_features.intent}</div>
          </div>
          <div>
            <span className="text-gray-500">Trust Impact:</span>
            <div className={`font-medium ${
              jsonData.agent_features.trust_score_impact.startsWith('+') 
                ? 'text-green-400' 
                : jsonData.agent_features.trust_score_impact.startsWith('-')
                ? 'text-red-400'
                : 'text-gray-400'
            }`}>
              {jsonData.agent_features.trust_score_impact}
            </div>
          </div>
          {jsonData.agent_features.is_otp && (
            <div>
              <span className="text-gray-500">OTP Code:</span>
              <div className="font-mono font-medium text-yellow-400">{jsonData.agent_features.otp_code}</div>
            </div>
          )}
          <div>
            <span className="text-gray-500">Sender:</span>
            <div className="font-medium text-gray-300 truncate" title={jsonData.content.from}>
              {jsonData.content.from}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
