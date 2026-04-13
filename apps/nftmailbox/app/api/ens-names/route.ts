import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.toLowerCase().trim();
  if (!address || !/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  const query = `{
    account(id: "${address}") {
      registrations {
        expiryDate
        domain {
          name
          labelName
        }
      }
    }
  }`;

  try {
    const res = await fetch('https://api.thegraph.com/subgraphs/name/ensdomains/ens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const json = await res.json() as { data?: { account?: { registrations?: Array<{ expiryDate: string; domain: { name: string; labelName: string } }> } } };

    const now = Math.floor(Date.now() / 1000);
    const registrations = json.data?.account?.registrations ?? [];
    const names = registrations
      .filter((r) => parseInt(r.expiryDate) > now && r.domain.labelName)
      .map((r) => ({ name: r.domain.name, label: r.domain.labelName }));

    return NextResponse.json({ names }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'ENS lookup failed' }, { status: 503 });
  }
}
