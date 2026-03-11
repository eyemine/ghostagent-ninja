import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-[var(--border)] py-6 text-center text-[10px] text-[var(--muted)]">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span>© {new Date().getFullYear()} GhostAgent.ninja</span>
        <span className="hidden sm:inline text-[var(--border)]">·</span>
        <Link href="/about" className="hover:text-[#b0805c] transition-colors">About</Link>
        <span className="text-[var(--border)]">·</span>
        <Link href="/terms" className="hover:text-[#b0805c] transition-colors">Terms</Link>
        <span className="text-[var(--border)]">·</span>
        <Link href="/privacy" className="hover:text-[#b0805c] transition-colors">Privacy</Link>
        <span className="text-[var(--border)]">·</span>
        <a
          href="https://x.com/ghostagent_og"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-[#b0805c] transition-colors"
        >
          𝕏 @ghostagent_og
        </a>
      </div>
    </footer>
  );
}
