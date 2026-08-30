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
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  MAX_SALES_FILE_BYTES,
  commitSalesImportInputSchema,
  posIntegrationInputSchema,
  salesImportProfileInputSchema,
  uploadSalesFileInputSchema,
} from "@/lib/validations/sales-import";
import {
  SalesImportAlreadyCommittedError,
  SalesImportBatchNotFoundError,
  SalesImportFileRejectedError,
  SalesImportPreviewStaleError,
  SalesImportProfileNotFoundError,
  commitSalesImportLogic,
  previewSalesImportLogic,
} from "@/server/sales-import";
import {
  PosIntegrationNotFoundError,
  createPosIntegrationLogic,
  createSalesImportProfileLogic,
} from "@/server/menu";
import {
  computeHeaderSignature,
  decodeSalesFile,
  looksLikeUtf8Bom,
  parseCsv,
  type FileEncodingValue,
} from "@/lib/sales-file";
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
    }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export type ProfileActionState =
  | { ok: true; profileId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export type PosIntegrationActionState =
  | { ok: true; posIntegrationId: string }
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
      suggestedEncoding: FileEncodingValue;
    }
  | { ok: false; formError: string };

const SAMPLE_ROWS = 5;

/**
 * Read a file's header so the profile builder can be filled in against what is
 * actually there.
 *
 * Writes nothing. The encoding is a SUGGESTION from the BOM, and the person
 * still states it — a guess that is right most of the time is exactly the kind
 * of thing that goes wrong silently on the file that matters (rule P13).
 */
export async function inspectSalesFileAction(
  _prev: InspectFileState | null,
  formData: FormData
): Promise<InspectFileState> {
  await requireTenant("sales:import");

  const read = await readUploadedFile(formData);
  if (!read.ok) return { ok: false, formError: read.message };

  const declared = formData.get("encoding");
  const encoding: FileEncodingValue = declared === "TIS620" ? "TIS620" : "UTF8";

  const table = parseCsv(decodeSalesFile(read.bytes, encoding));
  if (table.length === 0) return { ok: false, formError: "ไฟล์ว่าง ไม่มีข้อมูล" };

  return {
    ok: true,
    header: table[0],
    headerSignature: computeHeaderSignature(table[0]),
    sampleRows: table.slice(1, 1 + SAMPLE_ROWS),
    suggestedEncoding: looksLikeUtf8Bom(read.bytes) ? "UTF8" : encoding,
  };
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
  const { tenantId, user } = await requireTenant("sales:import");

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
    revalidateSalesViews();
    return {
      ok: true,
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

// ------------------------------------------------------------
// 4. POS integration and profile
// ------------------------------------------------------------

export async function createPosIntegrationAction(
  _prev: PosIntegrationActionState | null,
  formData: FormData
): Promise<PosIntegrationActionState> {
  const { tenantId } = await requireTenant("sales:import");

  const parsed = posIntegrationInputSchema.safeParse({
    branchId: formData.get("branchId"),
    posType: formData.get("posType"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const created = await createPosIntegrationLogic(tenantId, parsed.data);
    revalidatePath("/sales/import");
    revalidatePath("/settings");
    return { ok: true, posIntegrationId: created.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

export async function createSalesImportProfileAction(
  _prev: ProfileActionState | null,
  formData: FormData
): Promise<ProfileActionState> {
  const { tenantId } = await requireTenant("sales:import");

  const rawColumnMap = formData.get("columnMap");
  let columnMap: unknown;
  try {
    columnMap = typeof rawColumnMap === "string" ? JSON.parse(rawColumnMap) : {};
  } catch {
    return { ok: false, fieldErrors: { columnMap: "การจับคู่คอลัมน์ไม่ถูกต้อง" } };
  }

  const parsed = salesImportProfileInputSchema.safeParse({
    posIntegrationId: formData.get("posIntegrationId"),
    name: formData.get("name"),
    fileKind: formData.get("fileKind"),
    encoding: formData.get("encoding"),
    dateFormat: formData.get("dateFormat"),
    isBuddhistYear: formData.get("isBuddhistYear"),
    headerSignature: formData.get("headerSignature"),
    columnMap,
    amountsIncludeVat: formData.get("amountsIncludeVat"),
    amountsIncludeServiceCharge: formData.get("amountsIncludeServiceCharge"),
    defaultChannel: formData.get("defaultChannel"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const created = await createSalesImportProfileLogic(tenantId, parsed.data);
    revalidatePath("/sales/import");
    return { ok: true, profileId: created.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}
