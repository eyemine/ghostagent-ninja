'use client';

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static isAnalyticsError(error: Error): boolean {
    const msg = error?.message ?? '';
    const stack = error?.stack ?? '';
    return (
      msg.includes('spindl') ||
      msg.includes('CORS') ||
      msg.includes('ERR_BLOCKED_BY_CLIENT') ||
      stack.includes('spindl') ||
      stack.includes('spindl.link') ||
      stack.includes('api.spindl.xyz') ||
      // Privy bundles Spindl — its chunk crashes when Spindl is blocked by ad blockers
      (msg.includes("Cannot read properties of null") && stack.includes('3723-'))
    );
  }

  static getDerivedStateFromError(error: Error) {
    if (ErrorBoundary.isAnalyticsError(error)) {
      return { hasError: false, error: null };
    }
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (!ErrorBoundary.isAnalyticsError(error)) {
      console.error('[ErrorBoundary]', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
          <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-4 py-8">
            <div className="w-full rounded-2xl border border-red-500/30 bg-red-500/8 p-6">
              <div className="text-xs font-semibold tracking-[0.18em] text-red-300">CLIENT ERROR</div>
              <h2 className="mt-2 text-lg font-semibold text-white">Something went wrong</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                This is often caused by browser wallet extensions conflicting with each other.
                Try disabling extra wallet extensions or using a different browser.
              </p>
              <pre className="mt-3 max-h-24 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-red-300/70">
                {this.state.error?.message}
              </pre>
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                className="mt-4 rounded-lg bg-[rgba(0,163,255,0.12)] px-4 py-2 text-xs font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.2)]"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
