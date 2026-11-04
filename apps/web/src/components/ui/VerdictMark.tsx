import type { Verdict } from '../../types';
import type { IconSize } from './Icon';

/**
 * Three original verdict marks, drawn on the same 24 x 24 grid with the same 1.5 stroke and round
 * caps as the lucide icons. They are always shown next to the word, never alone, so colour is not
 * the only signal.
 *  allow: a circle with a check, warn: a triangle with an exclamation, pause: a square with two bars.
 */
export function VerdictMark({ verdict, size = 20, label, className }: { verdict: Verdict; size?: IconSize; label?: string; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
    className={className} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} focusable="false">
    {verdict === 'ALLOW' && <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></>}
    {verdict === 'WARN' && <><path d="M12 4.5l8.2 14.2a.6.6 0 0 1-.5.9H4.3a.6.6 0 0 1-.5-.9z" /><path d="M12 10v4" /><path d="M12 16.9h.01" /></>}
    {verdict === 'PAUSE' && <><rect x="4.5" y="4.5" width="15" height="15" rx="3.5" /><path d="M10 9v6" /><path d="M14 9v6" /></>}
  </svg>;
}
