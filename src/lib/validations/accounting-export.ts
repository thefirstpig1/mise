// ============================================================
// คิดครัว — what a shop chooses once for its month-end file (Kong 2026-10-29)
// ============================================================
// Kept in `tenant.settings` (a JSONB column that existed unused — Kong chose
// it over a migration). The page and the download both read it through
// `readAccountingExportSettings`, which never throws: a shop that has saved
// nothing, or whose JSON is from an older shape, gets the defaults below.
// ============================================================

import { z } from "zod";
import type { AccountKey, AccountMap } from "@/lib/month-end-journal";

export const ACCOUNTING_PROGRAMS = ["peak", "flowaccount", "express", "xero", "quickbooks", "excel"] as const;
export type AccountingProgram = (typeof ACCOUNTING_PROGRAMS)[number];

export const DEFAULT_ACCOUNT_NAMES: Record<AccountKey, string> = {
  inventory: "สินค้าคงเหลือ-วัตถุดิบ",
  purchases: "ซื้อวัตถุดิบ",
  cogs: "ต้นทุนขาย",
  shrinkage: "สินค้าขาดจากการตรวจนับ",
  interBranch: "บัญชีพักระหว่างสาขา",
};

const accountRef = (key: AccountKey) =>
  z
    .object({
      code: z.string().trim().max(20, "รหัสบัญชียาวเกินไป").default(""),
      name: z.string().trim().max(100, "ชื่อบัญชียาวเกินไป").default(""),
    })
    .default({})
    .transform((a) => ({ code: a.code, name: a.name || DEFAULT_ACCOUNT_NAMES[key] }));

export const accountingExportSettingsSchema = z.object({
  program: z.enum(ACCOUNTING_PROGRAMS).default("excel"),
  mode: z.enum(["full", "diff"]).default("full"),
  split: z.boolean().default(false),
  scope: z.enum(["company", "branch"]).default("company"),
  accounts: z
    .object({
      inventory: accountRef("inventory"),
      purchases: accountRef("purchases"),
      cogs: accountRef("cogs"),
      shrinkage: accountRef("shrinkage"),
      interBranch: accountRef("interBranch"),
    })
    .default({}),
});

export type AccountingExportSettings = {
  program: AccountingProgram;
  mode: "full" | "diff";
  split: boolean;
  scope: "company" | "branch";
  accounts: AccountMap;
};

/** Whatever is stored — or nothing — becomes a complete, valid settings object. */
export function readAccountingExportSettings(settings: unknown): AccountingExportSettings {
  const raw =
    settings && typeof settings === "object" && "accountingExport" in settings
      ? (settings as { accountingExport: unknown }).accountingExport
      : {};
  const parsed = accountingExportSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : accountingExportSettingsSchema.parse({});
}

/** `?month=2026-09` — a calendar month, never a free date range. */
export const monthParamSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "เดือนไม่ถูกต้อง");

/** What one download asks for. Account codes are NOT here: they come from the shop's saved settings only. */
export const monthEndExportQuerySchema = z.object({
  month: monthParamSchema,
  program: z.enum(ACCOUNTING_PROGRAMS),
  mode: z.enum(["full", "diff"]),
  split: z.enum(["0", "1"]).transform((v) => v === "1"),
  scope: z.enum(["company", "branch"]),
  stock: z.enum(["0", "1"]).default("1").transform((v) => v === "1"),
  branches: z.enum(["0", "1"]).default("0").transform((v) => v === "1"),
  bills: z.enum(["0", "1"]).default("0").transform((v) => v === "1"),
});
export type MonthEndExportQuery = z.infer<typeof monthEndExportQuerySchema>;
