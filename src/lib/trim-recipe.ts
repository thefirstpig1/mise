// ============================================================
// Mise — trim recipe arithmetic (ADR 0040 Q7), shared by the editor and the server
// ============================================================
// A trim recipe says how one whole thing is cut: each part is a % of the
// WEIGHT and carries a % of the COST (the butcher's yield test). The rules:
//
//   * % value starts as each kept part's share of the KEPT weight — what is
//     thrown away carries no value (its cost is already in what was kept);
//   * the shop may type over any line; the lines it has NOT locked move in
//     proportion so the total stays 100%;
//   * the shop presses 🔒 itself — nothing here ever locks a line;
//   * with every other line locked, a line can take at most what is left;
//   * "คืนค่าตามน้ำหนัก" puts the unlocked lines back to their weight share.
//
// Plain numbers, 2 decimals, the rounding remainder on the largest share —
// so the column on screen always adds up to exactly 100.00.
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

export type TrimPartDraft = {
  /** NULL = the part that is thrown away. */
  productId: string | null;
  weightPct: number;
  valuePct: number;
  locked: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Spread `total` over `weights`, 2 dp, remainder on the largest weight. */
function spread(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const basis = sum > 0 ? weights : weights.map(() => 1);
  const basisSum = sum > 0 ? sum : weights.length;
  const out = basis.map((w) => round2((total * w) / basisSum));
  let largest = 0;
  basis.forEach((w, i) => {
    if (w > basis[largest]) largest = i;
  });
  const drift = round2(total - out.reduce((a, b) => a + b, 0));
  out[largest] = round2(out[largest] + drift);
  return out;
}

const isKept = (p: TrimPartDraft) => p.productId !== null;

/**
 * Put every UNLOCKED kept part back to its share of the kept weight, around
 * whatever the locked ones hold. Thrown-away parts go to 0.
 */
export function resetToWeight(parts: TrimPartDraft[]): TrimPartDraft[] {
  const lockedSum = parts.filter((p) => isKept(p) && p.locked).reduce((a, p) => a + p.valuePct, 0);
  const free = parts.map((p, i) => ({ p, i })).filter(({ p }) => isKept(p) && !p.locked);
  const values = spread(Math.max(0, round2(100 - lockedSum)), free.map(({ p }) => p.weightPct));
  const next = parts.map((p) => ({ ...p, valuePct: isKept(p) ? p.valuePct : 0 }));
  free.forEach(({ i }, k) => {
    next[i].valuePct = values[k];
  });
  return next;
}

/** The most line `index` may take: 100 less every OTHER locked kept line. */
export function maxValueFor(parts: TrimPartDraft[], index: number): number {
  const lockedOthers = parts
    .filter((p, i) => i !== index && isKept(p) && p.locked)
    .reduce((a, p) => a + p.valuePct, 0);
  return Math.max(0, round2(100 - lockedOthers));
}

/**
 * The shop typed `value` into line `index`. Clamp it to what is left, then
 * move the other unlocked kept lines in proportion to what they held, so the
 * total stays 100. With nothing unlocked left to move, the line just takes the
 * capped value and the editor's total says it does not yet add up.
 */
export function setValuePct(parts: TrimPartDraft[], index: number, value: number): TrimPartDraft[] {
  const next = parts.map((p) => ({ ...p }));
  if (!isKept(next[index])) return next;
  const v = round2(Math.min(Math.max(0, value), maxValueFor(parts, index)));
  next[index].valuePct = v;

  const free = next.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== index && isKept(p) && !p.locked);
  if (free.length === 0) return next;
  const lockedOthers = next
    .filter((p, i) => i !== index && isKept(p) && p.locked)
    .reduce((a, p) => a + p.valuePct, 0);
  const remaining = Math.max(0, round2(100 - lockedOthers - v));
  const current = free.map(({ p }) => p.valuePct);
  const basis = current.some((c) => c > 0) ? current : free.map(({ p }) => p.weightPct);
  const values = spread(remaining, basis);
  free.forEach(({ i }, k) => {
    next[i].valuePct = values[k];
  });
  return next;
}

/** Why these parts cannot be saved, in the shop's words — or null. */
export function trimPartsProblem(parts: TrimPartDraft[]): string | null {
  if (!parts.some(isKept)) return "ต้องมีส่วนที่เก็บไว้ใช้อย่างน้อย 1 ส่วน";
  if (parts.some((p) => !(p.weightPct > 0))) return "น้ำหนักของทุกส่วนต้องมากกว่า 0%";
  const weight = round2(parts.reduce((a, p) => a + p.weightPct, 0));
  if (Math.abs(weight - 100) > 0.01) return `น้ำหนักรวมต้องเป็น 100% (ตอนนี้ ${weight}%)`;
  if (parts.some((p) => !isKept(p) && p.valuePct !== 0)) return "ส่วนที่ทิ้งต้องมีมูลค่า 0%";
  const value = round2(parts.filter(isKept).reduce((a, p) => a + p.valuePct, 0));
  if (Math.abs(value - 100) > 0.01) return `มูลค่ารวมต้องเป็น 100% (ตอนนี้ ${value}%)`;
  const ids = parts.filter(isKept).map((p) => p.productId);
  if (new Set(ids).size !== ids.length) return "มีสินค้าซ้ำกันในสูตรตัดแต่ง";
  return null;
}
