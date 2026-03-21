import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ENS Prize Submission — GhostAgent.ninja',
  description:
    'GhostAgent.ninja ENS Prize Submission for Synthesis Hackathon 2026. ' +
    'Trustless AI agent identity on Gnosis Chain using .gno subnames and Gnosis Safes. ' +
    'ENS support for .gno.eth CCIP-Read resolution would make AI agent Safes human-readable in every ENS-aware tool.',
};

export default function EnsPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">

        <div className="mb-8 flex items-center gap-3">
          <span className="text-xs font-mono bg-green-900/40 border border-green-700 text-green-400 px-3 py-1 rounded-full">
            ENS Prize Submission
          </span>
          <span className="text-xs text-gray-500">Synthesis Hackathon · March 2026</span>
        </div>

        <h1 className="text-3xl font-bold mb-2">ENS Prize Submission</h1>
        <p className="text-xl text-gray-400 mb-12">GhostAgent.ninja</p>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4 text-red-400">The Problem: Agent SAFEs Have No Human-Readable Names</h2>
          <p className="text-gray-300 mb-4">
            When an AI agent controls a Gnosis Safe, that Safe has an address like{' '}
            <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">0xb7e493e3d226f8fE722CC9916fF164B793af13F4</code>.
            There is no human-readable name. No ENS name resolves to it. No reverse lookup works.
          </p>
          <p className="text-gray-300 mb-4">
            This breaks A2A (agent-to-agent) trust. When{' '}
            <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">ghostagent</code> instructs{' '}
            <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">victor</code> to execute a
            transaction, <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">victor</code> cannot
            verify that the instruction came from the canonical{' '}
            <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">ghostagent.molt.gno</code>{' '}
            controller — it can only see a raw address.
          </p>
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
            <p className="text-gray-400 text-sm">
              <strong className="text-white">The gap:</strong> ENS is the identity layer for humans on Ethereum. It is
              not yet the identity layer for AI agents operating through Gnosis Safes on Gnosis Chain.
            </p>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4 text-white">What We Built</h2>
          <p className="text-gray-300 mb-6">
            <strong className="text-white">GhostAgent.ninja</strong> implements ERC-8004 — a trustless agent identity
            protocol — where each agent&apos;s canonical identity is a{' '}
            <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">.gno</code> subname (e.g.{' '}
            <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">ghostagent.molt.gno</code>) that
            resolves to a Gnosis Safe.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-gray-800 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-900">
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Layer</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">What it does</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                <tr>
                  <td className="px-4 py-3 font-mono text-green-400 text-sm">.gno subname</td>
                  <td className="px-4 py-3 text-gray-300">Human-readable agent identity on Gnosis Chain</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-green-400 text-sm">Gnosis Safe</td>
                  <td className="px-4 py-3 text-gray-300">Multi-sig treasury + module execution environment</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-green-400 text-sm">ERC-6551 TBA</td>
                  <td className="px-4 py-3 text-gray-300">Token-Bound Account for agent&apos;s NFT origin</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-gray-400 text-sm mt-4">
            The <strong className="text-white">molt</strong> mechanism lets an agent owner attach a{' '}
            <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">.gno</code> name to their
            agent&apos;s Safe — making the Safe addressable by name for the first time.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4 text-white">
            The ENS Angle: <code className="text-green-400">.gno.eth</code> Bridging
          </h2>
          <p className="text-gray-300 mb-4">Gnosis Name Service (<code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">.gno</code>) is an ENS fork operating on Gnosis Chain. Today:</p>
          <ul className="space-y-2 mb-6 text-gray-300">
            <li className="flex items-start gap-2"><span className="text-red-400 mt-1">×</span><span><code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">.gno</code> names do not resolve via the ENS public resolver on mainnet</span></li>
            <li className="flex items-start gap-2"><span className="text-red-400 mt-1">×</span><span>Gnosis Chain has no ENS subgraph coverage</span></li>
            <li className="flex items-start gap-2"><span className="text-red-400 mt-1">×</span><span>Agent Safes are invisible to any ENS-aware tooling</span></li>
          </ul>
          <div className="bg-green-950/30 border border-green-800 rounded-lg p-5">
            <p className="text-green-300 font-medium mb-2">Our ask of ENS DAO:</p>
            <p className="text-gray-300">
              Fund or formally support <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">.gno.eth</code> wrapper
              resolution so that <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">ghostagent.molt.gno</code> resolves
              across ENS-compatible tooling — giving AI agent Safes human-readable names without requiring the
              agent&apos;s human owner to point their personal <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">.eth</code> name at the Safe.
            </p>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
              <p className="text-gray-400 mb-1">Owner identity (must not be hijacked)</p>
              <code className="text-yellow-400">ghostagent.eth → 0xf251Ca...1249</code>
            </div>
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
              <p className="text-gray-400 mb-1">Agent operational identity</p>
              <code className="text-green-400">ghostagent.molt.gno → 0xb7e4...13F4</code>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4 text-white">Why This Matters for AI Safety</h2>
          <div className="bg-red-950/20 border border-red-900 rounded-lg p-5 mb-6">
            <p className="text-white font-semibold text-lg mb-2">Human-in-the-loop requires human-readable names.</p>
            <p className="text-gray-300">
              If a human operator reviews a pending transaction from{' '}
              <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 text-sm">ghostagent.molt.gno → victor.openclaw.gno</code>,
              they can make an informed decision. If they review{' '}
              <code className="bg-gray-900 px-1.5 py-0.5 rounded text-gray-400 text-sm">0xb7e4...13F4 → 0x316a...5E70</code>, they cannot.
            </p>
          </div>
          <p className="text-gray-400">
            ENS resolution for agent Safes is not a UX nicety. It is a safety primitive.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4 text-white">ENS-Specific Feature Request</h2>
          <div className="space-y-4">
            {[
              {
                n: '1',
                title: '.gno.eth L2 resolver',
                desc: 'A Gnosis Chain resolver registered under gno.eth that lets .gno subnames (e.g. ghostagent.molt.gno) resolve via standard ENS lookups using CCIP-Read (EIP-3668).',
              },
              {
                n: '2',
                title: 'Reverse resolution for Gnosis Safes',
                desc: 'So that 0xb7e4...13F4 reverse-resolves to ghostagent.molt.gno in ENS tooling (Etherscan, Safe UI, wallets).',
              },
              {
                n: '3',
                title: 'Safe-aware ENS profile standard',
                desc: "A convention where a Safe's ENS name is the agent's .gno subname, not the owner's .eth name, preserving sovereign identity separation.",
              },
            ].map(({ n, title, desc }) => (
              <div key={n} className="flex gap-4 bg-gray-900 border border-gray-700 rounded-lg p-4">
                <span className="text-green-400 font-mono font-bold text-lg shrink-0">{n}.</span>
                <div>
                  <p className="font-medium text-white mb-1">{title}</p>
                  <p className="text-gray-400 text-sm">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4 text-white">Current Implementation</h2>
          <table className="w-full text-sm border border-gray-800 rounded-lg overflow-hidden">
            <tbody className="divide-y divide-gray-800">
              {[
                ['ghostagent.molt.gno → Safe 0xb7e4...13F4', '✅ Live on Gnosis mainnet'],
                ['ERC-8004 agent registry', '✅ Live — agentId 3199 (Gnosis), 32756 (Base)'],
                ['ghostagent_@nftmail.box inbox', '✅ Live — ECIES encrypted'],
                ['notapaperclip.red swarm verifier', '✅ Live — checks ERC-8004 identity'],
                ['.gno.eth CCIP-Read resolver', '❌ Needs ENS DAO support'],
                ['Reverse resolution for Gnosis Safes', '❌ Needs ENS DAO support'],
              ].map(([component, status]) => (
                <tr key={component} className="bg-gray-900/50">
                  <td className="px-4 py-3 font-mono text-gray-300 text-xs">{component}</td>
                  <td className={`px-4 py-3 text-sm font-medium ${status.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>{status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-6 text-white">One-Line Pitch</h2>
          <blockquote className="border-l-4 border-green-500 pl-6 py-2">
            <p className="text-lg text-gray-200 italic">
              We built trustless AI agent identity on Gnosis Chain using{' '}
              <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 not-italic">.gno</code> subnames and Gnosis
              Safes. ENS support for{' '}
              <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400 not-italic">.gno.eth</code> CCIP-Read
              resolution would make AI agent Safes human-readable in every ENS-aware tool — turning agent addresses into
              names, and names into accountable actors.
            </p>
          </blockquote>
        </section>

        <section className="border-t border-gray-800 pt-8">
          <h2 className="text-lg font-semibold mb-4 text-gray-400">Links</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {[
              ['Swarm Verifier', 'https://notapaperclip.red'],
              ['Agent Identity Hub', 'https://ghostagent.ninja'],
              ['NFTmail Inbox', 'https://nftmail.box'],
              ['GitHub Repository', 'https://github.com/eyemine/ghostagent-ninja'],
              ['ENS-PRIZE.md (raw)', 'https://github.com/eyemine/ghostagent-ninja/blob/main/ENS-PRIZE.md'],
              ['Twitter', 'https://x.com/ghostagent_og'],
            ].map(([label, url]) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-gray-900 border border-gray-700 hover:border-green-700 rounded-lg px-4 py-3 text-gray-300 hover:text-green-400 transition-colors"
              >
                <span className="text-green-500">→</span> {label}
              </a>
            ))}
          </div>
        </section>

      </div>
    </main>
  );
}
