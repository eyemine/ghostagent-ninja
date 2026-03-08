/// API Route: Molt Validation
/// POST /api/molt/validate
///
/// Validates whether an agent can molt to a target identity.
/// Returns { canMolt, errors, warnings, sourceAgent, targetAvailable }
///
/// Body: { agentName, callerWallet, targetName, targetTld }

import { NextRequest, NextResponse } from 'next/server';
import { validateMolt } from '../../../services/molt-validation';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      agentName?: string;
      callerWallet?: string;
      targetName?: string;
      targetTld?: string;
    };

    const { agentName, callerWallet, targetName, targetTld } = body;

    if (!agentName || !callerWallet || !targetName || !targetTld) {
      return NextResponse.json(
        { error: 'Missing required fields: agentName, callerWallet, targetName, targetTld' },
        { status: 400 },
      );
    }

    const result = await validateMolt({ agentName, callerWallet, targetName, targetTld });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Validation failed' }, { status: 500 });
  }
}
