// ============================================================
// Mise — the first sales import: try a format, then save it with its POS
// ============================================================
// Kong 2026-11-01, mockup 225p68BDqKAZTpd9MqDeph. Two things the old two-form
// flow could not do:
//
//   * **Read the sample BEFORE anything is saved.** The old builder saved the
//     format and only then showed what it made of the file, so a wrong answer
//     meant a saved format nobody could edit. `trialReadSalesFileLogic` runs the
//     real parser (the one every import uses) with an unsaved format and says,
//     day by day, what came out — "ผัดกะเพราหมูสับ × 2 = ฿120". It writes
//     nothing.
//   * **Save the POS and the format as one act.** The old POS form saved the
//     moment a brand was picked, with no way back (Kong: "เลือกแล้วเลือกเลย").
//     `setupSalesFileLogic` creates the POS (or uses one the branch already
//     has — a branch can run a different brand from the next, Kong: "ร้าน
//     เดียวกัน ต่างสาขาอาจจะใช้ POS ไม่เหมือนกันได้") and the format in ONE
//     transaction, so a refusal leaves neither behind.
// ============================================================

import { withTenantContext } from "@/lib/db";
import { computeHeaderSignature, normalizeMenuName } from "@/lib/sales-file";
import { BranchNotFoundError } from "@/server/branch";
import { PosIntegrationNotFoundError } from "@/server/menu";
import { parseSalesTableLogic, type ParseProfile, type SalesRowError } from "@/server/sales-import";
import { readSalesTable } from "@/server/sales-table";
import type { ColumnMap, SalesChannelValue, SalesFileKindValue } from "@/lib/validations/sales-import";

export type SalesFileDraft = Omit<ParseProfile, "headerSignature">;

export type TrialLine = { name: string; qty: number; net: number; discount: number };
export type TrialDay = {
  /** yyyy-mm-dd */
  date: string;
  net: number;
  rows: number;
  /** The biggest few dishes of the day, by money. */
  lines: TrialLine[];
  moreLines: number;
};
export type TrialRead =
  | {
      ok: true;
      days: TrialDay[];
      moreDays: number;
      totalDays: number;
      totalRows: number;
      totalNet: number;
      menus: number;
      blankRowsSkipped: number;
      inconsistentRows: number;
      /** Whether the day came from a time and the branch's cut-off (the file stated none). */
      usedCutoff: boolean;
      cutoffMinutes: number;
    }
  | { ok: false; errors: SalesRowError[]; moreErrors: number };

const SHOW_DAYS = 3;
const SHOW_LINES = 3;
const SHOW_ERRORS = 8;

async function branchCutoff(tenantId: string, branchId: string): Promise<number> {
  const branch = await withTenantContext(tenantId, (tx) =>
    tx.branch.findFirst({ where: { id: branchId, tenantId, deletedAt: null }, select: { salesDayCutoffMinutes: true } })
  );
  if (!branch) throw new BranchNotFoundError(branchId);
  return branch.salesDayCutoffMinutes;
}

/** What an unsaved format makes of the sample file. Writes nothing. */
export async function trialReadSalesFileLogic(
  tenantId: string,
  branchId: string,
  draft: SalesFileDraft,
  table: string[][]
): Promise<TrialRead> {
  const cutoffMinutes = await branchCutoff(tenantId, branchId);
  const header = table[0] ?? [];
  const parsed = parseSalesTableLogic(table, { ...draft, headerSignature: computeHeaderSignature(header) }, { salesDayCutoffMinutes: cutoffMinutes });
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors.slice(0, SHOW_ERRORS), moreErrors: Math.max(0, parsed.errors.length - SHOW_ERRORS) };
  }

  const byDay = new Map<string, { net: number; rows: number; lines: Map<string, TrialLine> }>();
  const menus = new Set<string>();
  for (const r of parsed.rows) {
    const date = r.businessDate.toISOString().slice(0, 10);
    const day = byDay.get(date) ?? { net: 0, rows: 0, lines: new Map() };
    day.net += r.netAmount;
    day.rows += 1;
    const name = r.posMenuName ? normalizeMenuName(r.posMenuName) : (r.posMenuCode ?? "");
    const key = r.posMenuCode ?? r.menuMatchKey;
    menus.add(key);
    const line = day.lines.get(key) ?? { name, qty: 0, net: 0, discount: 0 };
    line.qty += r.qty;
    line.net += r.netAmount;
    line.discount += r.discountAmount;
    day.lines.set(key, line);
    byDay.set(date, day);
  }
  const all = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const round = (n: number) => Math.round(n * 100) / 100;
  const days: TrialDay[] = all.slice(0, SHOW_DAYS).map(([date, d]) => {
    const lines = [...d.lines.values()].sort((a, b) => b.net - a.net);
    return {
      date,
      net: round(d.net),
      rows: d.rows,
      lines: lines.slice(0, SHOW_LINES).map((l) => ({ ...l, qty: round(l.qty), net: round(l.net), discount: round(l.discount) })),
      moreLines: Math.max(0, lines.length - SHOW_LINES),
    };
  });
  return {
    ok: true,
    days,
    moreDays: Math.max(0, all.length - SHOW_DAYS),
    totalDays: all.length,
    totalRows: parsed.rows.length,
    totalNet: round(parsed.rows.reduce((s, r) => s + r.netAmount, 0)),
    menus: menus.size,
    blankRowsSkipped: parsed.blankRowsSkipped,
    inconsistentRows: parsed.inconsistentRows,
    usedCutoff: draft.columnMap.businessDate === undefined && draft.columnMap.soldAt !== undefined,
    cutoffMinutes,
  };
}

