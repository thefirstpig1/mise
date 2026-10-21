// A pack unit's name is built from its parts (Kong 2026-10-21): the shop types
// the container ("ถุง"), the size and the size's unit, and the name is written
// for them — so nobody types "กิโลกรัม" and nobody mistypes it. The size may
// be in g or kg (ml or l) whatever the product is counted in: a 500 g bag of
// coffee counted in kg is "ถุง 500 g", not "ถุง 0.5 kg".
// "ลัง 24 กล่อง (6 l)" says more than a container and a size, so a name can
// still be written by hand. A plain module: the product sheet, the
// "+ ขนาดใหม่" popover and the server all use it.

/** The metric sizes, in grams or millilitres. Facts, not settings. */
const METRIC: Record<string, { dim: "WEIGHT" | "VOLUME"; si: number }> = {
  g: { dim: "WEIGHT", si: 1 },
  kg: { dim: "WEIGHT", si: 1000 },
  ml: { dim: "VOLUME", si: 1 },
  l: { dim: "VOLUME", si: 1000 },
};
/** Old Thai spellings still stored on a few rows (unit_names_en.sql skips collisions). */
const OLD: Record<string, string> = { "กก.": "kg", "กรัม": "g", "มล.": "ml", "ลิตร": "l" };
const canon = (u: string) => OLD[u] ?? u;

/** Units a pack's size can be written in: g/kg or ml/l for a metric base, else the base itself. */
export function sizeUnitsFor(baseUnitName: string): string[] {
  const b = METRIC[canon(baseUnitName)];
  return b ? Object.keys(METRIC).filter((k) => METRIC[k].dim === b.dim) : [canon(baseUnitName)];
}

/** How many base units one pack holds: 500 g in a kg-counted product → 0.5. Null when not convertible. */
export function packRatio(size: string | number, sizeUnit: string, baseUnitName: string): number | null {
  const n = Number(size);
  if (!Number.isFinite(n) || String(size).trim() === "" || n <= 0) return null;
  const s = METRIC[canon(sizeUnit)];
  const b = METRIC[canon(baseUnitName)];
  if (s && b) return s.dim === b.dim ? Math.round(((n * s.si) / b.si) * 1e6) / 1e6 : null;
  return canon(sizeUnit) === canon(baseUnitName) ? n : null;
}

/** "ถุง 500 g"; "" when a part is missing. */
export function composePackName(box: string, size: string | number, sizeUnit: string): string {
  const b = box.trim();
  const n = Number(size);
  return b && String(size).trim() !== "" && Number.isFinite(n) && n > 0 ? `${b} ${n} ${canon(sizeUnit)}` : "";
}

/**
 * The parts of a name that was composed ("ถุง 500 g" holding 0.5 kg), or null
 * when the name says something else and must stay hand-written. The size must
 * agree with the stored ratio, so a name that lies about its size is never
 * read as composed.
 */
export function partsOf(name: string, ratio: string | number, baseUnitName: string): { box: string; size: string; sizeUnit: string } | null {
  const m = /^(\S+) ([0-9]+(?:\.[0-9]+)?) (\S+)$/.exec(name.trim());
  if (!m) return null;
  const [, box, size, unit] = m;
  if (!sizeUnitsFor(baseUnitName).includes(canon(unit))) return null;
  const r = packRatio(size, unit, baseUnitName);
  return r !== null && Math.abs(r - Number(ratio)) < 1e-6 ? { box, size, sizeUnit: canon(unit) } : null;
}

/** The container a new size most likely comes in: the first word of the unit in use. */
export function guessContainer(unitName: string | null | undefined): string {
  const first = (unitName ?? "").trim().split(/\s+/)[0] ?? "";
  return /[0-9]/.test(first) ? "" : first;
}
