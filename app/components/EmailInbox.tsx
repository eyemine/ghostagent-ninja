'use client';

import { useState, useEffect, useCallback } from 'react';

interface InboxEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: number;
  encrypted: boolean;
}

interface EmailInboxProps {
  agentName: string;
  agentEmail: string;
}

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

export default function EmailInbox({ agentName, agentEmail }: EmailInboxProps) {
  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<InboxEmail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getInbox',
          label: agentName,
          limit: 50,
        }),
      });

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }

      setEmails(data.emails || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load inbox');
    } finally {
      setLoading(false);
    }
  }, [agentName]);

  // Load inbox on mount and every 30 seconds
  useEffect(() => {
    fetchInbox();
    const timer = setInterval(fetchInbox, 30000);
    return () => clearInterval(timer);
  }, [fetchInbox]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncate = (str: string, max: number) => {
    return str.length > max ? str.slice(0, max) + '...' : str;
  };

  if (selectedEmail) {
    return (
      <div className="w-full max-w-2xl mx-auto bg-black/40 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setSelectedEmail(null)}
            className="text-sm text-[#b0805c] hover:text-[#f2eee4] transition-colors"
          >
            ← Back to Inbox
          </button>
          <span className="text-xs text-gray-500">{formatDate(selectedEmail.receivedAt)}</span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <div className="text-sm text-[#f2eee4]">{selectedEmail.from}</div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Subject</label>
            <div className="text-lg font-semibold text-[#f2eee4]">
              {selectedEmail.subject || '(no subject)'}
            </div>
          </div>

          {selectedEmail.encrypted && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <span className="text-xs text-amber-400">🔒 End-to-end encrypted</span>
            </div>
          )}

          <div className="pt-4 border-t border-gray-800">
            <pre className="text-sm text-[#f2eee4] whitespace-pre-wrap font-sans">
              {selectedEmail.body}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto bg-black/40 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[#f2eee4]">Inbox</h3>
        <button
          onClick={fetchInbox}
          disabled={loading}
          className="text-xs text-[#b0805c] hover:text-[#f2eee4] transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {emails.length === 0 && !loading ? (
        <div className="text-center py-12 text-gray-500">
          <p>No emails yet.</p>
          <p className="text-sm mt-2">Your inbox is empty.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {emails.map((email) => (
            <button
              key={email.id}
              onClick={() => setSelectedEmail(email)}
              className="w-full text-left p-3 bg-black/30 hover:bg-black/50 rounded-lg transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-[#f2eee4] truncate">
                      {email.from}
                    </span>
                    {email.encrypted && (
                      <span className="text-xs">🔒</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-400 truncate">
                    {email.subject || '(no subject)'}
                  </div>
                </div>
                <span className="text-xs text-gray-500 ml-4 shrink-0">
                  {formatDate(email.receivedAt)}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500 truncate">
                {truncate(email.body, 100)}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-gray-800 text-xs text-gray-500">
        Showing {emails.length} email{emails.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
