import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/.well-known/agent-card.json',
        destination: '/api/well-known/agent-card.json',
      },
      {
        source: '/.well-known/agent.json',
        destination: '/api/well-known/agent-card.json',
      },
    ];
  },
};

export default nextConfig;
