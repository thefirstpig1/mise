// ============================================================
// Mise — trim recipe % value rules (ADR 0040 Q7), pure
// ============================================================

import { describe, it, expect } from "vitest";
import {
  maxValueFor,
  resetToWeight,
  setValuePct,
  trimPartsProblem,
  type TrimPartDraft,
} from "@/lib/trim-recipe";

/** A whole fish: fillet 48%, belly 18%, head 12%, scales + guts 22% (thrown). */
const fish = (): TrimPartDraft[] => [
  { productId: "fillet", weightPct: 48, valuePct: 0, locked: false },
  { productId: "belly", weightPct: 18, valuePct: 0, locked: false },
  { productId: "head", weightPct: 12, valuePct: 0, locked: false },
  { productId: null, weightPct: 22, valuePct: 0, locked: false },
];
const sum = (ps: TrimPartDraft[]) => Math.round(ps.reduce((a, p) => a + p.valuePct, 0) * 100) / 100;

describe("trim recipe % value (ADR 0040 Q7)", () => {
  it("T1: starts at each kept part's share of the KEPT weight; the waste carries 0", () => {
    const ps = resetToWeight(fish());
    // kept weight 78: fillet 48/78, belly 18/78, head 12/78
    expect(ps.map((p) => p.valuePct)).toEqual([61.54, 23.08, 15.38, 0]);
    expect(sum(ps)).toBe(100);
  });

  it("T2: typing a value moves only the UNLOCKED lines, in proportion, to keep 100", () => {
    let ps = resetToWeight(fish());
    ps = setValuePct(ps, 0, 70);
    expect(ps[0].valuePct).toBe(70);
    expect(sum(ps)).toBe(100);
    // belly : head stays 23.08 : 15.38 → 18 : 12
    expect(ps[1].valuePct).toBe(18);
    expect(ps[2].valuePct).toBe(12);
  });

  it("T3: a locked line never moves; and with every other line locked, a line can take at most what is left", () => {
    let ps = resetToWeight(fish());
    ps[1] = { ...ps[1], valuePct: 25, locked: true };
    ps = setValuePct(ps, 0, 60);
    expect(ps[1].valuePct).toBe(25);
    expect(ps[2].valuePct).toBe(15);
    ps[2] = { ...ps[2], locked: true };
    expect(maxValueFor(ps, 0)).toBe(60);
    ps = setValuePct(ps, 0, 90);
    expect(ps[0].valuePct).toBe(60);
  });

  it("T4: 'คืนค่าตามน้ำหนัก' resets the unlocked lines around the locked ones", () => {
    let ps = resetToWeight(fish());
    ps[0] = { ...ps[0], valuePct: 70, locked: true };
    ps = resetToWeight(ps);
    expect(ps[0].valuePct).toBe(70);
    // the 30 left, split belly : head by weight 18 : 12
    expect(ps[1].valuePct).toBe(18);
    expect(ps[2].valuePct).toBe(12);
  });

  it("T5: the saved recipe must add up — weight and value both 100, the waste worth 0", () => {
    expect(trimPartsProblem(resetToWeight(fish()))).toBeNull();
    const short = resetToWeight(fish()).map((p, i) => (i === 3 ? { ...p, weightPct: 20 } : p));
    expect(trimPartsProblem(short)).toMatch(/น้ำหนักรวมต้องเป็น 100%/);
    const valued = resetToWeight(fish()).map((p, i) => (i === 3 ? { ...p, valuePct: 5 } : p));
    expect(trimPartsProblem(valued)).toMatch(/ส่วนที่ทิ้งต้องมีมูลค่า 0%/);
  });
});
