import { themeQuartz } from 'ag-grid-community';

/**
 * The analyst table, themed through AG Grid's theming API with the same tokens as the rest of the
 * app. Every value is a CSS variable, so light and dark follow the page without a second theme.
 */
export const gridTheme = themeQuartz.withParams({
  browserColorScheme: 'inherit',
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--text)',
  borderColor: 'var(--border)',
  headerBackgroundColor: 'var(--surface-2)',
  headerTextColor: 'var(--text)',
  oddRowBackgroundColor: 'var(--surface)',
  rowHoverColor: 'var(--surface-2)',
  selectedRowBackgroundColor: 'color-mix(in srgb, var(--action) 14%, var(--surface))',
  accentColor: 'var(--action)',
  inputBorder: { color: 'var(--border-strong)' },
  fontFamily: 'inherit',
  fontSize: 14,
  borderRadius: 6,
  wrapperBorderRadius: 10,
});
