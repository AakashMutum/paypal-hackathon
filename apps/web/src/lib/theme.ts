// Theme choice: system (follow the operating system), light or dark. The choice is kept in
// localStorage; every storage call is wrapped because storage can be blocked or full.
export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_KEY = 'trustora.theme';

export function parseTheme(value: string | null | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function readTheme(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

/** Light and dark set data-theme on <html>. System removes it so prefers-color-scheme decides. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // The choice still applies for this visit; it just will not be remembered.
  }
}
