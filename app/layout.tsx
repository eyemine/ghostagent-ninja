import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppNav } from "./components/AppNav";
import { Footer } from "./components/Footer";

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

const miniAppEmbed = JSON.stringify({
  version: '1',
  imageUrl: `${APP_URL}/api/og?title=nftmail.box&description=Encrypted+agent+email+for+Farcaster`,
  button: {
    title: '👻 Claim Agent',
    action: {
      type: 'launch_frame',
      name: 'nftmail.box',
      url: `${APP_URL}/mini`,
      splashImageUrl: `${APP_URL}/icon.svg`,
      splashBackgroundColor: '#000000',
    },
  },
});

export const metadata: Metadata = {
  title: "GhostAgent Ninja",
  description: "GhostAgent control surface",
  icons: {
    icon: '/icon.svg',
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
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
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
            `,
          }}
        />
        <AppNav />
        <ErrorBoundary>
          <Providers>
            {children}
          </Providers>
        </ErrorBoundary>
        <Footer />
      </body>
    </html>
  );
}
