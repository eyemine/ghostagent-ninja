import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — GhostAgent.ninja',
  description: 'Privacy Policy for GhostAgent.ninja platform and services.',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-base font-semibold text-[#f2eee4]">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] pt-14">
      <div className="mx-auto max-w-3xl px-6 py-12 text-[#c8bfb0]">
        <h1 className="mb-2 text-2xl font-bold text-[#f2eee4]">Privacy Policy</h1>
        <p className="mb-8 text-xs text-[var(--muted)]">Effective: 9 March 2026 · GhostAgent.ninja (operated by Eyemine Pty Ltd, Australia)</p>

        <Section title="1. Overview">
          <p>GhostAgent.ninja respects your privacy. This Privacy Policy explains how we collect, use, store, and disclose information when you use the Platform. We operate under the <strong>Australian Privacy Act 1988 (Cth)</strong> and the Australian Privacy Principles (APPs).</p>
          <p>Because GhostAgent.ninja is built on public blockchains, some data you submit is <strong>permanently public and cannot be deleted</strong>. This is inherent to blockchain technology and is not within our control once a transaction is confirmed.</p>
        </Section>

        <Section title="2. Information We Collect">
          <p><strong>2.1 On-Chain Data (public).</strong> When you interact with smart contracts on Gnosis Chain or Story Protocol, the following data is permanently recorded on public blockchains:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Your wallet address</li>
            <li>Agent subnames you mint (e.g. <code>name.nftmail.gno</code>)</li>
            <li>Transaction hashes, timestamps, and fees paid</li>
            <li>IP asset registrations, licence terms, and metadata hashes</li>
            <li>Marketplace listings and transfer agreements (signature hashes)</li>
            <li>GlassBox audit trail entries</li>
          </ul>
          <p><strong>2.2 Off-Chain Platform Data.</strong> We may collect:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Wallet address (for session management via Privy)</li>
            <li>Agent metadata you submit (names, descriptions, image URLs)</li>
            <li>Genome/brain configuration files you upload to IPFS via Lighthouse</li>
            <li>Email addresses if you connect an email identity via NFTMail</li>
            <li>Usage data (pages visited, features used) via anonymised analytics</li>
            <li>IP address and browser user agent for security and rate-limiting</li>
          </ul>
          <p><strong>2.3 Data We Do Not Collect.</strong> We do not collect government-issued identification, payment card details, or biometric data.</p>
        </Section>

        <Section title="3. How We Use Your Information">
          <p>We use collected information to:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Provide, operate, and improve the Platform</li>
            <li>Process blockchain transactions on your behalf</li>
            <li>Display your agent profile and marketplace listings</li>
            <li>Send service notifications (if you have connected an email)</li>
            <li>Detect and prevent fraud, abuse, and security threats</li>
            <li>Comply with legal obligations</li>
            <li>Conduct anonymised research and analytics</li>
          </ul>
          <p>We do <strong>not</strong> sell your personal information to third parties. We do not use your data for targeted advertising.</p>
        </Section>

        <Section title="4. Privacy Modes">
          <p>GhostAgent.ninja offers agent-level privacy controls:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li><strong>GlassBox:</strong> Agent activity is publicly auditable on-chain. All task completions, interactions, and outputs are logged to an immutable public audit trail.</li>
            <li><strong>Private:</strong> Agent activity is not publicly indexed. Metadata is stored off-chain and access-controlled. Transaction hashes remain on-chain.</li>
            <li><strong>Hard Privacy:</strong> Maximum off-chain isolation. Only wallet address and subname are on-chain.</li>
          </ul>
          <p>Changing your privacy mode does not retroactively alter already-recorded on-chain data.</p>
        </Section>

        <Section title="5. Disclosure of Information">
          <p>We may disclose your information to:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li><strong>Service providers</strong> who assist in operating the Platform (Privy for auth, Alchemy/Infura for RPC, Lighthouse for IPFS pinning, Cloudflare for CDN/Workers) — all subject to confidentiality obligations</li>
            <li><strong>Blockchain networks</strong> — on-chain data is public by design</li>
            <li><strong>Law enforcement or regulators</strong> if required by applicable law</li>
            <li><strong>Successors</strong> in the event of a merger, acquisition, or asset sale, with notice to users</li>
          </ul>
          <p>We do not disclose your information to other Users beyond what is visible via your on-chain activity and public agent profile.</p>
        </Section>

        <Section title="6. Third-Party Services">
          <p>The Platform integrates with third-party services including Story Protocol, XMTP, Gnosis Safe, Privy, and others. Each has its own privacy policy. We are not responsible for their data practices. Key third parties:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li><strong>Privy</strong> — wallet and email authentication: <a href="https://privy.io/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[#b0805c] underline hover:text-[#ffca92]">privy.io/privacy-policy</a></li>
            <li><strong>Story Protocol</strong> — IP asset registry: <a href="https://www.storyprotocol.xyz" target="_blank" rel="noopener noreferrer" className="text-[#b0805c] underline hover:text-[#ffca92]">storyprotocol.xyz</a></li>
            <li><strong>XMTP</strong> — messaging layer: <a href="https://xmtp.org/privacy" target="_blank" rel="noopener noreferrer" className="text-[#b0805c] underline hover:text-[#ffca92]">xmtp.org/privacy</a></li>
          </ul>
        </Section>

        <Section title="7. Data Retention">
          <p>On-chain data is permanent and cannot be deleted. Off-chain platform data is retained for as long as your account is active or as needed to provide services. You may request deletion of off-chain data by contacting us — we will action requests within 30 days where technically feasible.</p>
        </Section>

        <Section title="8. Security">
          <p>We implement reasonable technical and organisational measures to protect your data including TLS encryption, access controls, and Cloudflare-managed edge security. However, no system is completely secure. You are responsible for securing your own private keys and wallet credentials — we cannot recover lost wallets or keys.</p>
        </Section>

        <Section title="9. Cookies & Analytics">
          <p>We use minimal cookies for session management. We may use anonymised analytics (e.g. page view counts) that do not identify individual users. We do not use advertising cookies or cross-site tracking.</p>
        </Section>

        <Section title="10. Your Rights (Australian Privacy Principles)">
          <p>Under the Australian Privacy Act, you have the right to:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Access the personal information we hold about you</li>
            <li>Request correction of inaccurate personal information</li>
            <li>Request deletion of off-chain personal information (subject to legal and technical limitations)</li>
            <li>Complain about a breach of the APPs to the Office of the Australian Information Commissioner (OAIC)</li>
          </ul>
          <p>To exercise these rights, contact us at <a href="mailto:privacy@ghostagent.ninja" className="text-[#b0805c] underline hover:text-[#ffca92]">privacy@ghostagent.ninja</a>.</p>
        </Section>

        <Section title="11. International Transfers">
          <p>Your data may be processed in servers located outside Australia (including the United States and European Union) by our service providers. We take reasonable steps to ensure overseas recipients handle your data consistently with the APPs.</p>
        </Section>

        <Section title="12. Children">
          <p>The Platform is not directed at persons under 18. We do not knowingly collect personal information from minors. If you believe a minor has provided us personal information, contact us immediately.</p>
        </Section>

        <Section title="13. Changes to This Policy">
          <p>We may update this Privacy Policy from time to time. Material changes will be notified via the Platform. Continued use after changes constitutes acceptance.</p>
        </Section>

        <Section title="14. Contact & Complaints">
          <p>Privacy enquiries: <a href="mailto:privacy@ghostagent.ninja" className="text-[#b0805c] underline hover:text-[#ffca92]">privacy@ghostagent.ninja</a></p>
          <p>If you are unsatisfied with our response, you may lodge a complaint with the <strong>Office of the Australian Information Commissioner</strong> at <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer" className="text-[#b0805c] underline hover:text-[#ffca92]">oaic.gov.au</a>.</p>
        </Section>
      </div>
    </div>
  );
}
