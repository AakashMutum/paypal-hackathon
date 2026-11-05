// Theme choice: light (the default, whatever the system prefers), dark, or system (follow the
// operating system). The choice is kept in localStorage; every storage call is wrapped because
// storage can be blocked or full.
export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_KEY = 'trustora.theme';

/** Nothing stored, or anything unknown, means light. System is only ever an explicit choice. */
export function parseTheme(value: string | null | undefined): ThemeChoice {
  return value === 'dark' || value === 'system' ? value : 'light';
}

export function readTheme(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return 'light';
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
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // The choice still applies for this visit; it just will not be remembered.
  }
}
