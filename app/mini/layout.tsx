import type { Metadata } from 'next';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

const miniAppEmbed = JSON.stringify({
  version: '1',
  imageUrl: `${APP_URL}/api/og?title=GhostAgent&description=Trustless+AI+agent+protocol`,
  button: {
    title: '👻 Open GhostAgent',
    action: {
      type: 'launch_frame',
      name: 'GhostAgent',
      url: `${APP_URL}/mini`,
      splashImageUrl: `${APP_URL}/icon.svg`,
      splashBackgroundColor: '#000000',
    },
  },
});

export const metadata: Metadata = {
  title: 'GhostAgent — Trustless AI Agent Protocol',
  description: 'Claim your FID-powered encrypted email agent. No wallet required.',
  other: {
    'fc:miniapp': miniAppEmbed,
    'fc:frame': miniAppEmbed,
  },
};

export default function MiniLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
