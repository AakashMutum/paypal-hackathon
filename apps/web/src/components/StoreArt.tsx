import type { Store } from '../data/stores';

/**
 * Three original, flat illustrations drawn for the demo products: a canvas weekender bag, an
 * insulated jacket and a second canvas bag. They use only the store's own theme colours, hold no
 * brand mark and are decoration (hidden from assistive technology; the product name is in the text).
 */
export function StoreArt({ kind, accent, size = 120 }: { kind: Store['kind']; accent: string; size?: number }) {
  const stroke = { stroke: accent, strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const soft = { fill: accent, fillOpacity: 0.14 };
  return <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    {kind === 'genuine' && <g>
      {/* weekender bag: rounded body, two handles, a flap strap and a base line */}
      <path d="M22 52h76l-6 46a8 8 0 0 1-8 7H36a8 8 0 0 1-8-7z" {...soft} />
      <path d="M22 52h76l-6 46a8 8 0 0 1-8 7H36a8 8 0 0 1-8-7z" {...stroke} />
      <path d="M42 52V40a18 18 0 0 1 36 0v12" {...stroke} />
      <path d="M26 68h68" {...stroke} />
      <path d="M60 68v14" {...stroke} />
      <circle cx="60" cy="86" r="3" fill={accent} />
    </g>}
    {kind === 'suspicious' && <g>
      {/* insulated jacket: shoulders, sleeves, zip and two quilting lines */}
      <path d="M44 22l-24 12-8 46 14 4 6-26v42h56V58l6 26 14-4-8-46-24-12-10 8h-16z" {...soft} transform="translate(-6 2) scale(1.1)" />
      <path d="M44 22l-24 12-8 46 14 4 6-26v42h56V58l6 26 14-4-8-46-24-12-10 8h-16z" {...stroke} transform="translate(-6 2) scale(1.1)" />
      <path d="M60 30v66" {...stroke} />
      <path d="M38 62h20M62 62h20M38 78h20M62 78h20" {...stroke} />
    </g>}
    {kind === 'impersonator' && <g>
      {/* a tote-style bag: wide body, single arched strap, stitched pocket */}
      <path d="M26 46h68l5 54a6 6 0 0 1-6 6H27a6 6 0 0 1-6-6z" {...soft} />
      <path d="M26 46h68l5 54a6 6 0 0 1-6 6H27a6 6 0 0 1-6-6z" {...stroke} />
      <path d="M44 46c0-22 32-22 32 0" {...stroke} />
      <rect x="40" y="64" width="40" height="26" rx="5" {...stroke} strokeDasharray="4 5" />
    </g>}
  </svg>;
}
