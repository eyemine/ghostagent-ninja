import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — NFTMail.box',
  description: 'Privacy Policy for NFTMail.box sovereign email identity service.',
};

const EFFECTIVE_DATE = '1 March 2026';
const CONTACT_EMAIL = 'ghostagent@nftmail.box';
const TWITTER_HANDLE = '@GhostAgent_OG';
const TWITTER_URL = 'https://x.com/GhostAgent_OG';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto max-w-2xl px-4 py-12 md:px-6">

        <header className="mb-10 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-white transition">
            ← nftmail.box
          </Link>
          <span className="text-[10px] text-[var(--muted)] tracking-widest uppercase">Privacy Policy</span>
        </header>

        <h1 className="mb-2 text-3xl font-bold text-white" style={{ fontFamily: "'Ayuthaya', serif" }}>
          Privacy Policy
        </h1>
        <p className="mb-10 text-sm text-[var(--muted)]">Effective: {EFFECTIVE_DATE}</p>

        <div className="space-y-8 text-sm text-[var(--muted)] leading-relaxed">

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">1. Who We Are</h2>
            <p>
              NFTMail.box is operated by GhostAgent / Imago Labs (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;).
              We provide sovereign email identities anchored to on-chain assets on the Gnosis network.
              Contact us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-[rgb(160,220,255)] hover:underline">{CONTACT_EMAIL}</a>
              {' '}or on X at{' '}
              <a href={TWITTER_URL} target="_blank" rel="noopener noreferrer" className="text-[rgb(160,220,255)] hover:underline">{TWITTER_HANDLE}</a>.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">2. What Data We Collect</h2>
            <ul className="space-y-3 list-disc list-inside">
              <li>
                <strong className="text-white">Wallet address</strong> — provided when you connect your wallet. Used to identify your NFTMail inbox and verify on-chain ownership. Not linked to your real-world identity by us.
              </li>
              <li>
                <strong className="text-white">Email content</strong> — inbound emails are stored in Cloudflare KV. In paid tiers, content is encrypted with your wallet signature — only you can decrypt it. In the free (Larva) tier, content is stored in cleartext and decays after 8 days.
              </li>
              <li>
                <strong className="text-white">NFT and ENS data</strong> — when you connect your wallet, we query public blockchain data (ENS names, NFT ownership) to determine eligibility for sovereign claims. This data is already public on-chain.
              </li>
              <li>
                <strong className="text-white">Payment transactions</strong> — on-chain payment hashes used to verify tier upgrades are recorded in our Glass Box Audit trail. No card numbers or bank details are stored by us.
              </li>
              <li>
                <strong className="text-white">Terms agreement</strong> — a SHA-256 hash of your wallet address, terms version, and timestamp is logged to the Glass Box Audit when you mint. This is non-personal and non-reversible.
              </li>
              <li>
                <strong className="text-white">Agent activity logs</strong> — GhostAgent actions (posts, replies, payment approvals) are logged to the public Glass Box Audit trail by design. Do not include personal information in agent commands.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">3. What We Do Not Collect</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>We do not collect your name, address, phone number, or government ID.</li>
              <li>We do not use advertising trackers or third-party analytics pixels.</li>
              <li>We do not sell, rent, or share your data with third parties for marketing.</li>
              <li>We do not store your private keys — ever.</li>
              <li>We do not read your encrypted email content — only you can decrypt it with your wallet.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">4. How We Use Your Data</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>To provision and manage your NFTMail inbox.</li>
              <li>To verify on-chain payments and activate tier upgrades.</li>
              <li>To maintain the Glass Box Audit trail — a public, verifiable trust record.</li>
              <li>To deliver inbound email to your inbox.</li>
              <li>To respond to support requests sent to <a href={`mailto:${CONTACT_EMAIL}`} className="text-[rgb(160,220,255)] hover:underline">{CONTACT_EMAIL}</a>.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">5. The Glass Box Audit Trail</h2>
            <p>
              By design, GhostAgent operates a <strong className="text-white">public audit trail</strong> at{' '}
              <a href="https://ghostagent-proxy.richard-159.workers.dev/audit" target="_blank" rel="noopener noreferrer" className="text-[rgb(160,220,255)] hover:underline">ghostagent-proxy.richard-159.workers.dev/audit</a>.
              This log records agent actions, tier upgrades, sovereign claims, and payment approvals.
              It is intentionally public — it is the trust layer of the system.
              Do not submit personal information in any field that flows to this log.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">6. Data Storage &amp; Security</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>Email content and inbox metadata are stored in <strong className="text-white">Cloudflare KV</strong> (EU region where possible).</li>
              <li>Paid-tier content is encrypted client-side with your wallet signature before storage.</li>
              <li>We use HTTPS for all data in transit.</li>
              <li>We do not operate our own database servers — infrastructure is Cloudflare Workers + KV.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">7. Third-Party Services</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li><strong className="text-white">Privy</strong> — wallet connection and embedded wallet provider. See <a href="https://privy.io/privacy" target="_blank" rel="noopener noreferrer" className="text-[rgb(160,220,255)] hover:underline">privy.io/privacy</a>.</li>
              <li><strong className="text-white">Cloudflare</strong> — infrastructure, KV storage, Workers. See <a href="https://cloudflare.com/privacypolicy" target="_blank" rel="noopener noreferrer" className="text-[rgb(160,220,255)] hover:underline">cloudflare.com/privacypolicy</a>.</li>
              <li><strong className="text-white">Gnosis Chain</strong> — all on-chain actions are public and permanent by nature of the blockchain.</li>
              <li><strong className="text-white">Zoho Mail</strong> — used for SMTP relay of inbound emails. See <a href="https://zoho.com/privacy.html" target="_blank" rel="noopener noreferrer" className="text-[rgb(160,220,255)] hover:underline">zoho.com/privacy.html</a>.</li>
              <li><strong className="text-white">MoonPay</strong> (optional, for fiat on-ramp) — if you use card payment, MoonPay processes your payment. See <a href="https://moonpay.com/privacy_policy" target="_blank" rel="noopener noreferrer" className="text-[rgb(160,220,255)] hover:underline">moonpay.com/privacy_policy</a>.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">8. Your Rights</h2>
            <p className="mb-2">Under GDPR and applicable law, you have the right to:</p>
            <ul className="space-y-2 list-disc list-inside">
              <li><strong className="text-white">Access</strong> — request a copy of data we hold about your wallet address.</li>
              <li><strong className="text-white">Erasure</strong> — request deletion of your inbox and associated KV data. Note: on-chain data (NFTs, Glass Box Audit entries) cannot be deleted as they are permanent blockchain records.</li>
              <li><strong className="text-white">Portability</strong> — export your inbox data at any time via the dashboard.</li>
              <li><strong className="text-white">Objection</strong> — object to processing by ceasing use of the Service and requesting inbox deletion.</li>
            </ul>
            <p className="mt-3">
              To exercise any right, email{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-[rgb(160,220,255)] hover:underline">{CONTACT_EMAIL}</a>.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">9. Cookies &amp; Tracking</h2>
            <p>
              We use only essential session cookies required for wallet authentication via Privy.
              We do not use advertising cookies, tracking pixels, or fingerprinting.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">10. Children</h2>
            <p>
              The Service is not directed at children under 18. We do not knowingly collect data from minors.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">11. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy. Material changes will be announced via the Glass Box Audit trail
              and on X at{' '}
              <a href={TWITTER_URL} target="_blank" rel="noopener noreferrer" className="text-[rgb(160,220,255)] hover:underline">{TWITTER_HANDLE}</a>.
              Continued use after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">12. Contact</h2>
            <p>
              Privacy questions or data requests:{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-[rgb(160,220,255)] hover:underline">{CONTACT_EMAIL}</a>
              <br />
              X/Twitter:{' '}
              <a href={TWITTER_URL} target="_blank" rel="noopener noreferrer" className="text-[rgb(160,220,255)] hover:underline">{TWITTER_HANDLE}</a>
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
