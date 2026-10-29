"use server";

// ============================================================
// คิดครัว — save the shop's month-end export choices (Kong 2026-10-29)
// ============================================================
// A shop setting, so `settings:write` (docs/settings-register.md). Anyone with
// cost:view may still download with what is saved; only this writes it.
// ============================================================

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/require-tenant";
import { saveAccountingExportSettingsLogic } from "@/server/accounting-export-settings";
import type { AccountingExportSettings } from "@/lib/validations/accounting-export";

export type SaveExportSettingsState =
  | { ok: true; settings: AccountingExportSettings }
  | { ok: false; formError: string };

export async function saveAccountingExportAction(input: unknown): Promise<SaveExportSettingsState> {
  const { tenantId } = await requireTenant("settings:write");
  try {
    const settings = await saveAccountingExportSettingsLogic(tenantId, input);
    revalidatePath("/month-end");
    return { ok: true, settings };
  } catch (e) {
    console.error("[month-end] save export settings failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ — ตรวจรหัสและชื่อบัญชีอีกครั้ง" };
  }
}
