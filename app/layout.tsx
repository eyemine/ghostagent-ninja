import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ConditionalLayout } from "./components/ConditionalLayout";

const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Roboto_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const dynamic = 'force-dynamic';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const LOGO_URL = 'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreicx5r5qfonzdmnhkeblrfbhaj7gcbgc34g6kvkh7hbxypd54qqx3a';

const miniAppEmbed = JSON.stringify({
  version: '1',
  imageUrl: `${APP_URL}/api/og?title=GhostAgent&description=Trustless+AI+agent+protocol`,
  button: {
    title: '👻 Open GhostAgent',
    action: {
      type: 'launch_frame',
      name: 'GhostAgent',
      url: `${APP_URL}/mini`,
      splashImageUrl: LOGO_URL,
      splashBackgroundColor: '#000000',
    },
  },
});

export const metadata: Metadata = {
  title: "GhostAgent Ninja",
  description: "GhostAgent control surface",
  icons: {
    icon: LOGO_URL,
    shortcut: LOGO_URL,
    apple: LOGO_URL,
  },
  other: {
    'fc:miniapp': miniAppEmbed,
    'fc:frame': miniAppEmbed,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href={LOGO_URL} type="image/png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (typeof window !== 'undefined' && !window.ethereum) {
                  Object.defineProperty(window, 'ethereum', {
                    configurable: true,
                    writable: true,
                    value: undefined,
                  });
                }
              } catch(e) {}
              // Suppress non-fatal Spindl/Privy analytics errors that crash the app
              // when ad blockers or CORS block their telemetry endpoints
              window.addEventListener('unhandledrejection', function(e) {
                var msg = e && e.reason && (e.reason.message || String(e.reason));
                if (msg && (msg.indexOf('spindl') !== -1 || msg.indexOf('CORS') !== -1 || msg.indexOf('ERR_BLOCKED_BY_CLIENT') !== -1)) {
                  e.preventDefault();
                  return;
                }
              });
              window.addEventListener('error', function(e) {
                var src = e && e.filename && e.filename.toString();
                if (src && src.indexOf('spindl') !== -1) {
                  e.preventDefault();
                  return;
                }
              });
            `,
          }}
        />
        <ConditionalLayout>
          <ErrorBoundary>
            <Providers>
              {children}
            </Providers>
          </ErrorBoundary>
        </ConditionalLayout>
      </body>
    </html>
  );
}
