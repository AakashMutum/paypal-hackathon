/* global document, getComputedStyle, NodeFilter, localStorage, window */
// Visual and accessibility QA for the web app, run against a built copy using the built-in
// simulated backend (no API, no accounts).
//
//   npm run build -w @checkout-guardian/web
//   npm run preview -w @checkout-guardian/web -- --host 127.0.0.1 --port 4173      (second terminal)
//   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm run qa:screens
//
// It uses playwright-core, which the repository already depends on, and a browser that is already
// installed (Chrome or Edge). Nothing is added to the repository. For each theme (light, dark) and
// width (360, 768, 1280) it opens every screen, saves a screenshot to .cache/screenshots and checks:
// horizontal overflow, clipped text, text contrast against the real background, controls without
// an accessible name, heading order, and a visible focus indicator while tabbing.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/+$/, '');
const OUT = new URL('../.cache/screenshots/', import.meta.url);
const WIDTHS = (process.env.WIDTHS ?? '360,768,1280').split(',').map(Number);
const THEMES = (process.env.THEMES ?? 'light,dark').split(',');
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to a browser executable.');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

/** Runs inside the page. Returns a list of findings for the current screen. */
function audit() {
  const findings = [];
  const add = (kind, detail) => findings.push({ kind, detail: String(detail).slice(0, 160) });
  const vw = document.documentElement.clientWidth;

  if (document.documentElement.scrollWidth > vw + 1) add('overflow', `page is ${document.documentElement.scrollWidth}px wide in a ${vw}px viewport`);
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.right > vw + 1 && !el.closest('[data-scroll], .overflow-x-auto, .ag-root-wrapper')) add('overflow-element', `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ends at ${Math.round(r.right)}px`);
    const clipsX = !el.closest('.sr-only, [class*="focus:not-sr-only"]') && ['hidden', 'clip'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && el.textContent.trim();
    if (clipsX && !el.closest('.ag-root-wrapper')) add('clipped-text', `${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}"`);
  }

  const parse = (value) => {
    const m = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(value);
    if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
    const n = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\)/.exec(value);
    return n ? [Number(n[1]), Number(n[2]), Number(n[3]), n[4] === undefined ? 1 : Number(n[4])] : null;
  };
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a);
  };
  const background = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; }
    }
    let base = [255, 255, 255, 1];
    for (const layer of layers.reverse()) base = over(layer, base);
    return base;
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    const el = node.parentElement;
    if (!text || !el || seen.has(el) || el.closest('svg, script, style, .ag-root-wrapper, [aria-hidden="true"]')) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = background(el);
    const flat = over(fg, bg);
    const [hi, lo] = [lum(flat), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5) - 0.01) add('contrast', `${ratio.toFixed(2)}:1 "${text.slice(0, 36)}" (${size}px)`);
  }

  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || el.labels?.[0]?.textContent || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="radio"]')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
    if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
    const ariaName = el.getAttribute('aria-label') || (el.labels && el.labels.length ? el.labels[0].textContent : '') || el.querySelector('img[alt]:not([alt=""])')?.getAttribute('alt') || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? '' : el.textContent) || el.getAttribute('title') || '';
    if (!ariaName.trim()) add('no-name', `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} ${String(el.className).slice(0, 40)}`);
  }
  void name;

  const levels = [...document.querySelectorAll('h1, h2, h3, h4')].filter((h) => getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().height > 0).map((h) => Number(h.tagName[1]));
  const h1s = levels.filter((l) => l === 1).length;
  if (h1s !== 1) add('heading', `${h1s} h1 elements`);
  for (let i = 1; i < levels.length; i += 1) if (levels[i] - levels[i - 1] > 1) add('heading', `h${levels[i - 1]} is followed by h${levels[i]}`);
  for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) add('image-alt', img.src.slice(-40));
  if (!document.title || document.title === 'TrustOra') add('title', 'the page has no specific title');
  return findings;
}

