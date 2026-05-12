/// Forwarding Settings component for Premium level accounts
/// Allows users to configure email forwarding with filters

'use client';

import { useState, useEffect } from 'react';

interface ForwardingConfig {
  enabled: boolean;
  targetEmail: string;
  level: 'premium' | 'ghost';
  filters?: {
    sendOtpOnly?: boolean;
    excludeNewsletters?: boolean;
    minimumTrustScore?: number;
  };
}

interface ForwardingSettingsProps {
  agentName: string;
  agentTier: string;
}

export default function ForwardingSettings({ agentName, agentTier }: ForwardingSettingsProps) {
  const [config, setConfig] = useState<ForwardingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [targetEmail, setTargetEmail] = useState('');
  const [sendOtpOnly, setSendOtpOnly] = useState(false);
  const [excludeNewsletters, setExcludeNewsletters] = useState(false);
  const [minimumTrustScore, setMinimumTrustScore] = useState(0);

  useEffect(() => {
    fetchConfig();
  }, [agentName]);

  const fetchConfig = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/agent/forwarding?agentName=${encodeURIComponent(agentName)}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch forwarding config: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.config) {
        setConfig(data.config);
        setEnabled(data.config.enabled);
        setTargetEmail(data.config.targetEmail);
        setSendOtpOnly(data.config.filters?.sendOtpOnly || false);
        setExcludeNewsletters(data.config.filters?.excludeNewsletters || false);
        setMinimumTrustScore(data.config.filters?.minimumTrustScore || 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    if (enabled && !targetEmail) {
      setError('Target email is required when forwarding is enabled');
      return;
    }

    if (targetEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      setError('Invalid email format');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await fetch('/api/agent/forwarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentName,
          enabled,
          targetEmail,
          filters: {
            sendOtpOnly,
            excludeNewsletters,
            minimumTrustScore: minimumTrustScore > 0 ? minimumTrustScore : undefined
          }
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save forwarding config');
      }
      
      const data = await response.json();
      setConfig(data.config);
      setSuccess('Forwarding configuration saved successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const deleteConfig = async () => {
    if (!confirm('Are you sure you want to remove forwarding configuration?')) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await fetch(`/api/agent/forwarding?agentName=${encodeURIComponent(agentName)}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete forwarding config: ${response.statusText}`);
      }
      
      setConfig(null);
      setEnabled(false);
      setTargetEmail('');
      setSendOtpOnly(false);
      setExcludeNewsletters(false);
      setMinimumTrustScore(0);
      setSuccess('Forwarding configuration removed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-gray-400">Loading forwarding settings...</span>
      </div>
    );
  }

  // Check if forwarding is available for this tier
  if (agentTier !== 'premium' && agentTier !== 'ghost') {
    return (
      <div className="p-8 text-center">
        <div className="text-yellow-400 mb-4">
          <svg className="w-12 h-12 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">Premium Feature</h3>
        <p className="text-gray-400 mb-4">
          Email forwarding is available for Premium and Ghost level agents.
        </p>
        <p className="text-sm text-gray-500">
          Upgrade to Premium to enable email forwarding to your personal inbox.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Email Forwarding
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            Forward emails to your personal inbox with intelligent filtering
          </p>
        </div>
        
        {config && (
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${
            config.enabled 
              ? 'bg-green-900/30 text-green-400' 
              : 'bg-gray-700 text-gray-400'
          }`}>
            {config.enabled ? 'Active' : 'Inactive'}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-900/30 border border-green-700 rounded text-green-400 text-sm">
          {success}
        </div>
      )}

      <div className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div>
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
            />
            <span className="text-white font-medium">Enable email forwarding</span>
          </label>
        </div>

        {/* Target Email */}
        {enabled && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Forward to Email
            </label>
            <input
              type="email"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              placeholder="your-email@example.com"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        )}

        {/* Filters */}
        {enabled && (
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-300">Filtering Options</h4>
            
            <div>
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendOtpOnly}
                  onChange={(e) => setSendOtpOnly(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
                />
                <div>
                  <span className="text-white">Forward OTP codes only</span>
                  <p className="text-xs text-gray-500">Only forward emails containing 6-digit verification codes</p>
                </div>
              </label>
            </div>

            <div>
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeNewsletters}
                  onChange={(e) => setExcludeNewsletters(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
                />
                <div>
                  <span className="text-white">Exclude newsletters</span>
                  <p className="text-xs text-gray-500">Don't forward marketing emails and newsletters</p>
                </div>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Minimum Trust Score
              </label>
              <div className="flex items-center space-x-3">
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.1"
                  value={minimumTrustScore}
                  onChange={(e) => setMinimumTrustScore(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <span className="text-white font-mono text-sm w-12 text-right">
                  {minimumTrustScore.toFixed(1)}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Only forward emails from senders with trust score ≥ this value
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between pt-4 border-t border-gray-700">
          <div>
            {config && (
              <button
                onClick={deleteConfig}
                disabled={saving}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition disabled:opacity-50"
              >
                Remove Configuration
              </button>
            )}
          </div>
          
          <button
            onClick={saveConfig}
            disabled={saving}
            className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {/* Information */}
      <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700 rounded-lg">
        <h4 className="text-sm font-medium text-blue-400 mb-2">How Forwarding Works</h4>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>• Emails are processed and parsed for intelligent content</li>
          <li>• Forwarded emails include agent intelligence data (OTP codes, intent, trust score)</li>
          <li>• Original emails are still stored in your GhostAgent inbox</li>
          <li>• Forwarding activity is logged for audit purposes</li>
          <li>• Uses Mailgun for reliable delivery (requires API credentials)</li>
        </ul>
      </div>
    </div>
  );
}
