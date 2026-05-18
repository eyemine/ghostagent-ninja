'use client';

import { useState, useEffect } from 'react';

interface SentEmail {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  sentAt: number;
}

interface SentBoxProps {
  agentName: string;
}

function getSentKey(agentName: string) {
  return `nftmail:sent:${agentName}`;
}

export default function SentBox({ agentName }: SentBoxProps) {
  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<SentEmail | null>(null);

  // Load sent emails from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(getSentKey(agentName));
    if (saved) {
      try {
        const emails: SentEmail[] = JSON.parse(saved);
        setSentEmails(emails);
      } catch {
        // Invalid data
      }
    }
  }, [agentName]);

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
            ← Back to Sent
          </button>
          <span className="text-xs text-gray-500">{formatDate(selectedEmail.sentAt)}</span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <div className="text-sm text-[#f2eee4]">
              {selectedEmail.to.join(', ')}
            </div>
          </div>

          {selectedEmail.cc.length > 0 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">CC</label>
              <div className="text-sm text-[#f2eee4]">
                {selectedEmail.cc.join(', ')}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1">Subject</label>
            <div className="text-lg font-semibold text-[#f2eee4]">
              {selectedEmail.subject || '(no subject)'}
            </div>
          </div>

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
      <h3 className="text-lg font-semibold text-[#f2eee4] mb-4">Sent Emails</h3>

      {sentEmails.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No sent emails yet.</p>
          <p className="text-sm mt-2">Emails you send will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sentEmails.map((email, index) => (
            <button
              key={index}
              onClick={() => setSelectedEmail(email)}
              className="w-full text-left p-3 bg-black/30 hover:bg-black/50 rounded-lg transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-[#f2eee4] truncate">
                      {email.to.join(', ')}
                    </span>
                    {email.cc.length > 0 && (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded">
                        +{email.cc.length} CC
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-400 truncate">
                    {email.subject || '(no subject)'}
                  </div>
                </div>
                <span className="text-xs text-gray-500 ml-4 shrink-0">
                  {formatDate(email.sentAt)}
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
        Showing {sentEmails.length} sent email{sentEmails.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
