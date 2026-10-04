// Formatting shared by the menu-management screens. A plain module, never
// "use client" — server pages may import it too (mise-ui-review §7).

import { RECIPE_CONFIDENCE_HINTS_TH, RECIPE_CONFIDENCE_LABELS_TH, type RecipeConfidence } from "@/lib/validations/recipe";

export const baht = (v: number, digits = 0) =>
  `${v < 0 ? "−" : ""}฿${Math.abs(v).toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const confidenceTh = (c: string) => RECIPE_CONFIDENCE_LABELS_TH[c as RecipeConfidence] ?? c;
export const confidenceHintTh = (c: string) => RECIPE_CONFIDENCE_HINTS_TH[c as RecipeConfidence] ?? "";

/** Base unit names as stored (kg, l, g, ml) read as Thai on screen. */
const UNIT_TH: Record<string, string> = { kg: "กก.", g: "กรัม", l: "ลิตร", ml: "มล.", pcs: "ชิ้น" };
export const unitTh = (u: string | null | undefined) => (u ? (UNIT_TH[u] ?? u) : "");

export const qtyFmt = (v: number, unit?: string | null) =>
  `${v.toLocaleString("th-TH", { maximumFractionDigits: v < 10 ? 3 : v < 100 ? 1 : 0 })}${unit ? ` ${unitTh(unit)}` : ""}`;

/** "4 ต.ค. 69" from "2026-10-04". */
export const thDate = (iso: string, withYear = true) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "2-digit" as const } : {}),
    timeZone: "UTC",
  });

/** A fresh `submit_key` — the id the server gives the recipe row (Part 13.5). */
export function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
