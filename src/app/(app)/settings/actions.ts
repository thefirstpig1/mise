"use server";

// ============================================================
// Mise — ตั้งค่าร้าน, one Server Action per section (review 2026-10-28)
// ============================================================
// The page used to be one form with one บันทึก at the very bottom: change VAT
// at the top, forget to scroll, and the change was gone without a word. Each
// section now saves on its own (mockup 6A5E893FefkuYmW3Z5vzbn), so each one
// writes ONLY its own columns — a section that sent every column would put
// back whatever another section's form still held.
//
// Out-of-range numbers keep what the shop had rather than clamping to a value
// nobody typed (the rule par_warning_days always followed), and say so.
// ============================================================

import { revalidatePath } from "next/cache";
import { withTenantContext } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { setDailyCloseEnabledLogic } from "@/server/daily-close";

export type SectionState = { ok: true } | { ok: false; formError: string; fieldErrors?: Record<string, string> };

type Data = Record<string, unknown>;

async function write(data: Data, paths: string[]): Promise<SectionState> {
  // Re-authenticate inside the action — server actions are independent
  // requests, so nothing is trusted from the render that drew the form.
  const { tenantId } = await requireTenant("settings:write");
  try {
    await withTenantContext(tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data }));
  } catch (e) {
    console.error("[settings] tenant update failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  revalidatePath("/settings");
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

/** A number inside [lo, hi] (whole when `int`), else undefined. */
function numIn(formData: FormData, name: string, lo: number, hi: number, int = false): number | undefined {
  const raw = formData.get(name);
  if (raw === null || String(raw).trim() === "") return undefined;
  const v = Number(raw);
  return Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v)) ? v : undefined;
}

export async function saveShopSectionAction(formData: FormData): Promise<SectionState> {
  const name = String(formData.get("name") ?? "").trim();
  const vatRate = numIn(formData, "default_vat_rate_percent", 0, 30);
  const fieldErrors: Record<string, string> = {};
  if (name.length === 0 || name.length > 100) fieldErrors.name = "กรุณาใส่ชื่อร้าน (ไม่เกิน 100 ตัวอักษร)";
  if (vatRate === undefined) fieldErrors.default_vat_rate_percent = "อัตรา VAT ต้องอยู่ระหว่าง 0–30%";
  if (Object.keys(fieldErrors).length) return { ok: false, formError: "ยังบันทึกไม่ได้ กรุณาแก้ช่องที่มีข้อความสีแดง", fieldErrors };

  return write(
    { name, isVatRegistered: formData.get("is_vat_registered") === "on", defaultVatRatePercent: vatRate },
    ["/dashboard", "/cost", "/purchase-orders", "/expenses"]
  );
}

export async function saveStockSectionAction(formData: FormData): Promise<SectionState> {
  // Radios, not checkboxes: both readings are legitimate and neither is the
  // absence of the other (ADR 0022 Q3, ADR 0035 Q4).
  const cancelledSalePolicy =
    formData.get("cancelled_sale_policy") === "TREAT_AS_NOT_COOKED" ? "TREAT_AS_NOT_COOKED" : "TREAT_AS_COOKED";
  const staffMealStockSource = formData.get("staff_meal_stock_source") === "POS" ? "POS" : "SYSTEM";
  // Rule PAR-2: 0–30 whole days.
  const parWarningDays = numIn(formData, "par_warning_days", 0, 30, true);
  const countCycleDays = numIn(formData, "count_cycle_days", 1, 365, true);
  const fieldErrors: Record<string, string> = {};
  if (parWarningDays === undefined) fieldErrors.par_warning_days = "ใส่จำนวนวันเต็ม 0–30";
  if (countCycleDays === undefined) fieldErrors.count_cycle_days = "ใส่จำนวนวันเต็ม 1–365";
  if (Object.keys(fieldErrors).length) return { ok: false, formError: "ยังบันทึกไม่ได้ กรุณาแก้ช่องที่มีข้อความสีแดง", fieldErrors };

  return write(
    { cancelledSalePolicy, staffMealStockSource, parWarningDays, countCycleDays },
    ["/dashboard", "/consumption", "/staff-meals", "/products", "/stock"]
  );
}

const TARGETS = [
  ["food_cost_target_pct", "foodCostTargetPct", 5, 90, false, "5–90%"],
  ["prime_cost_target_pct", "primeCostTargetPct", 10, 99, false, "10–99%"],
  ["count_variance_target_pct", "countVarianceTargetPct", 0, 20, false, "0–20%"],
  ["cost_coverage_min_pct", "costCoverageMinPct", 50, 100, true, "50–100% (จำนวนเต็ม)"],
  ["slow_stock_days", "slowStockDays", 7, 365, true, "7–365 วัน"],
] as const;

export async function saveProfitSectionAction(formData: FormData): Promise<SectionState> {
  // ADR 0019 Q17 — a radio for the same reason as above.
  const grossProfitMethod =
    formData.get("gross_profit_method") === "RECIPE_CONSUMPTION" ? "RECIPE_CONSUMPTION" : "PERIODIC_INVENTORY";
  const data: Data = { grossProfitMethod };
  const fieldErrors: Record<string, string> = {};
  for (const [field, column, lo, hi, int, range] of TARGETS) {
    const v = numIn(formData, field, lo, hi, int);
    if (v === undefined) fieldErrors[field] = `ใส่ได้ ${range}`;
    else data[column] = v;
  }
  if (Object.keys(fieldErrors).length) return { ok: false, formError: "ยังบันทึกไม่ได้ กรุณาแก้ช่องที่มีข้อความสีแดง", fieldErrors };

  return write(data, ["/dashboard", "/cost", "/products"]);
}

export async function saveAddonsSectionAction(formData: FormData): Promise<SectionState> {
  const res = await write({ enableDepartments: formData.get("enable_departments") === "on" }, [
    "/dashboard",
    "/cost",
    "/purchase-requests",
    "/settings/departments",
    "/settings/members",
  ]);
  if (!res.ok) return res;
  // ADR 0042 — the add-on seeds its starter customer types the first time it
  // is switched on, so it goes through its own logic rather than a column write.
  const { tenantId } = await requireTenant("settings:write");
  try {
    await setDailyCloseEnabledLogic(tenantId, formData.get("daily_close_enabled") === "on");
  } catch (e) {
    console.error("[settings] daily close switch failed", e);
    return { ok: false, formError: "บันทึกรายงานปิดร้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
