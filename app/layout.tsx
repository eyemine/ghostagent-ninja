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

export const metadata: Metadata = {
  title: "GhostAgent Ninja",
  description: "GhostAgent control surface",
  icons: {
    icon: 'https://gateway.lighthouse.storage/ipfs/bafkreicx5r5qfonzdmnhkeblrfbhaj7gcbgc34g6kvkh7hbxypd54qqx3a',
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
        <link rel="icon" href="https://gateway.lighthouse.storage/ipfs/bafkreicx5r5qfonzdmnhkeblrfbhaj7gcbgc34g6kvkh7hbxypd54qqx3a" type="image/png" />
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
