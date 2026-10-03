// ============================================================
// Mise — one search for the whole app (Kong, 2026-10-03)
// ============================================================
// Typing never REMOVES anything. Every item stays in the list; the ones closest
// to what was typed rise to the top and the rest keep their original order
// below them. A shop with a hundred dishes finds one in a keystroke, and a typo
// never makes the dish it meant disappear.
//
// How close is a score, highest wins (see the table in the mockup Kong approved,
// and tests/smart-search.test.ts, which pins every row of it):
//
//   100  the whole name                       โค้ก → โค้ก
//    90  the name starts with it              กะเพรา → กะเพราหมูสับไข่ดาว
//  70–80 the name contains it (earlier = more) หมูสับ → ข้าวไข่เจียวหมูสับ
//  60–68 contains it ignoring tone marks      ไก → ไก่ผัดเม็ดมะม่วง
//    85  the whole code                       A02 → A02
//    80  the code's NUMBER (no leading zeros) 22 → P-0022, 2 → A02
//    75  the code starts with it              A0 → A01, A02 …
//  50–60 the code contains it                 02 → A02
//  30–50 its letters in order, close together ขผม → ข้าวผัดหมู   (3+ letters)
//  20–45 spelled nearly the same              กระเพรา → กะเพรา   (bigram Dice > 0.6)
//  20–35 the category                         ทะเล → กุ้งขาว
//     0  no match — stays, below the line, in its original order
//
// Ties keep the caller's order (best seller first, or ก–ฮ), so a list does not
// shuffle while someone types. Thai has no spaces between words, so matching is
// by letters and letter pairs, never by word; spaces, dashes and English case
// are ignored ("เบียร์ สิงห์" finds เบียร์สิงห์).
//
// Pure and dependency-free: it runs in the browser on every keystroke.
// ============================================================

export type SearchFieldKind = "name" | "code" | "category";

export type SearchField<T> = {
  get: (item: T) => string | null | undefined;
  kind: SearchFieldKind;
};

export type MatchReason =
  | "ตรงทั้งชื่อ"
  | "ขึ้นต้นด้วย"
  | "มีคำนี้"
  | "ไม่นับวรรณยุกต์"
  | "ตรงรหัส"
  | "ตรงเลขรหัส"
  | "รหัสขึ้นต้นด้วย"
  | "มีในรหัส"
  | "ตัวอักษรเรียงตามลำดับ"
  | "สะกดใกล้เคียง"
  | "ตรงหมวด";

export type TextMatch = {
  score: number;
  why: MatchReason | null;
  /** Indexes into the ORIGINAL text to highlight. */
  marks: number[];
};

export type Ranked<T> = TextMatch & {
  item: T;
  /** Position in the caller's list — the tiebreak. */
  index: number;
  /** Which field matched best (index into `fields`), or null. */
  field: number | null;
};

/** At or above this a result is "a match"; below it sits under the divider. */
export const STRONG_MATCH = 20;

const NO_MATCH: TextMatch = { score: 0, why: null, marks: [] };
const TONE_MARKS = /[่-์]/; // ่ ้ ๊ ๋ ์
const IGNORED = /[\s\-_.()/]/;

/**
 * The text as compared, plus where each compared character came from — so a
 * match found in "เบียร์สิงห์" can be highlighted in "เบียร์ สิงห์ 620 มล.".
 */
function fold(text: string, dropTones: boolean): { s: string; at: number[] } {
  const src = text.normalize("NFC");
  let s = "";
  const at: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (IGNORED.test(ch)) continue;
    if (dropTones && TONE_MARKS.test(ch)) continue;
    s += ch.toLowerCase();
    at.push(i);
  }
  return { s, at };
}

const span = (at: number[], from: number, len: number) => at.slice(from, from + len);

function bigrams(s: string): Map<string, number> {
  const g = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const k = s.slice(i, i + 2);
    g.set(k, (g.get(k) ?? 0) + 1);
  }
  return g;
}

/** Dice coefficient on letter pairs: 1 = same pairs, 0 = none shared. */
function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  for (const [k, v] of A) shared += Math.min(v, B.get(k) ?? 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

/** Best Dice of the query against any stretch of the text about its length. */
function nearSpelling(q: string, t: string): number {
  if (q.length < 2) return 0;
  let best = dice(q, t);
  for (let w = Math.max(2, q.length - 1); w <= q.length + 1; w++) {
    for (let i = 0; i + w <= t.length; i++) best = Math.max(best, dice(q, t.slice(i, i + w)));
  }
  return best;
}

/** The query's letters in order inside the text: where they were found. */
function inOrder(q: string, t: string): number[] | null {
  const found: number[] = [];
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) {
      found.push(j);
      i++;
    }
  }
  return i === q.length ? found : null;
}

