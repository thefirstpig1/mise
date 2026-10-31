"use server";

// ============================================================
// Mise — sales import Server Actions (Sprint 4 Part 19 L4, ADR 0019)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here.
//
// Three things specific to this slice:
//
//   * **The file is posted twice, and that is the design** (L3c). There is no
//     object storage yet, so a preview cannot keep the bytes it parsed between
//     two requests. The browser holds the file and sends it again with the
//     commit; the acknowledged counts are what makes the second pass safe.
//   * **`batchId` is READ from the form, never minted here** — the rule every
//     Part since 13.5 follows. A server-minted key is a fresh key on every
//     retry, and here a duplicate would replace a day of somebody's sales twice.
//   * **A rejected file is not an exception to swallow.** It comes back as a
//     list of Thai row messages, because the shop is the only one who can fix a
//     file, and "import failed" tells them nothing.
//
// Per the 7a-8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import { autoPostImportedDaysLogic, type AutoPostSummary } from "@/server/consumption-auto";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  MAX_SALES_FILE_BYTES,
  commitSalesImportInputSchema,
  salesFileDraftSchema,
  salesFileSetupInputSchema,
  uploadSalesFileInputSchema,
} from "@/lib/validations/sales-import";
import { UNREADABLE_XLSX_MESSAGE, readSalesTable } from "@/server/sales-table";
import { setupSalesFileLogic, trialReadSalesFileLogic, type TrialRead } from "@/server/sales-setup";
import { BranchNotFoundError } from "@/server/branch";
import {
  SalesImportAlreadyCommittedError,
  SalesImportBatchNotFoundError,
  SalesImportFileRejectedError,
  SalesImportPreviewStaleError,
  SalesImportProfileNotFoundError,
  commitSalesImportLogic,
  previewSalesImportLogic,
} from "@/server/sales-import";
import { PosIntegrationNotFoundError } from "@/server/menu";
import { computeHeaderSignature, looksLikeUtf8Bom, type FileEncodingValue } from "@/lib/sales-file";
import {
  toImportPreviewView,
  toSalesRowErrorView,
  type ImportPreviewView,
  type SalesRowErrorView,
} from "./_components/sales-view";

// --- Thai messages (the user-facing error paths) ---
const NO_FILE_MESSAGE = "ยังไม่ได้เลือกไฟล์";
const FILE_TOO_LARGE_MESSAGE = `ไฟล์ใหญ่เกิน ${Math.round(MAX_SALES_FILE_BYTES / 1024 / 1024)} MB`;
const PROFILE_NOT_FOUND_MESSAGE = "ไม่พบรูปแบบไฟล์นี้ กรุณาเลือกใหม่";
const POS_NOT_FOUND_MESSAGE = "ไม่พบเครื่อง POS นี้";
const BATCH_NOT_FOUND_MESSAGE = "ไม่พบรายการนำเข้านี้ กรุณาอัปโหลดไฟล์ใหม่";
const ALREADY_COMMITTED_MESSAGE = "ไฟล์นี้ถูกนำเข้าไปแล้ว";
/**
 * Says what changed and what to do, because "stale" is meaningless to a shop —
 * and the honest fix is genuinely to look again: the numbers they approved are
 * not the numbers that would be written.
 */
const PREVIEW_STALE_MESSAGE =
  "ข้อมูลเปลี่ยนไปตั้งแต่ตอนตรวจ (อาจมีคนนำเข้าวันเดียวกันจากอีกหน้าจอ) — กรุณากดตรวจไฟล์ใหม่อีกครั้ง";

export type SalesImportPreviewState =
  | { ok: true; preview: ImportPreviewView }
  | {
      ok: false;
      formError?: string;
      fieldErrors?: Record<string, string>;
      /** Per-row Thai reasons. The shop is the only one who can fix the file. */
      rowErrors?: SalesRowErrorView[];
    };

