/**
 * String similarity for names.
 *
 * Jaro-Winkler handles transpositions and typos; token overlap handles reordered
 * words. The pair score is the better of the two, and the matcher then caps the
 * model's answer by this number so the model can be stricter but never more
 * generous than the strings allow (invariant I9).
 */

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const low = Math.max(0, i - matchDistance);
    const high = Math.min(b.length - 1, i + matchDistance);
    for (let j = low; j <= high; j += 1) {
      if (!bMatched[j] && a[i] === b[j]) {
        aMatched[i] = true;
        bMatched[j] = true;
        matches += 1;
        break;
      }
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatched[i]) continue;
    while (k < b.length && !bMatched[k]) k += 1;
    if (k >= b.length) break;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }

  return (
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3
  );
}

export function jaroWinkler(a: string, b: string): number {
  const score = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  return score + prefix * 0.1 * (1 - score);
}

/** Conservative: divides by the larger token set, so "acme" vs "acme outlets" is 0.5. */
export function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.max(left.size, right.size);
}

export function similarity(a: string, b: string): number {
  return Math.max(jaroWinkler(a, b), tokenOverlap(a, b));
}

/**
 * Similarity with one correction for very short names.
 *
 * Jaro-Winkler inflates short strings: "hul" and "hindustan unilever" score
 * about 0.59 purely by chance character matches. A four-character-or-shorter
 * name that is not one of the longer name's words is therefore capped below the
 * matcher's first guard band. The correction only ever lowers the number, so it
 * cannot make a pair look safer than the raw math.
 */
export function effectiveSimilarity(a: string, b: string): number {
  const base = similarity(a, b);
  const shortSide = a.length <= b.length ? a : b;
  const longSide = a.length <= b.length ? b : a;

  const shortCompact = shortSide.replace(/\s+/g, '');
  const longCompact = longSide.replace(/\s+/g, '');

  if (shortCompact.length > 0 && shortCompact.length <= 4 && longCompact.length >= 12) {
    const longTokens = new Set(longSide.split(' ').filter(Boolean));
    const parts = shortSide.split(' ').filter(Boolean);
    const isWordOfLongSide = parts.length > 0 && parts.every((part) => longTokens.has(part));
    if (!isWordOfLongSide) return Math.min(base, 0.39);
  }

  return base;
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
