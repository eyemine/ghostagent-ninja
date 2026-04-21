import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

const BASE_URL = 'https://ghostagent.ninja';

interface SitemapUrl {
  loc: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
  lastmod?: string;
}

const STATIC_URLS: SitemapUrl[] = [
  { loc: '/', changefreq: 'weekly', priority: 1.0 },
  { loc: '/sitemap', changefreq: 'weekly', priority: 0.9 },
  { loc: '/about', changefreq: 'monthly', priority: 0.7 },
  { loc: '/docs', changefreq: 'weekly', priority: 0.8 },
  { loc: '/agents', changefreq: 'daily', priority: 0.9 },
  { loc: '/nftmail', changefreq: 'weekly', priority: 0.9 },
  { loc: '/dashboard', changefreq: 'always', priority: 0.8 },
  { loc: '/dashboard/marketplace', changefreq: 'hourly', priority: 0.8 },
  { loc: '/evolve', changefreq: 'weekly', priority: 0.8 },
  { loc: '/byo-molt', changefreq: 'weekly', priority: 0.7 },
  { loc: '/ens', changefreq: 'monthly', priority: 0.6 },
  { loc: '/privacy', changefreq: 'monthly', priority: 0.3 },
  { loc: '/terms', changefreq: 'monthly', priority: 0.3 },
  { loc: '/llms.txt', changefreq: 'daily', priority: 0.5 },
  { loc: '/.well-known/agent-card.json', changefreq: 'daily', priority: 0.9 },
  { loc: '/.well-known/agent-routes.json', changefreq: 'daily', priority: 0.9 },
];

function generateSitemapXml(urls: SitemapUrl[]): string {
  const now = new Date().toISOString();
  
  const urlEntries = urls.map(u => `  <url>
    <loc>${BASE_URL}${u.loc}</loc>
    <lastmod>${u.lastmod || now}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority.toFixed(1)}</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
}

export async function GET() {
  const xml = generateSitemapXml(STATIC_URLS);
  
  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
