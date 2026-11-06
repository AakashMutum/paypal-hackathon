import { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { applyTheme, readTheme, saveTheme, type ThemeChoice } from '../lib/theme';
import { cn } from '../lib/format';
import { Icon } from './ui';

const OPTIONS: Array<{ value: ThemeChoice; label: string; glyph: typeof Sun }> = [
  { value: 'system', label: 'System', glyph: Monitor },
  { value: 'light', label: 'Light', glyph: Sun },
  { value: 'dark', label: 'Dark', glyph: Moon },
];

/** System, light or dark. Written as a radio group so it works with the keyboard and a screen reader. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  const pick = (value: ThemeChoice) => { setChoice(value); applyTheme(value); saveTheme(value); };
  return <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-md border border-line-strong p-0.5 bg-surface">
    {OPTIONS.map(o => <button key={o.value} type="button" role="radio" aria-checked={choice === o.value} aria-label={o.label} title={o.label} onClick={() => pick(o.value)}
      className={cn('h-8 w-7 sm:w-8 grid place-items-center rounded', choice === o.value ? 'bg-action text-action-on' : 'text-muted hover:text-content')}>
      <Icon icon={o.glyph} size={16} /></button>)}</div>;
}
