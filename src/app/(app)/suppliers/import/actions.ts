"use server";

// คิดครัว — save the reviewed bills (คิวงานข้อ 5c): suppliers, prices, and the
// supplier's own wording. No stock, no expense. The screen judged the list with
// src/lib/bill-import.ts; importBillsLogic judges it again.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { MAX_BILL_ROWS } from "@/lib/bill-import";
import { BillDateError, BillRefError, importBillsLogic } from "@/server/bill-import";
import { UnitNeedsRatioError } from "@/server/product";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ref = z.string().min(1).max(300);
const saveSchema = z.object({
  suppliers: z.array(z.object({ ref, id: z.string().uuid().nullable(), name: z.string().trim().max(200), vat: z.boolean() })).max(MAX_BILL_ROWS),
  newProducts: z.array(z.object({ ref, name: z.string().trim().min(1).max(200), baseUnitName: z.string().trim().min(1).max(40) })).max(MAX_BILL_ROWS),
  prices: z
    .array(
      z.object({
        supplierRef: ref,
        product: z.union([z.object({ id: z.string().uuid() }), z.object({ ref })]),
        unitName: z.string().trim().min(1).max(40),
        ratio: z.number().positive().max(1_000_000).nullable(),
        unitPrice: z.number().positive().max(100_000_000),
        date: z.string().regex(DAY),
        itemName: z.string().trim().min(1).max(300),
      })
    )
    .min(1)
    .max(MAX_BILL_ROWS),
});

export type ImportBillsState =
  | { ok: true; suppliersCreated: number; productsCreated: number; unitsAdded: number; pricesWritten: number; skippedOlder: number }
  | { ok: false; formError: string };

export async function importBillsAction(save: unknown): Promise<ImportBillsState> {
  const { tenantId } = await requireTenant("master:write");
  const parsed = saveSchema.safeParse(save);
  if (!parsed.success) return { ok: false, formError: "ข้อมูลบางบรรทัดไม่ครบ — ตรวจแถวที่มีสีแดงแล้วลองอีกครั้ง" };
  const newSupplierNameMissing = parsed.data.suppliers.some((s) => s.id === null && s.name === "");
  if (newSupplierNameMissing) return { ok: false, formError: "มีบิลที่ยังไม่ได้ใส่ชื่อผู้ขาย" };
  try {
    const out = await importBillsLogic(tenantId, parsed.data);
    revalidatePath("/suppliers");
    revalidatePath("/products");
    revalidatePath("/dashboard");
    return { ok: true, ...out };
  } catch (e) {
    if (e instanceof UnitNeedsRatioError) return { ok: false, formError: `หน่วย “${e.unitName}” ต้องบอกขนาดก่อน (1 ${e.unitName} = กี่หน่วยนับ)` };
    if (e instanceof BillDateError) return { ok: false, formError: `บิลวันที่ ${e.date} อยู่ในอนาคต — ตรวจวันที่ของบิล` };
    if (e instanceof BillRefError) return { ok: false, formError: "ข้อมูลร้านเปลี่ยนไประหว่างนี้ — รีเฟรชหน้าแล้วอัปโหลดใหม่" };
    console.error("[suppliers/import] save failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ ยังไม่มีอะไรถูกบันทึก — กรุณาลองใหม่" };
  }
}