export type SalesFileSetup = {
  branchId: string;
  /** One the branch already has, or null to create `posType` / `posName`. */
  posIntegrationId: string | null;
  posType: string | null;
  posName: string | null;
  fileKind: SalesFileKindValue;
  encoding: ParseProfile["encoding"];
  dateFormat: ParseProfile["dateFormat"];
  isBuddhistYear: boolean;
  headerSignature: string;
  columnMap: ColumnMap;
  amountsIncludeVat: boolean;
  amountsIncludeServiceCharge: boolean;
  defaultChannel: SalesChannelValue | null;
};

const KIND_TH: Record<SalesFileKindValue, string> = { BILL_DETAIL: "ไฟล์รายบิล", DAILY_SUMMARY: "ไฟล์สรุปรายวัน" };

/** The POS (new or the branch's own) and its file format, in one transaction. */
export async function setupSalesFileLogic(tenantId: string, input: SalesFileSetup): Promise<{ posIntegrationId: string; profileId: string }> {
  return withTenantContext(tenantId, async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id: input.branchId, tenantId, deletedAt: null }, select: { id: true } });
    if (!branch) throw new BranchNotFoundError(input.branchId);

    let pos: { id: string; name: string };
    if (input.posIntegrationId) {
      // Only a POS of THIS branch: a format belongs to the branch its file comes from.
      const found = await tx.posIntegration.findFirst({
        where: { id: input.posIntegrationId, tenantId, branchId: input.branchId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!found) throw new PosIntegrationNotFoundError(input.posIntegrationId);
      pos = found;
    } else {
      if (!input.posType || !input.posName) throw new Error("setupSalesFileLogic: a new POS needs a type and a name");
      pos = await tx.posIntegration.create({
        data: { tenantId, branchId: input.branchId, posType: input.posType as never, name: input.posName },
        select: { id: true, name: true },
      });
    }

    const profile = await tx.salesImportProfile.create({
      data: {
        tenantId,
        posIntegrationId: pos.id,
        name: `${pos.name} · ${KIND_TH[input.fileKind]}`,
        fileKind: input.fileKind as never,
        encoding: input.encoding as never,
        dateFormat: input.dateFormat,
        isBuddhistYear: input.isBuddhistYear,
        headerSignature: input.headerSignature,
        columnMap: input.columnMap,
        amountsIncludeVat: input.amountsIncludeVat,
        amountsIncludeServiceCharge: input.amountsIncludeServiceCharge,
        defaultChannel: input.defaultChannel as never,
      },
      select: { id: true },
    });
    return { posIntegrationId: pos.id, profileId: profile.id };
  });
}

// ------------------------------------------------------------
// Later imports: the format is found from the file's own header
// ------------------------------------------------------------
// Kong 2026-11-02 (คิวข้อ 11): "หลังจากนั้นก็คืออัปโหลดไฟล์ได้เลย". The format
// was always remembered — the signature of its header row — but the import
// screen still asked which one to use. Each format is tried with ITS OWN
// encoding, so a TIS-620 file is compared as TIS-620; a file that matches none
// is refused before anything is recorded, and the screen offers the setup
// wizard instead of guessing.

export type ProfileForMatch = { id: string; encoding: ParseProfile["encoding"]; headerSignature: string; createdAt: Date };

/** The formats whose header IS this file's header, newest first. */
export function profilesMatchingHeader(
  profiles: readonly ProfileForMatch[],
  signatureFor: (encoding: ParseProfile["encoding"]) => string | null
): string[] {
  return profiles
    .filter((p) => signatureFor(p.encoding) === p.headerSignature)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((p) => p.id);
}

export async function matchSalesProfilesLogic(tenantId: string, branchId: string, bytes: Uint8Array): Promise<string[]> {
  const profiles = await withTenantContext(tenantId, (tx) =>
    tx.salesImportProfile.findMany({
      where: { tenantId, deletedAt: null, posIntegration: { branchId, deletedAt: null } },
      select: { id: true, encoding: true, headerSignature: true, createdAt: true },
    })
  );
  const signatures = new Map<string, string | null>();
  for (const encoding of new Set(profiles.map((p) => p.encoding))) {
    const t = await readSalesTable(bytes, encoding);
    signatures.set(encoding, t.ok && t.table.length > 0 ? computeHeaderSignature(t.table[0]) : null);
  }
  return profilesMatchingHeader(profiles, (e) => signatures.get(e) ?? null);
}
