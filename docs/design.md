# Design

TrustOra's interface is a calm, precise payments-risk console. The aim is the explanatory clarity
of a fraud dashboard, the speed and density of a good issue tracker, the calm of a banking app and
token-based light and dark themes. The palette is PayPal-adjacent (navy and a bright blue), not a
copy. There are no purple gradients, no glass effects, no emoji, no decorative blobs and no
coloured icon circles.

## Principles

1. **Say what happened, in plain words.** ALLOW, WARN and PAUSE, each with a subtitle (Cleared,
   Needs review, Held). No jargon, no claim the code does not implement.
2. **Colour is never the only signal.** A decision is a mark, a word and a colour. A payment state
   is a word as well as a tone.
3. **The merchant check and the payment are separate.** A cleared merchant next to a failed
   payment is shown as two rows.
4. **Everything works without an account.** The simulated backend keeps working; the interface
   says when something is simulated.
5. **Respect the reader.** Keyboard first, visible focus, reduced motion honoured, both themes.
6. **Independent.** The interface never imitates PayPal's logo or implies the product is made by
   PayPal. The only PayPal mark on screen is the button PayPal's own SDK renders. The footer says
   so.

## Shell

There is no sidebar. A sticky 52 px top bar holds the logo and "TrustOra", the text navigation (Check,
Cases, Demo stores, Analyst; the active item has a 2 px accent underline, never a filled pill) and, on
the right, one theme icon button with a menu (Light, Dark, System). Nothing else is in the bar. Content
is up to 1280 px wide with 16 to 32 px gutters. A page header may sit on a full-width surface-2 band
(`.band`). The footer has the GitHub link, "Fictional demo stores only", "About this demo" and the
independence line.

Below 768 px the bar keeps the logo and a menu button that opens a full-height sheet (a native
`<dialog>`); a bottom bar has Check, Cases and Stores.

The command palette (Ctrl+K, Cmd+K or `/`, a native `<dialog>`) still works but is not advertised. It lists
the pages, the three demo stores, the theme options and "Check <address>" for a pasted address.

There are no collapsible side panels and no keyboard shortcut for one. Each page has at most one
Show or Hide control (the Details section on a case and on a payment).

## Pages

- **Front page:** a left-aligned hero, three numbered steps, one example of the claimed-versus-actual
  band labelled "Example", three outcomes as a ruled list, a short agent block. No stat tiles, no live
  data, no decoration.
- **Case:** decision band, claimed versus actual, at most three reasons, one payment line, then Details
  (closed): all checks run, what could and could not be checked, how it was checked, similar past
  cases (only when there are any) and the confidence with its reason.
- **Cases:** a plain table; a row opens the case.
- **Checkout:** one centred white panel. When PayPal is not set up it shows a short gray box with a
  link, never variable names.

## Visual rules

- Left-aligned. Ruled lists and tables instead of nested cards; whitespace over borders. No resting
  shadows; two elevation levels, for overlays only.
- One accent. Verdict colour appears only on the verdict marks and the status marks, always with text.
  No pill badges for ordinary text, no icon-in-a-circle, no gradients or glow, no uppercase micro-labels.
- Shape: primary buttons are 44 px pills, secondary buttons outlined pills, inputs 44 px with a 10 px
  radius, panels 14 px with a thin border.
- Type: Inter, body 16 px, headings semibold with slightly negative tracking, tabular figures,
  JetBrains Mono only for domains, ids and amounts.
- One word per decision on screen: Allowed, Needs review, Held (ALLOW, WARN, PAUSE only in the analyst
  table, exports, the API and docs).
- A check that did not run reads "Not checked" with a neutral mark. A scan with no payee reads "No red
  flags found" and says the receiving account was not checked. Domain age is in human units.
- Light is the default whatever the system prefers; Dark and System are remembered in localStorage
  (in try/catch) and applied before first paint. Reduced motion turns every animation off.

## Tokens

