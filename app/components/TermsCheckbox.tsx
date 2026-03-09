'use client';

import Link from 'next/link';

interface TermsCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  context?: 'mint' | 'marketplace' | 'molt';
}

export function TermsCheckbox({ checked, onChange, context = 'mint' }: TermsCheckboxProps) {
  const contextLabel: Record<typeof context, string> = {
    mint: 'minting an agent',
    marketplace: 'listing on the marketplace',
    molt: 'molting this agent',
  };

  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] bg-black/20 px-4 py-3 transition-colors hover:border-[#b0805c]/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#b0805c]"
      />
      <span className="text-[11px] leading-relaxed text-[var(--muted)]">
        By {contextLabel[context]} I confirm I have read and agree to the{' '}
        <Link
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#b0805c] underline hover:text-[#ffca92]"
          onClick={e => e.stopPropagation()}
        >
          Terms of Use
        </Link>{' '}
        and{' '}
        <Link
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#b0805c] underline hover:text-[#ffca92]"
          onClick={e => e.stopPropagation()}
        >
          Privacy Policy
        </Link>
        . I understand all fees are non-refundable and blockchain transactions are irreversible.
      </span>
    </label>
  );
}
