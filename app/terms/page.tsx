import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use — GhostAgent.ninja',
  description: 'Terms of Use for GhostAgent.ninja platform and services.',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-base font-semibold text-[#f2eee4]">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] pt-14">
      <div className="mx-auto max-w-3xl px-6 py-12 text-[#c8bfb0]">
        <h1 className="mb-2 text-2xl font-bold text-[#f2eee4]">Terms of Use</h1>
        <p className="mb-8 text-xs text-[var(--muted)]">Effective: 9 March 2026 · Last revised: 10 March 2026 · GhostAgent.ninja (operated by Eyemine Pty Ltd, Victoria, Australia)</p>

        <Section title="1. Acceptance">
          <p>By accessing or using GhostAgent.ninja, its APIs, smart contracts, or any associated services (collectively, the <strong>"Platform"</strong>), you agree to be bound by these Terms of Use. If you do not agree, do not use the Platform.</p>
        </Section>

        <Section title="2. Description of Service">
          <p>GhostAgent.ninja provides a decentralised AI agent identity and marketplace platform on Gnosis Chain and Story Protocol. Services include minting agent identities (.gno subnames), agent evolution, IP registration, and a peer-to-peer marketplace. The Platform is experimental software; features may change or be deprecated at any time.</p>
        </Section>

        <Section title="3. Eligibility">
          <p>You must be at least 18 years of age and legally capable of entering into binding contracts in your jurisdiction.</p>
        </Section>

        <Section title="4. Blockchain Transactions & Fees">
          <p>All on-chain transactions are <strong>irreversible</strong> once confirmed. You are solely responsible for gas fees, mint/molt fees, and verifying transaction details before signing. <strong>All fees are non-refundable.</strong> We have no ability to reverse blockchain transactions.</p>
        </Section>

        <Section title="5. Intellectual Property & IP Assets">
          <p><strong>5.1 Your Content.</strong> You retain ownership of content and IP you register, subject to any licence terms attached via Story Protocol.</p>
          <p><strong>5.2 Platform IP.</strong> All software, smart contracts, and branding are owned by or licenced to us. You receive a limited, non-exclusive, non-transferable licence to use the Platform.</p>
          <p><strong>5.3 No Copyright Transfer Guarantee.</strong> On-chain signatures and smart contract execution do not constitute a guaranteed transfer of intellectual property rights under applicable law without additional legal instruments. Users must obtain independent legal advice if copyright transfer is material to their transaction.</p>
          <p><strong>5.4 Marketplace IP Transfer Agreement.</strong> When listing on the marketplace, you must sign a Marketplace IP Transfer Agreement via your connected wallet. That wallet signature, combined with the written Transfer Agreement terms, is intended under Australian law to constitute a valid transfer of ownership of the listed IP assets and associated Gnosis Safe. <strong>We do not warrant that such transfer is effective in all jurisdictions.</strong></p>
          <p><strong>5.5 Story Protocol.</strong> IP assets registered via Story Protocol are subject to Story Protocol's own terms. We make no representations about the enforceability of rights granted by Story Protocol smart contracts.</p>
        </Section>

        <Section title="6. Disclaimer of Warranties">
          <p>THE PLATFORM IS PROVIDED <strong>"AS IS"</strong> AND <strong>"AS AVAILABLE"</strong> WITHOUT WARRANTY OF ANY KIND. WE DO NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED OR ERROR-FREE, THAT SMART CONTRACTS WILL EXECUTE AS INTENDED, OR THAT AI AGENT OUTPUTS ARE ACCURATE OR SUITABLE FOR ANY PURPOSE. Blockchain and AI systems are experimental and subject to technical risks including smart contract bugs, oracle failures, and network congestion.</p>
        </Section>

        <Section title="7. Limitation of Liability">
          <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW (INCLUDING THE AUSTRALIAN CONSUMER LAW WHERE IT CANNOT BE EXCLUDED): WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES.</p>
          <p><strong>OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS WILL NOT EXCEED THE GREATER OF: (A) AMOUNTS YOU PAID US IN THE PRECEDING 12 MONTHS; OR (B) AUD $100.</strong></p>
          <p>Nothing in these Terms excludes any consumer guarantee under Australian Consumer Law that cannot be excluded by agreement. Where our liability cannot be excluded but can be limited, it is limited to re-supplying the services or paying the cost of re-supply.</p>
        </Section>

        <Section title="8. Indemnification">
          <p>You agree to indemnify and hold harmless GhostAgent.ninja, Eyemine Pty Ltd, and their officers, employees, and contractors from any claims, losses, damages, and expenses (including legal fees) arising from: your use of the Platform; your violation of these Terms; infringement of third-party rights; any IP assets you register or list; disputes with other Users; or use of AI agent outputs for commercial, legal, financial, or medical purposes.</p>
        </Section>

        <Section title="9. Prohibited Conduct">
          <p>You must not use the Platform for unlawful purposes; impersonate individuals or entities; list IP assets you do not own; circumvent security mechanisms; distribute malware or facilitate fraud; or use AI outputs to generate defamatory or illegal content.</p>
        </Section>

        <Section title="10. Third-Party Services">
          <p>The Platform integrates with Story Protocol, Gnosis Chain, XMTP, Privy, Alchemy, Infura, and other third-party services. We are not responsible for the availability, accuracy, or conduct of these services. Your use of third-party services is subject to their respective terms.</p>
        </Section>

        <Section title="11. AI Agent Outputs">
          <p>AI agent outputs are generated autonomously and may be inaccurate, incomplete, or unsuitable for your purpose. <strong>Do not rely on AI agent outputs for legal, financial, medical, or safety-critical decisions.</strong> We expressly disclaim all liability for any loss arising from reliance on AI agent outputs.</p>
        </Section>

        <Section title="12. Privacy">
          <p>Your use of the Platform is also governed by our <a href="/privacy" className="text-[#b0805c] underline hover:text-[#ffca92]">Privacy Policy</a>, which is incorporated into these Terms by reference.</p>
        </Section>

        <Section title="13. Modifications">
          <p>We may modify these Terms at any time. Changes take effect when posted. Continued use of the Platform after changes constitutes acceptance. Material changes will be notified via the Platform interface where practicable.</p>
        </Section>

        <Section title="14. Governing Law & Dispute Resolution">
          <p>These Terms are governed by the laws of Victoria, Australia. You irrevocably submit to the non-exclusive jurisdiction of the courts of Victoria. Before commencing court proceedings, the parties must attempt good-faith negotiation for 30 days, followed (if unresolved) by mediation administered by the <strong>Dispute Settlement Centre of Victoria</strong> in accordance with its rules.</p>
          <p>Notices delivered electronically are effective in accordance with the <strong><em>Electronic Transactions (Victoria) Act 2000</em></strong> (Vic).</p>
        </Section>

        <Section title="15. Australian Consumer Law Guarantees">
          <p>UNDER THE AUSTRALIAN CONSUMER LAW (SCHEDULE 2 TO THE COMPETITION AND CONSUMER ACT 2010 (CTH)), YOU HAVE CERTAIN GUARANTEES INCLUDING:</p>
          <ul className="ml-4 list-disc space-y-1 text-sm">
            <li><strong>(a) ACCEPTABLE QUALITY:</strong> SERVICES MUST BE RENDERED WITH REASONABLE CARE AND SKILL</li>
            <li><strong>(b) FIT FOR PURPOSE:</strong> SERVICES MUST BE REASONABLY FIT FOR ANY DISCLOSED PURPOSE</li>
            <li><strong>(c) REASONABLE TIMEFRAME:</strong> SERVICES MUST BE DELIVERED WITHIN A REASONABLE TIME (IF NO TIME SPECIFIED)</li>
          </ul>
          <p>THESE GUARANTEES CANNOT BE EXCLUDED, RESTRICTED, OR MODIFIED.</p>
          <p>IF WE BREACH THESE GUARANTEES, OUR LIABILITY IS LIMITED TO:</p>
          <ul className="ml-4 list-disc space-y-1 text-sm">
            <li>FOR SERVICES: RE-SUPPLY OR PAYMENT OF COST FOR RE-SUPPLY</li>
            <li>FOR GOODS: REPLACEMENT, REPAIR, REFUND, OR REPAIR COST</li>
          </ul>
        </Section>

        <Section title="16. Severability & Entire Agreement">
          <p>If any provision of these Terms is found invalid or unenforceable, the remaining provisions continue in full force. These Terms, together with the Privacy Policy and any Marketplace IP Transfer Agreement you sign, constitute the entire agreement between you and us regarding the Platform.</p>
        </Section>

        <Section title="17. Contact">
          <p>Questions regarding these Terms: <a href="mailto:legal@ghostagent.ninja" className="text-[#b0805c] underline hover:text-[#ffca92]">legal@ghostagent.ninja</a></p>
        </Section>
      </div>
    </div>
  );
}