All tokens live in `apps/web/src/styles/tokens.css`. Tailwind reads them
(`apps/web/tailwind.config.js` has no hex values), so a theme is a set of CSS variables.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | #F5F7FA | #0A0F1C | Page |
| `--surface` | #FFFFFF | #101828 | Cards, inputs |
| `--surface-2` | #EDF1F7 | #162033 | Quiet fills, hover |
| `--border` | #E3E8F0 | #1F2A44 | Dividers and card edges (decoration) |
| `--border-strong` | #75849B | #6B7F9E | Edges of controls (3:1 or more) |
| `--text` | #0B1B33 | #EAF0FA | Text |
| `--muted` | #4B5B73 | #8EA0BC | Secondary text |
| `--navy` | #003087 | #123A8F | Solid brand fill (white text) |
| `--brand` | #003087 | #EAF0FA | The wordmark and heading accents |
| `--action` | #0070E0 | #4C9AFF | Primary button fill, focus ring |
| `--link` | #0062C8 | #6FAEFF | Text links |
| `--action-hover` | #005AC4 | #7DB5FF | Hover |
| `--on-action` | #FFFFFF | #0A0F1C | Text on `--action` |
| `--success` / `--success-bg` | #067647 / #ECFDF3 | #32D583 / #0B2E1F | Allowed |
| `--warn` / `--warn-bg` | #B54708 / #FEF0C7 | #FDB022 / #3A2A07 | Needs review |
| `--danger` / `--danger-bg` | #B42318 / #FEE4E2 | #F97066 / #3A1512 | Held, failed |
| `--focus` | #0070E0 | #4C9AFF | Focus ring |

The specified #0070E0 is below 4.5:1 as text on the page background, so it is used only for fills and
the focus ring (3:1 is enough for those) and text links use `--link`. `--border-strong` is an addition: the
specified `--border` is for decoration only, and control edges need 3:1.

Other tokens: radius 10 px (controls) and 14 px (panels), pills for buttons; spacing 4, 8, 12, 16, 24, 32 and 48 px; two shadows; type
scale 12, 14, 16, 20, 28 and 40 px; motion 120 ms and 180 ms with one easing curve.

### Contrast check

`apps/web/tests/tokens.test.ts` reads `tokens.css`, computes WCAG 2.x contrast for every text and UI
pair in both themes (4.5:1 for text, 3:1 for control edges and the focus ring) and fails on a miss.
It runs in `npm run test:web`. It also checks that the explicit dark block and the system-dark
block are identical, because plain CSS needs the dark values twice.

## Themes

- Light is the default whatever the system prefers. Dark and System are explicit choices; System
  then follows `prefers-color-scheme`.
- The theme menu in the top bar chooses Light, Dark or System. The choice is stored in `localStorage`
  under `trustora.theme`; every storage call is wrapped in `try/catch`, so a blocked store only
  means the choice is not remembered.
- A small inline script in `index.html` sets `data-theme` before the first paint, so there is no
  flash of the wrong theme (`apps/web/src/lib/theme.ts` mirrors it).
- `prefers-reduced-motion` turns off animation and transitions everywhere.

## Typography and icons

- Inter (variable) for the interface and JetBrains Mono (variable) only for domains, ids and
  amounts, both self-hosted through `@fontsource-variable/*` (SIL Open Font License 1.1). Nothing is
  loaded from a CDN. Amounts and scores use tabular numbers.
- Icons come from `lucide-react` only, through one `Icon` component: stroke 1.5, sizes 16, 20 and
  24, hidden from assistive technology unless the icon is labelled.
- Three original verdict marks (`VerdictMark`) share the same 24 px grid and stroke: a circle with
  a check (ALLOW), a triangle with an exclamation (WARN) and a square with two bars (PAUSE). They
  always sit next to the word.

## Components

`apps/web/src/components/ui`: `Button` (primary, secondary, ghost, danger), `Card`, `Badge`,
`VerdictText` (and `VerdictBadge`, the same thing under its older name), `StatusMark`, `Stat`, `Field`, `Skeleton`, `EmptyState`, `Disclosure` (no tooltips: everything is
reachable by keyboard), `Stepper`, `Toast`, plus `Modal`, `Switch`, `Icon` and `VerdictMark`. The
older `btn-*`, `card`, `pill` and `input` classes are defined on the same tokens, so screens that
have not been moved to the components yet follow the theme too.

The analyst table (AG Grid Community) is themed through AG Grid's theming API in
`apps/web/src/lib/gridTheme.ts` with CSS variables from the same tokens, so it follows light and
dark. Sorting, filters, the risk slider and CSV export are unchanged.

## What was not verified

The token contrast is computed, not eyeballed. Whether the screens look right in a browser is a
separate check; see `docs/deploy.md` and the README for what was and was not done.
