import type { LucideIcon } from 'lucide-react';

export type IconSize = 16 | 20 | 24;

interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  /** When the icon carries meaning on its own, give it a label. Otherwise it is hidden from screen readers. */
  label?: string;
  className?: string;
}

/** The one way to draw a lucide icon: stroke 1.5, three sizes, hidden from assistive technology unless labelled. */
export function Icon({ icon: Glyph, size = 20, label, className }: IconProps) {
  return <Glyph size={size} strokeWidth={1.5} className={className} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} />;
}
