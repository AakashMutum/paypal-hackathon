import { useEffect, useRef, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { applyTheme, readTheme, saveTheme, type ThemeChoice } from '../lib/theme';
import { cn } from '../lib/format';
import { Icon } from './ui';

const OPTIONS: Array<{ value: ThemeChoice; label: string; glyph: typeof Sun }> = [
  { value: 'system', label: 'System', glyph: Monitor },
  { value: 'light', label: 'Light', glyph: Sun },
  { value: 'dark', label: 'Dark', glyph: Moon },
];

/** One icon button with a small menu: system, light or dark. The choice is read fresh each time the menu opens. */
export function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    setChoice(readTheme());
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  const pick = (value: ThemeChoice) => { setChoice(value); applyTheme(value); saveTheme(value); setOpen(false); button.current?.focus(); };
  const current = OPTIONS.find(o => o.value === choice) ?? OPTIONS[0];
  return <div ref={box} className="relative">
    <button ref={button} type="button" aria-label={`Theme: ${current.label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
      className="h-9 w-9 grid place-items-center rounded text-muted hover:text-content hover:bg-surface-2"><Icon icon={current.glyph} size={20} /></button>
    {open && <div role="menu" aria-label="Theme" className="absolute right-0 top-full mt-1 z-50 w-40 rounded-md border border-line bg-surface p-1 shadow-l2">
      {OPTIONS.map(o => <button key={o.value} role="menuitemradio" aria-checked={choice === o.value} onClick={() => pick(o.value)}
        className={cn('w-full flex items-center gap-2 rounded px-2 py-2 text-sm text-left hover:bg-surface-2', choice === o.value && 'font-semibold')}>
        <Icon icon={o.glyph} size={16} />{o.label}{choice === o.value && <span className="ml-auto text-xs text-muted">On</span>}</button>)}
    </div>}
  </div>;
}
