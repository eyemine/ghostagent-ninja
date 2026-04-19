/// Forwarding Setup Panel for Imago accounts
/// Allows users to configure email forwarding for their premium tier

'use client';

import { useState } from 'react';

interface ForwardingConfig {
  enabled: boolean;
  targetEmail: string;
  level: 'imago' | 'ghost';
  ownerAddress?: string;
  setupDate?: number;
}

interface ForwardingSetupProps {
  agentName: string;
  ownerAddress: string;
  currentConfig?: ForwardingConfig;
  onSave: (config: ForwardingConfig) => Promise<void>;
}

export default function ForwardingSetup({ agentName, ownerAddress, currentConfig, onSave }: ForwardingSetupProps) {
  const [enabled, setEnabled] = useState(currentConfig?.enabled || false);
  const [targetEmail, setTargetEmail] = useState(currentConfig?.targetEmail || '');
  const [level, setLevel] = useState<'imago' | 'ghost'>(currentConfig?.level || 'imago');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);

    if (enabled && !targetEmail) {
      setError('Target email is required when forwarding is enabled');
      setSaving(false);
      return;
    }

    if (enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      setError('Please enter a valid email address');
      setSaving(false);
      return;
    }

    try {
      await onSave({
        enabled,
        targetEmail,
        level,
        ownerAddress
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save forwarding settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Email Forwarding</h3>
          <p className="text-sm text-gray-400">
            Forward incoming emails to your personal inbox
          </p>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
          enabled 
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
        }`}>
          {enabled ? 'Active' : 'Disabled'}
        </div>
      </div>

      {/* Security Notice */}
      <div className="p-3 bg-blue-900/20 border border-blue-500/20 rounded-lg">
        <div className="flex items-start gap-2">
          <svg className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-blue-200">Security Feature</p>
            <p className="text-xs text-blue-200/80 mt-1">
              Forwarding is automatically disabled if NFT ownership is transferred. Your wallet address is verified on each email to prevent unauthorized access.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3">
            <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              enabled ? 'bg-blue-500 border-blue-500' : 'border-gray-500'
            }`}>
              {enabled && (
                <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
            <div>
              <span className="text-sm font-medium text-white">Enable Forwarding</span>
              <p className="text-xs text-gray-400">Forward emails to external address</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? 'bg-blue-600' : 'bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {enabled && (
          <div className="space-y-3 pl-4 border-l-2 border-blue-500/30">
            <div>
              <label htmlFor="targetEmail" className="block text-sm font-medium text-gray-300 mb-1">
                Forward to Email
              </label>
              <input
                type="email"
                id="targetEmail"
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Forwarding Level</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLevel('imago')}
                  className={`p-3 rounded-lg border text-left transition ${
                    level === 'imago'
                      ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <div className="text-sm font-semibold mb-1">Imago</div>
                  <div className="text-xs opacity-70">Full content + metadata</div>
                </button>
                <button
                  type="button"
                  onClick={() => setLevel('ghost')}
                  className={`p-3 rounded-lg border text-left transition ${
                    level === 'ghost'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <div className="text-sm font-semibold mb-1">Ghost</div>
                  <div className="text-xs opacity-70">Content only (minimal)</div>
                </button>
              </div>
            </div>

            <div className="p-3 bg-blue-900/20 border border-blue-500/20 rounded-lg">
              <p className="text-xs text-blue-200">
                <span className="font-semibold">Imago level:</span> Forwards full email content including parsed metadata for agent intelligence.
              </p>
              <p className="text-xs text-blue-200 mt-1">
                <span className="font-semibold">Ghost level:</span> Forwards plain text content only - minimal metadata footprint.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-400 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3 bg-emerald-900/30 border border-emerald-700 rounded text-emerald-400 text-sm">
            ✓ Forwarding settings saved successfully
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-semibold py-2.5 px-4 rounded-lg transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Forwarding Settings'}
        </button>
      </form>
    </div>
  );
}
