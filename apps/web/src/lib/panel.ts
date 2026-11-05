// Whether a side panel is open. The choice is remembered per panel; storage can be blocked, so
// every call is wrapped. With nothing remembered, panels start open from 1280 px and collapsed below.
export const PANEL_WIDE = 1280;

export const panelKey = (name: string): string => `trustora.panel.${name}`;

export function readPanel(name: string, width: number): boolean {
  try {
    const v = localStorage.getItem(panelKey(name));
    if (v === 'open') return true;
    if (v === 'closed') return false;
  } catch {
    // Storage blocked: fall through to the width default.
  }
  return width >= PANEL_WIDE;
}

export function savePanel(name: string, open: boolean): void {
  try {
    localStorage.setItem(panelKey(name), open ? 'open' : 'closed');
  } catch {
    // Not remembered; the panel still works for this visit.
  }
}
