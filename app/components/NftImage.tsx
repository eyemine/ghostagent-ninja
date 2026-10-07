'use client';

import { useEffect, useMemo, useState } from 'react';
import { nftImageCandidates } from '../utils/nft-image-url';

interface NftImageProps {
  src: string | null | undefined;
  fallbacks?: string[];
  alt: string;
  label: string;
  className?: string;
}

/** NFT image with an ordered fallback chain and a text placeholder once every source fails. */
export function NftImage({ src, fallbacks = [], alt, label, className }: NftImageProps) {
  const candidates = useMemo(() => nftImageCandidates(src, fallbacks), [src, fallbacks.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [candidates]);

  const current = candidates[index];
  if (!current) {
    return <span className="text-[9px] font-bold uppercase tracking-widest opacity-30">{label}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={current}
      src={current}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setIndex(i => i + 1)}
    />
  );
}
