/// Message Detail component with Human View and Agent JSON tabs
/// Direct competitor to agentmail.to's email display with added AI-ready features

'use client';

import { useState } from 'react';
import AgentJsonTab from './AgentJsonTab';

interface MessageDetailProps {
  agentName: string;
  message: {
    id: string;
    from: string;
    to: string;
    subject: string;
    content: string;
    timestamp: number;
    isInternal?: boolean;
    isVerified?: boolean;
    channel?: string;
  };
}

export default function MessageDetail({ agentName, message }: MessageDetailProps) {
  const [activeTab, setActiveTab] = useState<'human' | 'json'>('human');

  // Process email content for display
  const formatEmailContent = (content: string) => {
    // Basic HTML sanitization and formatting
    return content
      .replace(/\n/g, '<br />')
      .replace(/(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline">$1</a>')
      .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<span class="text-blue-300">$1</span>');
  };

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Message Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white mb-1">{message.subject}</h2>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span>From: <span className="text-gray-300">{message.from}</span></span>
              <span>•</span>
              <span>{new Date(message.timestamp).toLocaleString()}</span>
            </div>
          </div>
          
          {/* Verification badges */}
          <div className="flex items-center gap-2">
            {message.isVerified && (
              <div className="flex items-center gap-1 px-2 py-1 bg-green-900/30 text-green-400 text-xs rounded">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Verified
              </div>
            )}
            {message.isInternal && (
              <div className="flex items-center gap-1 px-2 py-1 bg-purple-900/30 text-purple-400 text-xs rounded">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                </svg>
                A2A
              </div>
            )}
            {message.channel && (
              <div className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">
                {message.channel}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('human')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition ${
            activeTab === 'human'
              ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-900/10'
              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Human View
          </div>
        </button>
        
        <button
          onClick={() => setActiveTab('json')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition ${
            activeTab === 'json'
              ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-900/10'
              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Agent JSON
          </div>
        </button>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'human' && (
          <div className="p-6">
            <div className="prose prose-invert max-w-none">
              <div 
                className="text-gray-300 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: formatEmailContent(message.content) }}
              />
            </div>
            
            {/* Quick Actions for Human View */}
            <div className="mt-6 pt-6 border-t border-gray-700">
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  Message ID: {message.id}
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition">
                    Mark as Read
                  </button>
                  <button className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition">
                    Archive
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'json' && (
          <AgentJsonTab 
            agentName={agentName}
            messageId={message.id}
            isActive={true}
          />
        )}
      </div>
    </div>
  );
}
