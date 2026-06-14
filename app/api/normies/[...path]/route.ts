import { NextRequest, NextResponse } from 'next/server';

const NORMIES_API = 'https://api.normies.art';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const pathStr = path.join('/');
  const url = `${NORMIES_API}/${pathStr}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json, image/svg+xml, */*' },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Normies API ${res.status}` }, { status: res.status });
    }

    const contentType = res.headers.get('content-type') ?? 'application/json';

    if (contentType.includes('svg') || contentType.includes('image')) {
      const buffer = await res.arrayBuffer();
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const data = (await res.json()) as unknown;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Failed to reach Normies API' }, { status: 502 });
  }
}