/** How well one piece of text answers the query. */
export function scoreText(query: string, text: string, kind: SearchFieldKind): TextMatch {
  const q = fold(query, false).s;
  if (!q || !text) return NO_MATCH;
  const t = fold(text, false);
  const idx = t.s.indexOf(q);
  const hit = (score: number, why: MatchReason, at = idx, len = q.length): TextMatch => ({
    score,
    why,
    marks: at >= 0 ? span(t.at, at, len) : [],
  });

  if (kind === "code") {
    if (t.s === q) return hit(85, "ตรงรหัส");
    // People remember a code by its NUMBER: "22" or "0022" is P-0022, "2" is A02.
    if (/^\d+$/.test(q)) {
      const wanted = q.replace(/^0+/, "");
      const digits = t.s.replace(/\D/g, "").replace(/^0+/, "");
      if (wanted && wanted === digits) {
        const at = t.s.lastIndexOf(wanted);
        return hit(80, "ตรงเลขรหัส", at, wanted.length);
      }
    }
    if (idx === 0) return hit(75, "รหัสขึ้นต้นด้วย");
    if (idx > 0) return hit(Math.max(50, 60 - idx), "มีในรหัส");
    return NO_MATCH;
  }

  if (kind === "category") {
    if (t.s === q) return hit(35, "ตรงหมวด");
    if (idx === 0) return hit(30, "ตรงหมวด");
    if (idx > 0) return hit(25, "ตรงหมวด");
    const lq = fold(query, true).s;
    const lt = fold(text, true);
    const li = lt.s.indexOf(lq);
    return lq && li >= 0 ? { score: 20, why: "ตรงหมวด", marks: span(lt.at, li, lq.length) } : NO_MATCH;
  }

  // ---- name ----
  if (t.s === q) return hit(100, "ตรงทั้งชื่อ");
  if (idx === 0) return hit(90, "ขึ้นต้นด้วย");
  if (idx > 0) return hit(Math.max(70, 80 - idx), "มีคำนี้");

  const lq = fold(query, true).s;
  const lt = fold(text, true);
  const li = lq ? lt.s.indexOf(lq) : -1;
  if (li >= 0) return { score: Math.max(60, 68 - li), why: "ไม่นับวรรณยุกต์", marks: span(lt.at, li, lq.length) };

  // An abbreviation needs 3+ letters sitting close together — "ไก" must not find
  // ผัดไทยกุ้งสด through ไ…ก.
  const order = q.length >= 3 ? inOrder(q, t.s) : null;
  const orderSpan = order ? order[order.length - 1] - order[0] + 1 : Infinity;
  const abbrev = order && orderSpan <= q.length * 3 ? Math.round(30 + 20 * (q.length / orderSpan)) : 0;
  // A typo must share most of its letter pairs: กระเพรา→กะเพรา (0.73) passes,
  // กระเพรา→กระเทียม (0.55) does not.
  const near = nearSpelling(lq, lt.s);
  const typo = near > 0.6 ? Math.round(20 + 25 * near) : 0;

  if (abbrev > 0 && abbrev >= typo) return { score: abbrev, why: "ตัวอักษรเรียงตามลำดับ", marks: order!.map((j) => t.at[j]) };
  if (typo > 0) return { score: typo, why: "สะกดใกล้เคียง", marks: [] };
  return NO_MATCH;
}

/**
 * Every item, best match first. Nothing is dropped: an item that matches
 * nothing scores 0 and keeps its place among the other zeros.
 */
export function rankBySearch<T>(items: readonly T[], query: string, fields: SearchField<T>[]): Ranked<T>[] {
  const ranked = items.map((item, index) => {
    let best: TextMatch = NO_MATCH;
    let field: number | null = null;
    fields.forEach((f, fi) => {
      const m = scoreText(query, f.get(item) ?? "", f.kind);
      if (m.score > best.score) {
        best = m;
        field = fi;
      }
    });
    return { item, index, field, ...best };
  });
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index);
}

/** True when the query has anything to search with. */
export const hasQuery = (query: string) => fold(query, false).s.length > 0;

/** The text cut into plain and highlighted runs, for rendering a match. */
export function highlightRuns(text: string, marks: readonly number[]): { text: string; hit: boolean }[] {
  if (marks.length === 0) return [{ text, hit: false }];
  const set = new Set(marks);
  const runs: { text: string; hit: boolean }[] = [];
  const src = text.normalize("NFC");
  for (let i = 0; i < src.length; i++) {
    const hit = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += src[i];
    else runs.push({ text: src[i], hit });
  }
  return runs;
}
