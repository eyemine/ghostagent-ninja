import { NextRequest, NextResponse } from 'next/server';
import {
  pinDeclarationToIPFS,
  logDeclarationToGlassBox,
  type AuthorshipDeclarationDocument,
  type AuthorshipDeclarationRecord,
} from '../../../../services/authorship-declaration';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      document: AuthorshipDeclarationDocument;
      signature: string;
    };

    const { document: doc, signature } = body;
    if (!doc || !signature) {
      return NextResponse.json({ error: 'Missing document or signature' }, { status: 400 });
    }

    // 1. Pin to IPFS via Lighthouse
    let ipfsCid: string;
    try {
      ipfsCid = await pinDeclarationToIPFS(doc, signature);
    } catch (e: any) {
      return NextResponse.json({ error: `IPFS pin failed: ${e?.message}` }, { status: 502 });
    }

    // 2. Log to GlassBox (non-fatal)
    let glassBoxCid: string | undefined;
    try {
      await logDeclarationToGlassBox({
        agentName: doc.params.agentName,
        tld: doc.params.domain,
        authorWallet: doc.params.authorWallet,
        textHash: doc.textHash,
        ipfsCid,
        signature,
      });
      glassBoxCid = ipfsCid; // reuse CID as reference until GlassBox returns its own
    } catch {
      // non-fatal
    }

    const record: AuthorshipDeclarationRecord = {
      document: doc,
      signature,
      ipfsCid,
      glassBoxCid,
      storyPilCid: ipfsCid, // same CID to attach to IPA socialLegal field
    };

    return NextResponse.json(record);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Internal error' }, { status: 500 });
  }
}
