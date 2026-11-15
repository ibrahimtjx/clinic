/**
 * Mirrors the database's clinic_normalize() so on-screen highlighting matches what the search
 * matched: Arabic diacritics and tatweel removed, alef forms unified, ة→ه, ى→ي, Arabic-Indic digits → 0-9,
 * lower case.
 */
const MAP: Record<string, string> = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ة: 'ه',
  ى: 'ي',
};
const DROP = /[ً-ٰٟـ]/;
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function normChar(c: string): string {
  if (DROP.test(c)) return '';
  if (MAP[c]) return MAP[c];
  const d = AR_DIGITS.indexOf(c) >= 0 ? AR_DIGITS.indexOf(c) : FA_DIGITS.indexOf(c);
  if (d >= 0) return String(d);
  return c.toLowerCase();
}

export function normalize(s: string): string {
  return [...s].map(normChar).join('');
}

/**
 * Ranges [start, end) in the ORIGINAL string covering every occurrence of each search word,
 * matched on normalized text.
 */
export function matchRanges(text: string, query: string): [number, number][] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length || !text) return [];
  // Build the normalized string with a map from each normalized char back to its original index.
  let norm = '';
  const back: number[] = [];
  [...text].forEach((c, i) => {
    const n = normChar(c);
    for (const ch of n) {
      norm += ch;
      back.push(i);
    }
  });
  const chars = [...text];
  const ranges: [number, number][] = [];
  for (const w of words) {
    let from = 0;
    for (;;) {
      const at = norm.indexOf(w, from);
      if (at < 0) break;
      const start = back[at];
      let end = back[at + w.length - 1] + 1;
      while (end < chars.length && normChar(chars[end]) === '') end++; // keep trailing diacritics
      ranges.push([start, end]);
      from = at + w.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  // Convert code-point indices to string indices.
  const offsets: number[] = [];
  let pos = 0;
  for (const c of chars) {
    offsets.push(pos);
    pos += c.length;
  }
  offsets.push(pos);
  return merged.map(([a, b]) => [offsets[a], offsets[b]]);
}
