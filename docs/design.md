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

There is no sidebar. A sticky 52 px top bar holds the logo, the text navigation (Check, Cases, Demo
stores, Analyst; the active item has a 2 px accent underline, never a filled pill), a "Search or paste
a link" button with its shortcut, a theme menu (one icon button: System, Light, Dark) and About.
Content is up to 1280 px wide on a 12-column grid with 16 to 32 px gutters. A page header may sit on
a full-width surface-2 band (`.band`).

Below 768 px the bar keeps the logo, search and a menu button that opens a full-height sheet (a native
`<dialog>`), and a bottom tab bar has four items (Check, Cases, Stores, Analyst).

## Collapsible panels

A side panel (the decision panel on a case file, the filters on the analyst console) has a button and
the `[` key. Its state is remembered in localStorage under `trustora.panel.<name>` (every storage call
is in try/catch). With nothing remembered, a panel starts open from 1280 px and collapsed below. On a
case file the panel is always shown when the layout is stacked (below 1024 px).

## Command palette

Ctrl+K, Cmd+K or `/` opens a native `<dialog>`. It lists the pages, the three demo stores, the theme
options and, when the input looks like a web address, "Check <address>" first. Arrow keys move, Enter
chooses, Esc closes and focus returns to where it was. "Check" goes to `/?check=<address>`, which fills the
home page's field and runs the check once. The list is built by `lib/palette.ts` (tested).

## Visual rules

- Left-aligned and asymmetric. Ruled lists and tables instead of nested cards; whitespace over
  borders. No resting shadows; two elevation levels, for overlays only.
- One accent. Verdict colour appears only on the three verdict marks (and the status marks), always
  with text. No pill badges for ordinary text, no icon-in-a-circle, no gradients or glow, no uppercase
  tracking-wide micro-labels: secondary labels are 12 px, sentence case, muted.
- Radius: 8 px for controls, 12 px for panels and overlays.
- Type: Inter for the interface, headings 24 to 32 px semibold with slightly negative letter spacing,
  body 14.5 px, tabular figures for numbers. JetBrains Mono only for domains, ids and amounts.
- Domains wrap between parts (after a dot or hyphen), never inside a word where a break point exists.
- A check that did not run (no price comparison, no payee supplied, a name that could not be
  compared) reads "Not checked" with a neutral mark, never a green tick. A scan with no payee reads
  "No red flags found" and says the receiving account was not checked; the API verdict is unchanged.
  Domain age is in human units ("about 24 years") with the exact days beside it.
- Reduced motion: every animation and transition is off.

## Tokens

All tokens live in `apps/web/src/styles/tokens.css`. Tailwind reads them
(`apps/web/tailwind.config.js` has no hex values), so a theme is a set of CSS variables.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | #F7F9FC | #0A0F1C | Page |
| `--surface` | #FFFFFF | #101828 | Cards, inputs |
| `--surface-2` | #F1F5FA | #162033 | Quiet fills, hover |
| `--border` | #E3E8F0 | #1F2A44 | Dividers and card edges (decoration) |
| `--border-strong` | #75849B | #6B7F9E | Edges of controls (3:1 or more) |
| `--text` | #0A1A33 | #EAF0FA | Text |
| `--muted` | #5B6B82 | #8EA0BC | Secondary text |
| `--navy` | #003087 | #123A8F | Solid brand fill (white text) |
| `--action` | #006DDA | #4C9AFF | Links, primary buttons |
| `--action-hover` | #005AC4 | #7DB5FF | Hover |
| `--on-action` | #FFFFFF | #0A0F1C | Text on `--action` |
| `--success` / `--success-bg` | #067647 / #ECFDF3 | #32D583 / #0B2E1F | Cleared |
| `--warn` / `--warn-bg` | #B54708 / #FEF0C7 | #FDB022 / #3A2A07 | Needs review |
| `--danger` / `--danger-bg` | #B42318 / #FEE4E2 | #F97066 / #3A1512 | Held, failed |
| `--focus` | #006DDA | #4C9AFF | Focus ring |

The light `--action` started as the specified #0070E0. The contrast check found it was 4.37:1 on
`--surface-2`, below the 4.5:1 AA minimum for text, so it was darkened to #006DDA (4.57:1). Every
other starting value passed. `--border-strong` is an addition: the specified `--border` is for
decoration only, and control edges need 3:1.

Other tokens: radius 6, 10 and 14 px; spacing 4, 8, 12, 16, 24, 32 and 48 px; two shadows; type
scale 12, 14, 16, 20, 28 and 40 px; motion 120 ms and 180 ms with one easing curve.

### Contrast check

`apps/web/tests/tokens.test.ts` reads `tokens.css`, computes WCAG 2.x contrast for every text and UI
pair in both themes (4.5:1 for text, 3:1 for control edges and the focus ring) and fails on a miss.
It runs in `npm run test:web`. It also checks that the explicit dark block and the system-dark
block are identical, because plain CSS needs the dark values twice.

## Themes

- Light is the default. With no stored choice the operating system decides
  (`prefers-color-scheme`).
- A toggle in the header chooses System, Light or Dark. The choice is stored in `localStorage`
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
