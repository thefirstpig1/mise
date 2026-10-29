// ============================================================
// คิดครัว — a month of bill photos and slips, as one .zip (ADR 0037 Q5–Q6)
// ============================================================
// Kong 2026-10-29: the accountant wants the photos themselves, filed — "เชื่อม
// ว่าบิลไหนคู่กับสลิปไหน". One folder per bill holding its bill photos, its
// payment slip and the refund slip, plus สรุป.xlsx listing every bill with the
// folder it is in. Drag it into Drive, send it on LINE, or keep it as a backup.
//
// A month can be hundreds of photos and the machine has 1 GB, so nothing is
// held whole: each photo is a stream that fetches its bytes only when the zip
// reaches it, the zip is STORED (JPEGs do not compress) and streamed out.
// ============================================================

import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type { BranchReach } from "@/lib/permissions/service";
import { getObject } from "@/lib/storage";
import { PAYMENT_METHOD_LABEL } from "@/lib/advance-labels";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
const safe = (s: string) => s.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

export type ExportFile = { path: string; key: string };
export type ExportRow = {
  folder: string;
  billDate: string;
  who: string;
  place: string;
  what: string;
  method: string;
  amount: number;
  status: string;
  refundedOn: string;
  photos: number;
};

/** What goes in the zip: every bill in the month that has a payment, within reach. */
export async function collectMonthExportLogic(
  tenantId: string,
  reach: BranchReach,
  month: string
): Promise<{ files: ExportFile[]; rows: ExportRow[] }> {
  const from = new Date(`${month}-01T00:00:00Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return withTenantContext(tenantId, async (tx: PrismaClient) => {
    const payments = await tx.expensePayment.findMany({
      where: {
        tenantId,
        voidedAt: null,
        expense: { deletedAt: null, billDate: { gte: from, lt: to } },
        ...(reach.allBranches ? {} : { branchId: { in: [...reach.allowedBranchIds] } }),
      },
      include: {
        paidByUser: { select: { name: true, email: true } },
        files: { where: { deletedAt: null }, select: { storageKey: true, contentType: true }, orderBy: { createdAt: "asc" } },
        staffRefund: {
          select: { refundedAt: true, voidedAt: true, files: { where: { deletedAt: null }, select: { storageKey: true, contentType: true } } },
        },
        expense: {
          select: {
            billDate: true,
            vendorName: true,
            supplier: { select: { nameFull: true, isWalkIn: true } },
            items: { select: { description: true }, orderBy: { lineNo: "asc" } },
            files: { where: { deletedAt: null }, select: { storageKey: true, contentType: true }, orderBy: { createdAt: "asc" } },
          },
        },
      },
      orderBy: [{ paidAt: "asc" }],
    });

    const files: ExportFile[] = [];
    const rows: ExportRow[] = [];
    const used = new Set<string>();
    for (const p of payments) {
      const billDate = p.expense.billDate.toISOString().slice(0, 10);
      const who = p.payer === "SHOP" ? "เงินร้าน" : p.paidByUser?.name?.trim() || p.paidByUser?.email.split("@")[0] || "—";
      const place = p.expense.vendorName ?? (p.expense.supplier && !p.expense.supplier.isWalkIn ? p.expense.supplier.nameFull : "—");
      const amount = Number(p.amount);
      let folder = safe(`${billDate} ${who} ฿${amount.toLocaleString("en-US")} ${place}`);
      for (let n = 2; used.has(folder); n++) folder = safe(`${billDate} ${who} ฿${amount.toLocaleString("en-US")} ${place}`) + ` (${n})`;
      used.add(folder);

      const add = (list: { storageKey: string; contentType: string }[], name: string) =>
        list.forEach((f, i) => files.push({ path: `${folder}/${name}${list.length > 1 ? `-${i + 1}` : ""}.${EXT[f.contentType] ?? "bin"}`, key: f.storageKey }));
      const refund = p.staffRefund && !p.staffRefund.voidedAt ? p.staffRefund : null;
      add(p.expense.files, "บิล");
      add(p.files, "สลิป");
      if (refund) add(refund.files, "สลิปคืนเงิน");

      rows.push({
        folder,
        billDate,
        who,
        place,
        what: p.expense.items.map((i) => i.description).join(", "),
        method: PAYMENT_METHOD_LABEL[p.method],
        amount,
        status: p.payer === "SHOP" ? "เงินร้าน" : refund ? "คืนแล้ว" : "ยังไม่คืน",
        refundedOn: refund ? new Date(refund.refundedAt.getTime() + 7 * 3600_000).toISOString().slice(0, 10) : "",
        photos: p.expense.files.length + p.files.length + (refund?.files.length ?? 0),
      });
    }
    return { files, rows };
  });
}

/** A stream that fetches its object only when first read — so the zip holds one photo at a time. */
function lazyObject(key: string): Readable {
  let started = false;
  return new Readable({
    read() {
      if (started) return;
      started = true;
      getObject(key).then(
        (bytes) => {
          this.push(bytes ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.alloc(0));
          this.push(null);
        },
        (e) => this.destroy(e as Error)
      );
    },
  });
}

async function summarySheet(month: string, rows: ExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`บิล ${month}`);
  ws.columns = [
    { header: "วันที่ในบิล", key: "billDate", width: 12 },
    { header: "ใครจ่าย", key: "who", width: 16 },
    { header: "ซื้อที่", key: "place", width: 22 },
    { header: "รายการ", key: "what", width: 40 },
    { header: "จ่ายด้วย", key: "method", width: 10 },
    { header: "ยอด (บาท)", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "สถานะ", key: "status", width: 12 },
    { header: "วันที่คืนเงิน", key: "refundedOn", width: 13 },
    { header: "จำนวนรูป", key: "photos", width: 9 },
    { header: "โฟลเดอร์", key: "folder", width: 50 },
  ];
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The zip as a Node stream, built while it is sent. */
export async function monthZipStream(month: string, data: { files: ExportFile[]; rows: ExportRow[] }): Promise<Readable> {
  const zip = new JSZip();
  zip.file(`สรุป-${month}.xlsx`, await summarySheet(month, data.rows));
  for (const f of data.files) zip.file(f.path, lazyObject(f.key), { binary: true });
  // JSZip's stream is its own (readable-stream v2): it pipes, but it is not
  // async-iterable and Readable.toWeb refuses it. A PassThrough is both.
  const out = new PassThrough();
  const src = zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "STORE" });
  src.on("error", (e: Error) => out.destroy(e));
  src.pipe(out);
  return out;
}
