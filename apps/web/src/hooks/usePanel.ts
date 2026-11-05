import { useCallback, useEffect, useState } from 'react';
import { readPanel, savePanel } from '../lib/panel';

/** A collapsible panel: remembered per name, collapsed below 1280 px at first, toggled with "[". */
export function usePanel(name: string): { open: boolean; toggle: () => void } {
  const [open, setOpen] = useState(() => readPanel(name, typeof window === 'undefined' ? 1280 : window.innerWidth));
  const toggle = useCallback(() => setOpen((o) => { savePanel(name, !o); return !o; }), [name]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  return { open, toggle };
}
