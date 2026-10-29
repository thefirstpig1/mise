// ============================================================
// คิดครัว — photos of bills and slips (ADR 0037 Q5–Q6)
// ============================================================
// A photo is uploaded BEFORE the document it belongs to exists — the camera
// opens first, the form is filled after — so a file is born with no owner and
// is attached when the claim is saved. The bytes go to storage first and the
// row second: a row without bytes is a broken link on someone's screen, while
// bytes without a row are only a cost.
//
// Who may see a file is decided here, once, for the download route and the
// zip alike: whoever uploaded it, the staff member it concerns, and — within
// branch reach — whoever can see the shop's spending.
// ============================================================

import type { PrismaClient, StoredFileKind } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { canAccessBranch, type BranchReach } from "@/lib/permissions/service";
import { newStorageKey, putObject, sha256Hex, thumbKeyOf } from "@/lib/storage";

export type UploadedFile = { id: string; kind: StoredFileKind; contentType: string; byteSize: number };

/** A live bill the same bytes are already attached to — "บิลนี้เคยบันทึกแล้ว". */
export type DuplicateBill = { expenseId: string; billDate: string; total: number; who: string | null };

export async function recordUploadLogic(
  tenantId: string,
  userId: string,
  input: { kind: StoredFileKind; contentType: string; bytes: Uint8Array; thumb: Uint8Array | null; originalName: string | null }
): Promise<{ file: UploadedFile; duplicates: DuplicateBill[] }> {
  const sha256 = sha256Hex(input.bytes);
  const { id, key } = newStorageKey(tenantId, input.contentType);
  await putObject(key, input.bytes, input.contentType);
  if (input.thumb && input.contentType.startsWith("image/")) await putObject(thumbKeyOf(key), input.thumb, "image/jpeg");

  return withTenantContext(tenantId, async (tx: PrismaClient) => {
    const file = await tx.storedFile.create({
      data: {
        id,
        tenantId,
        kind: input.kind,
        storageKey: key,
        contentType: input.contentType,
        byteSize: input.bytes.byteLength,
        sha256,
        originalName: input.originalName?.slice(0, 200) ?? null,
        uploadedBy: userId,
      },
      select: { id: true, kind: true, contentType: true, byteSize: true },
    });
    return { file, duplicates: await duplicatesInTx(tx, tenantId, sha256, id) };
  });
}

async function duplicatesInTx(tx: PrismaClient, tenantId: string, sha256: string, exceptId: string): Promise<DuplicateBill[]> {
  const same = await tx.storedFile.findMany({
    where: { tenantId, sha256, id: { not: exceptId }, deletedAt: null, expense: { deletedAt: null } },
    select: {
      expense: {
        select: {
          id: true,
          billDate: true,
          netPaymentAmount: true,
          payments: { where: { voidedAt: null }, select: { paidByUser: { select: { name: true, email: true } } } },
        },
      },
    },
    take: 5,
  });
  return same
    .filter((f) => f.expense)
    .map((f) => ({
      expenseId: f.expense!.id,
      billDate: f.expense!.billDate.toISOString().slice(0, 10),
      total: Number(f.expense!.netPaymentAmount),
      who: f.expense!.payments[0]?.paidByUser?.name ?? f.expense!.payments[0]?.paidByUser?.email ?? null,
    }));
}

/** Attach uploaded, ownerless files to a document. Only the uploader's own, only ownerless ones. */
export async function attachFilesInTx(
  tx: PrismaClient,
  tenantId: string,
  userId: string,
  fileIds: string[],
  owner: { expenseId: string } | { expensePaymentId: string } | { staffRefundId: string }
): Promise<void> {
  if (fileIds.length === 0) return;
  const res = await tx.storedFile.updateMany({
    where: {
      tenantId,
      id: { in: fileIds },
      uploadedBy: userId,
      deletedAt: null,
      expenseId: null,
      expensePaymentId: null,
      staffRefundId: null,
    },
    data: owner,
  });
  if (res.count !== fileIds.length) throw new FileNotAttachableError();
}

export class FileNotAttachableError extends Error {
  constructor() {
    super("A file to attach is missing, not yours, or already attached");
    this.name = "FileNotAttachableError";
  }
}

/** Who is asking, as the route knows them. */
export type FileReader = { userId: string; reach: BranchReach; seesSpending: boolean };

export type ReadableFile = { storageKey: string; contentType: string; originalName: string | null; kind: StoredFileKind; createdAt: Date };

/**
 * The file if this reader may see it, else null (the route answers 404 — not
 * 403, which would confirm the id exists). Rules, in order:
 *   1. the uploader always;
 *   2. the staff member the claim is about (payer of the bill, or refunded);
 *   3. whoever sees the shop's spending (expense:view or refund:pay), within
 *      branch reach of the bill — a refund is reachable through its payments.
 */
export async function getReadableFileLogic(tenantId: string, fileId: string, reader: FileReader): Promise<ReadableFile | null> {
  return withTenantContext(tenantId, async (tx: PrismaClient) => {
    const f = await tx.storedFile.findFirst({
      where: { tenantId, id: fileId, deletedAt: null },
      select: {
        storageKey: true,
        contentType: true,
        originalName: true,
        kind: true,
        createdAt: true,
        uploadedBy: true,
        expense: { select: { branchId: true, payments: { where: { voidedAt: null }, select: { paidByUserId: true } } } },
        expensePayment: { select: { branchId: true, paidByUserId: true } },
        staffRefund: { select: { toUserId: true, payments: { select: { branchId: true } } } },
      },
    });
    if (!f) return null;
    const readable = { storageKey: f.storageKey, contentType: f.contentType, originalName: f.originalName, kind: f.kind, createdAt: f.createdAt };
    if (f.uploadedBy === reader.userId) return readable;

    const people = [
      ...(f.expense?.payments.map((p) => p.paidByUserId) ?? []),
      f.expensePayment?.paidByUserId,
      f.staffRefund?.toUserId,
    ];
    if (people.includes(reader.userId)) return readable;

    if (!reader.seesSpending) return null;
    const branches = [
      f.expense?.branchId,
      f.expensePayment?.branchId,
      ...(f.staffRefund?.payments.map((p) => p.branchId) ?? []),
    ].filter((b): b is string => !!b);
    return branches.length > 0 && branches.every((b) => canAccessBranch(reader.reach, b)) ? readable : null;
  });
}
