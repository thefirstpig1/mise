// ============================================================
// คิดครัว — the shop's saved month-end export choices (Kong 2026-10-29)
// ============================================================
// Stored under `accountingExport` in `tenant.settings` (JSONB) — Kong chose
// the existing column over a migration. Any other key in that object is
// left as it was: this is the first writer, it will not be the last.
// ============================================================

import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import {
  accountingExportSettingsSchema,
  readAccountingExportSettings,
  type AccountingExportSettings,
} from "@/lib/validations/accounting-export";

export async function getAccountingExportSettingsLogic(tenantId: string): Promise<AccountingExportSettings> {
  const row = await withTenantContext(tenantId, (tx) =>
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } })
  );
  return readAccountingExportSettings(row.settings);
}

export async function saveAccountingExportSettingsLogic(
  tenantId: string,
  input: unknown
): Promise<AccountingExportSettings> {
  const next = accountingExportSettingsSchema.parse(input) as AccountingExportSettings;
  return withTenantContext(tenantId, async (tx) => {
    const row = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
    const current =
      row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
        ? (row.settings as Prisma.JsonObject)
        : {};
    await tx.tenant.update({
      where: { id: tenantId },
      data: { settings: { ...current, accountingExport: next } as Prisma.InputJsonValue },
    });
    return next;
  });
}
