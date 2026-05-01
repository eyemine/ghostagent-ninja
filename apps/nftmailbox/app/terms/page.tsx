import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use — NFTMail.box',
  description: 'Terms of Use for NFTMail.box sovereign email identity service.',
};

const EFFECTIVE_DATE = '1 March 2026';
const CONTACT_EMAIL = 'ghostagent@nftmail.box';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto max-w-2xl px-4 py-12 md:px-6">

        <header className="mb-10 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-white transition">
            ← nftmail.box
          </Link>
          <span className="text-[10px] text-[var(--muted)] tracking-widest uppercase">Terms of Use</span>
        </header>

        <h1 className="mb-2 text-3xl font-bold text-white" style={{ fontFamily: "'Ayuthaya', serif" }}>
          Terms of Use
        </h1>
        <p className="mb-10 text-sm text-[var(--muted)]">Effective: {EFFECTIVE_DATE}</p>

        <div className="space-y-8 text-sm text-[var(--muted)] leading-relaxed">

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">1. About This Service</h2>
            <p>
              NFTMail.box (&quot;the Service&quot;) is operated by GhostAgent / Imago Labs (&quot;we&quot;, &quot;us&quot;).
              The Service provides sovereign email identities anchored to on-chain assets (ENS names, NFTs) and
              Gnosis-chain subnames. By using the Service, you agree to these Terms.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">2. Eligibility</h2>
            <p>
              You must be at least 18 years old and capable of entering a legally binding agreement.
              You must not be located in a jurisdiction where blockchain-based services are prohibited.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">3. Your Identity &amp; Ownership</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>Your <strong className="text-white">NFTMail address</strong> (e.g. <code className="text-[rgb(160,220,255)]">name@nftmail.box</code>) is tied to an on-chain asset you own.</li>
              <li>Sovereign claims (ENS / verified NFT collections) are free and do not transfer ownership of your underlying asset.</li>
              <li>Minted subnames (<code className="text-[rgb(160,220,255)]">[name].nftmail.gno</code>) are ERC-721 NFTs owned by your wallet — you hold the keys.</li>
              <li>We do not custody your private keys or control your wallet.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">4. Fees &amp; Payments</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>Free (Larva) tier: no payment required. Inbox decays after 8 days of inactivity.</li>
              <li>Paid tiers (Pupa / Imago) require an on-chain payment in xDAI or EURe to our treasury Safe.</li>
              <li>All payments are <strong className="text-white">non-refundable</strong> once verified on-chain.</li>
              <li>Tier activations are recorded on the Glass Box Audit trail and are permanent.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">5. Acceptable Use</h2>
            <p className="mb-2">You agree not to use NFTMail.box to:</p>
            <ul className="space-y-2 list-disc list-inside">
              <li>Send spam, phishing, malware, or unsolicited bulk email.</li>
              <li>Impersonate another person or entity.</li>
              <li>Circumvent or attack the Service infrastructure.</li>
              <li>Engage in money laundering, fraud, or any illegal activity.</li>
              <li>Harvest or scrape user data from the Service.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">6. Privacy &amp; Glass Box Audit</h2>
            <p>
              The Glass Box Audit trail is <strong className="text-white">public</strong> by design — it records agent actions,
              tier upgrades, and sovereign claims as a verifiable trust layer. Do not put personal information
              in fields that flow to the audit log. Email content in paid tiers is encrypted and stored in
              Cloudflare KV — only you and the Service can decrypt it with your wallet signature.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">7. Service Availability</h2>
            <p>
              We aim for high availability but do not guarantee uptime. The Service is provided &quot;as is&quot;.
              Cloudflare Workers, Gnosis chain, and third-party RPC providers are outside our control.
              We are not liable for losses arising from downtime or chain reorganisations.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">8. Intellectual Property</h2>
            <p>
              The NFTMail.box software, brand, and UI are © GhostAgent / Imago Labs. The on-chain contracts
              are open source under MIT. Your email content remains yours — we claim no rights to it.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">9. Termination</h2>
            <p>
              We may suspend or terminate access for violations of these Terms. You may terminate by ceasing
              use of the Service. On-chain assets (your NFTs, ENS names) are unaffected by termination —
              you retain full ownership of your wallet assets regardless.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">10. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, GhostAgent / Imago Labs shall not be liable for any
              indirect, incidental, special, or consequential damages arising from use of the Service,
              including loss of data, loss of funds, or loss of access to on-chain assets.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">11. Governing Law</h2>
            <p>
              These Terms are governed by the laws of Ireland. Any disputes shall be resolved in the courts
              of Dublin, Ireland, except where prohibited by local law.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">12. Changes to These Terms</h2>
            <p>
              We may update these Terms at any time. Material changes will be announced via the Glass Box
              Audit trail. Continued use after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">13. Contact</h2>
            <p>
              Questions about these Terms? Email us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-[rgb(160,220,255)] hover:underline">
                {CONTACT_EMAIL}
              </a>
            </p>
          </section>

        </div>

        <footer className="mt-16 border-t border-[var(--border)] pt-6 text-center text-[10px] text-[var(--muted)]">
          <Link href="/" className="hover:text-white transition">nftmail.box</Link>
          {' · '}
          <Link href="/terms" className="hover:text-white transition">Terms of Use</Link>
          {' · '}
          <Link href="/privacy" className="hover:text-white transition">Privacy Policy</Link>
          {' · '}
          Privacy is a Right, Sovereignty is an Upgrade
        </footer>
      </div>
    </div>
  );
}
