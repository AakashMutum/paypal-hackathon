import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildCommands, type Command } from '../lib/palette';
import { applyTheme, saveTheme } from '../lib/theme';
import { cn } from '../lib/format';

/** Ctrl+K, Cmd+K or "/": pages, demo stores, theme and "Check <address>". A native dialog, so Esc and focus return come free. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const items = useMemo(() => buildCommands(q), [q]);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) { setQ(''); setAt(0); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => setAt(0), [q]);

  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    if (c.kind === 'go') nav(c.to);
    else if (c.kind === 'theme') { applyTheme(c.theme); saveTheme(c.theme); }
    else nav(`/check?check=${encodeURIComponent(c.url)}`);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[at]); }
  };
  useEffect(() => { document.getElementById(`cmd-${at}`)?.scrollIntoView({ block: 'nearest' }); }, [at]);

  return <dialog ref={dialog} aria-label="Search or paste a link" onClose={onClose}
    onClick={e => { if (e.target === dialog.current) onClose(); }}
    className="palette m-0 mx-auto mt-[12vh] w-[min(560px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-content shadow-l2">
    <div onKeyDown={onKey}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-activedescendant={items.length ? `cmd-${at}` : undefined}
        aria-label="Search pages, or paste a website address" placeholder="Search pages, or paste a website address"
        className="w-full h-12 px-4 bg-transparent border-b border-line text-[15px] placeholder:text-muted outline-none" />
      <ul id="cmd-list" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-auto p-1">
        {items.length === 0 && <li className="px-3 py-6 text-sm text-muted text-center">Nothing matches. Paste a website address to check it.</li>}
        {items.map((c, i) => <li key={c.id} id={`cmd-${i}`} role="option" aria-selected={i === at} onMouseMove={() => setAt(i)} onClick={() => run(c)}
          className={cn('flex items-center justify-between gap-3 rounded px-3 py-2 text-sm cursor-pointer', i === at && 'bg-surface-2')}>
          <span className="truncate">{c.label}</span><span className="label shrink-0">{c.hint}</span></li>)}
      </ul>
      <p className="border-t border-line px-4 py-2 label">Up and down to move, Enter to choose, Esc to close</p>
    </div>
  </dialog>;
}