export type SalesImportCommitState =
  | {
      ok: true;
      rowsWritten: number;
      daysReplaced: number;
      daysAdded: number;
      stubMenusCreated: number;
      /**
       * Days whose posted consumption this import took back (ADR 0022 Q5).
       * Surfaced because a week of stock quietly returning to the ledger is the
       * most expensive kind of invisible.
       */
      consumptionRunsVoided: number;
      /** ADR 0022 amendment: what posting right after the commit did. null = this person may not post. */
      autoPost: AutoPostSummary | null;
    }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

function toFormError(e: unknown): {
  formError?: string;
  fieldErrors?: Record<string, string>;
} {
  if (e instanceof SalesImportProfileNotFoundError) {
    return { fieldErrors: { profileId: PROFILE_NOT_FOUND_MESSAGE } };
  }
  if (e instanceof PosIntegrationNotFoundError) {
    return { fieldErrors: { posIntegrationId: POS_NOT_FOUND_MESSAGE } };
  }
  if (e instanceof BranchNotFoundError) {
    return { formError: "ไม่พบสาขานี้ กรุณาเลือกใหม่" };
  }
  if (e instanceof SalesImportBatchNotFoundError) {
    return { formError: BATCH_NOT_FOUND_MESSAGE };
  }
  if (e instanceof SalesImportAlreadyCommittedError) {
    return { formError: ALREADY_COMMITTED_MESSAGE };
  }
  if (e instanceof SalesImportPreviewStaleError) {
    return { formError: PREVIEW_STALE_MESSAGE };
  }
  throw e; // unexpected → let the error boundary handle it
}

/** Read the uploaded file, or say which of the two ordinary things went wrong. */
async function readUploadedFile(
  formData: FormData
): Promise<{ ok: true; bytes: Uint8Array; fileName: string } | { ok: false; message: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: NO_FILE_MESSAGE };
  }
  if (file.size > MAX_SALES_FILE_BYTES) {
    return { ok: false, message: FILE_TOO_LARGE_MESSAGE };
  }
  return {
    ok: true,
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
  };
}

// ------------------------------------------------------------
// 1. Inspect — what does this file look like?
// ------------------------------------------------------------

export type InspectFileState =
  | {
      ok: true;
      header: string[];
      headerSignature: string;
      /** The first few rows, so a person maps columns against real values. */
      sampleRows: string[][];
      /** The encoding the text was read with — what the format will store. */
      suggestedEncoding: FileEncodingValue;
      /** An Excel workbook: there is no encoding to choose. */
      excel: boolean;
      /** Data rows under the header, blank ones included. */
      rowCount: number;
    }
  | { ok: false; formError: string };

const SAMPLE_ROWS = 5;

/**
 * The encoding to read a CSV with when the person has not said: a BOM says
 * UTF-8; bytes that are valid UTF-8 are UTF-8; anything else is the TIS-620 a
 * Thai Excel writes. The person still SEES the decoded Thai on the next page
 * and can switch (rule P13) — this only chooses what they look at first.
 */
function encodingFor(bytes: Uint8Array, declared: FormDataEntryValue | null): FileEncodingValue {
  if (declared === "TIS620" || declared === "UTF8") return declared;
  if (looksLikeUtf8Bom(bytes)) return "UTF8";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "UTF8";
  } catch {
    return "TIS620";
  }
}

/**
 * Read a file's header so a format can be filled in against what is actually
 * there. CSV or Excel (Kong 2026-11-01). Writes nothing.
 */
export async function inspectSalesFileAction(
  _prev: InspectFileState | null,
  formData: FormData
): Promise<InspectFileState> {
  await requireTenant("sales:import");

  const read = await readUploadedFile(formData);
  if (!read.ok) return { ok: false, formError: read.message };

  const encoding = encodingFor(read.bytes, formData.get("encoding"));
  const t = await readSalesTable(read.bytes, encoding);
  if (!t.ok) return { ok: false, formError: UNREADABLE_XLSX_MESSAGE };
  const table = t.table;
  if (table.length === 0) return { ok: false, formError: "ไฟล์ว่าง ไม่มีข้อมูล" };

  return {
    ok: true,
    header: table[0],
    headerSignature: computeHeaderSignature(table[0]),
    sampleRows: table.slice(1, 1 + SAMPLE_ROWS),
    suggestedEncoding: encoding,
    excel: t.excel,
    rowCount: table.length - 1,
  };
}