/** Tabs through the page and reports controls that show no focus indicator. */
async function focusAudit(page) {
  const problems = [];
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const gridCell = el.closest('.ag-root-wrapper') && (parseFloat(cs.borderTopWidth) > 0 || el.classList.contains('ag-cell-focus') || el.closest('.ag-cell-focus'));
      const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' || gridCell;
      return { visible, label: `${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}`, sr: el.className.toString().includes('sr-only') };
    });
    if (!state) break;
    if (!state.visible && !state.sr) problems.push({ kind: 'focus', detail: `no visible focus on ${state.label}` });
  }
  return problems;
}

async function seed(page) {
  // Create three orders through the real UI so the payment screens have data.
  const ids = {};
  for (const store of ['harborline-outfitters', 'bargainbarn-outlet', 'harborlyne-outfitters-sale']) {
    await page.goto(`${BASE}/checkout/${store}`, { waitUntil: 'networkidle' });
    await page.fill('#em', 'qa.buyer@mail.example');
    await page.click('text=Simulated payment');
    await page.waitForURL(/\/engine\/INV-/);
    ids[store] = page.url().split('/engine/')[1];
  }
  await page.waitForTimeout(4500); // the simulated backend finishes its checks after about four seconds
  return ids;
}

const browser = await chromium.launch({ executablePath, headless: true });
const report = [];
let total = 0;
for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    await context.addInitScript((t) => { try { localStorage.setItem('trustora.theme', t); } catch { /* ignore */ } }, theme);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const ids = await seed(page);
    const inv = ids['harborlyne-outfitters-sale'];
    const screens = [
      ['overview', '/'], ['scan', '/scanner'], ['investigations', '/investigations'], ['investigation', `/investigations/${inv}`],
      ['check', `/engine/${inv}`], ['payment', `/pay/${inv}`], ['payment-allow', `/pay/${ids['harborline-outfitters']}`], ['payment-warn', `/pay/${ids['bargainbarn-outlet']}`],
      ['stores', '/stores'], ['storefront', '/store/harborline-outfitters'], ['checkout', '/checkout/bargainbarn-outlet'],
      ['analyst', '/analyst'], ['onboarding', '/onboarding'], ['profile', '/profile'],
    ];
    for (const [name, path] of screens) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      const findings = [...(await page.evaluate(audit)), ...(await focusAudit(page))];
      await page.screenshot({ path: new URL(`${theme}-${width}-${name}.png`, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
      report.push({ theme, width, screen: name, findings });
      total += findings.length;
    }
    // The scan result, after a scan.
    await page.goto(`${BASE}/scanner`, { waitUntil: 'networkidle' });
    await page.click('text=harborlyne-outfitters-sale.example');
    await page.waitForSelector('[aria-label="The four checks"]', { timeout: 15000 });
    await page.waitForTimeout(1200);
    const scanFindings = await page.evaluate(audit);
    await page.screenshot({ path: new URL(`${theme}-${width}-scan-result.png`, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
    report.push({ theme, width, screen: 'scan-result', findings: scanFindings });
    total += scanFindings.length;
    if (errors.length) report.push({ theme, width, screen: 'console', findings: errors.slice(0, 5).map((e) => ({ kind: 'console-error', detail: e })) });
    await context.close();
  }
}
await browser.close();

writeFileSync(new URL('report.json', OUT), JSON.stringify(report, null, 2));
const grouped = new Map();
for (const r of report) for (const f of r.findings) {
  const key = `${f.kind}: ${f.detail}`;
  const entry = grouped.get(key) ?? { n: 0, where: new Set() };
  entry.n += 1; entry.where.add(`${r.theme}/${r.width}/${r.screen}`);
  grouped.set(key, entry);
}
console.log(`Screens checked: ${report.length}. Findings: ${total} (${grouped.size} distinct).`);
for (const [key, v] of [...grouped].sort((a, b) => b[1].n - a[1].n).slice(0, 60)) console.log(`${String(v.n).padStart(3)}x ${key}   [${[...v.where].slice(0, 3).join(', ')}${v.where.size > 3 ? ', …' : ''}]`);
process.exit(total > 0 ? 1 : 0);
