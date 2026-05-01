import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const revalidate = 0;

export async function GET() {
  const timestamp = new Date().toISOString();
  return NextResponse.json({ alive: true, timestamp });
}