// ------------------------------------------------------------
// 1b. The first-import wizard: try the format, then save it with its POS
// ------------------------------------------------------------

export type TrialReadState = { ok: true; trial: TrialRead } | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/** The wizard's fields, as the zod schemas below expect them. */
function draftFields(formData: FormData) {
  let columnMap: unknown = {};
  try {
    const raw = formData.get("columnMap");
    columnMap = typeof raw === "string" ? JSON.parse(raw) : {};
  } catch {
    columnMap = null;
  }
  return {
    branchId: formData.get("branchId"),
    fileKind: formData.get("fileKind"),
    encoding: formData.get("encoding"),
    dateFormat: formData.get("dateFormat"),
    isBuddhistYear: formData.get("isBuddhistYear"),
    columnMap,
    amountsIncludeVat: formData.get("amountsIncludeVat"),
    amountsIncludeServiceCharge: formData.get("amountsIncludeServiceCharge"),
    defaultChannel: formData.get("defaultChannel"),
  };
}

/** What an unsaved format makes of the sample — the wizard's last page. Writes nothing. */
export async function trialReadSalesFileAction(formData: FormData): Promise<TrialReadState> {
  const { tenantId, assertBranch } = await requireTenant("sales:import");
  const read = await readUploadedFile(formData);
  if (!read.ok) return { ok: false, formError: read.message };

  const parsed = salesFileDraftSchema.safeParse(draftFields(formData));
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  assertBranch(parsed.data.branchId);

  const t = await readSalesTable(read.bytes, parsed.data.encoding);
  if (!t.ok) return { ok: false, formError: UNREADABLE_XLSX_MESSAGE };
  try {
    const { branchId, ...draft } = parsed.data;
    return { ok: true, trial: await trialReadSalesFileLogic(tenantId, branchId, draft, t.table) };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

export type SalesFileSetupState =
  | { ok: true; profileId: string; posIntegrationId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/**
 * The wizard's one save: the POS and the file format together. The header
 * fingerprint is taken from the file again here, never from the browser.
 */
export async function setupSalesFileAction(formData: FormData): Promise<SalesFileSetupState> {
  const { tenantId, assertBranch } = await requireTenant("sales:import");
  const read = await readUploadedFile(formData);
  if (!read.ok) return { ok: false, formError: read.message };

  const parsed = salesFileSetupInputSchema.safeParse({
    ...draftFields(formData),
    posIntegrationId: formData.get("posIntegrationId"),
    posType: formData.get("posType"),
    posName: formData.get("posName"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  assertBranch(parsed.data.branchId);

  const t = await readSalesTable(read.bytes, parsed.data.encoding);
  if (!t.ok) return { ok: false, formError: UNREADABLE_XLSX_MESSAGE };
  if (t.table.length === 0) return { ok: false, formError: "ไฟล์ว่าง ไม่มีข้อมูล" };

  try {
    const saved = await setupSalesFileLogic(tenantId, { ...parsed.data, headerSignature: computeHeaderSignature(t.table[0]) });
    revalidatePath("/sales/import");
    revalidatePath("/settings");
    return { ok: true, ...saved };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

// ------------------------------------------------------------
// 2. Preview
// ------------------------------------------------------------

export async function previewSalesImportAction(
  _prev: SalesImportPreviewState | null,
  formData: FormData
): Promise<SalesImportPreviewState> {
  const { tenantId, user } = await requireTenant("sales:import");

  const read = await readUploadedFile(formData);
  if (!read.ok) return { ok: false, fieldErrors: { file: read.message } };

  const parsedInput = uploadSalesFileInputSchema.safeParse({
    batchId: formData.get("batchId"),
    profileId: formData.get("profileId"),
    fileName: read.fileName,
  });
  if (!parsedInput.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsedInput.error) };
  }

  try {
    const preview = await previewSalesImportLogic(
      tenantId,
      user.id,
      parsedInput.data,
      read.bytes
    );
    return { ok: true, preview: toImportPreviewView(preview) };
  } catch (e) {
    if (e instanceof SalesImportFileRejectedError) {
      return {
        ok: false,
        formError: "ไฟล์นี้ยังนำเข้าไม่ได้ — แก้ตามรายการด้านล่างแล้วอัปโหลดใหม่",
        rowErrors: e.errors.map(toSalesRowErrorView),
      };
    }
    return { ok: false, ...toFormError(e) };
  }
}

// ------------------------------------------------------------
// 3. Commit
// ------------------------------------------------------------

/**
 * Everything a committed import changes.
 *
 * `/cost` is revalidated because this is the write that finally puts a number in
 * its revenue column — the field ADR 0014 Q9 has carried as null since Sprint 2.
 * `/menus` because a commit can have created stubs, and the queue is worth
 * nothing if it only appears after a manual reload.
 */
function revalidateSalesViews(): void {
  revalidatePath("/sales");
  revalidatePath("/sales/import");
  revalidatePath("/menus");
  revalidatePath("/cost");
  revalidatePath("/dashboard");
}

export async function commitSalesImportAction(
  _prev: SalesImportCommitState | null,
  formData: FormData
): Promise<SalesImportCommitState> {
  const { tenantId, user, can } = await requireTenant("sales:import");

  const read = await readUploadedFile(formData);
  if (!read.ok) return { ok: false, fieldErrors: { file: read.message } };

  const parsedInput = commitSalesImportInputSchema.safeParse({
    batchId: formData.get("batchId"),
    acknowledgedReplacedDays: Number(formData.get("acknowledgedReplacedDays")),
    acknowledgedNewMenus: Number(formData.get("acknowledgedNewMenus")),
    acknowledgedNewCategories: Number(formData.get("acknowledgedNewCategories")),
  });
  if (!parsedInput.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsedInput.error) };
  }

  try {
    const result = await commitSalesImportLogic(
      tenantId,
      user.id,
      parsedInput.data,
      read.bytes
    );
    // ADR 0022 amendment (Kong 2026-10-24, D1): post right after the commit, so
    // nobody has to remember a second press. Outside the import transaction on
    // purpose (Q2) — a recipe problem reports a day, it never undoes the file.
    // Only for someone who may post: the accountant role imports but does not
    // move the ledger (permissions/service.ts).
    const autoPost = can("consumption:post")
      ? await autoPostImportedDaysLogic(tenantId, { batchId: result.batchId, branchId: result.branchId, days: result.days }, user.id)
      : null;
    revalidateSalesViews();
    if (autoPost) {
      revalidatePath("/consumption");
      revalidatePath("/stock");
      revalidatePath("/products");
    }
    return {
      ok: true,
      autoPost,
      rowsWritten: result.rowsWritten,
      daysReplaced: result.daysReplaced,
      daysAdded: result.daysAdded,
      stubMenusCreated: result.stubMenusCreated,
      consumptionRunsVoided: result.consumptionRunsVoided,
    };
  } catch (e) {
    if (e instanceof SalesImportFileRejectedError) {
      // The file changed between preview and commit — the browser sent something
      // else. Treat it as a rejection, not as a crash.
      return {
        ok: false,
        formError: "ไฟล์ที่ส่งมาตอนยืนยันอ่านไม่ได้ กรุณาเลือกไฟล์แล้วตรวจใหม่อีกครั้ง",
      };
    }
    return { ok: false, ...toFormError(e) };
  }
}
