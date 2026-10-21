"use server";

// "+ ขนาดใหม่…" from the order, purchase-order and receiving screens
// (Kong 2026-10-21). Whoever may buy or receive may ADD a size — not rename or
// resize one; that stays on the product sheet behind its warnings.

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/require-tenant";
import { CrossTenantReferenceError, UnitNeedsRatioError } from "@/server/product";
import { MappingOverlapError, OrderUnitMismatchError } from "@/server/supplier-product-mapping";
import { MappingUnitMismatchError, PackSizeUnitError, addPackSizeLogic, setMappingOrderUnitLogic, type PackSize } from "@/server/pack-size";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function addPackSizeAction(input: {
  productId: string;
  box: string;
  size: string;
  /** g / kg / ml / l, or the base unit itself for a counted product. */
  sizeUnit: string;
  /** Make it this supplier price-list row's order unit, at `unitPrice`. */
  mappingId?: string | null;
  unitPrice?: string | null;
}): Promise<{ ok: true; unit: PackSize } | { ok: false; error: string }> {
  const { tenantId, can } = await requireTenant("any:member");
  if (!(can("master:write") || can("purchase:write") || can("receive:write"))) {
    return { ok: false, error: "บัญชีนี้ไม่มีสิทธิ์เพิ่มขนาดสินค้า" };
  }
  const box = typeof input.box === "string" ? input.box.trim() : "";
  const size = Number(input.size);
  if (!UUID.test(input.productId)) return { ok: false, error: "ไม่พบสินค้านี้" };
  if (box === "" || box.length > 24) return { ok: false, error: "ใส่ชื่อภาชนะ เช่น ถุง กระสอบ แพ็ค" };
  if (!(size > 0)) return { ok: false, error: "ขนาดต้องมากกว่า 0" };
  const price = input.unitPrice == null || String(input.unitPrice).trim() === "" ? null : Number(input.unitPrice);
  if (input.mappingId) {
    if (!UUID.test(input.mappingId)) return { ok: false, error: "ไม่พบรายการราคานี้" };
    if (price === null || !(price >= 0)) return { ok: false, error: "ใส่ราคาของขนาดใหม่ก่อน" };
  }
  try {
    const unit = await addPackSizeLogic(tenantId, { productId: input.productId, box, size, sizeUnit: String(input.sizeUnit ?? "") });
    if (input.mappingId && price !== null) {
      await setMappingOrderUnitLogic(tenantId, { mappingId: input.mappingId, unitId: unit.id, unitPrice: price });
    }
    revalidatePath("/products");
    return { ok: true, unit };
  } catch (e) {
    if (e instanceof CrossTenantReferenceError) return { ok: false, error: "ไม่พบสินค้านี้" };
    if (e instanceof UnitNeedsRatioError || e instanceof PackSizeUnitError) return { ok: false, error: "ขนาดนี้ยังแปลงเป็นหน่วยหลักไม่ได้" };
    if (e instanceof MappingOverlapError) return { ok: false, error: "เพิ่มขนาดแล้ว แต่ตั้งเป็นหน่วยสั่งประจำไม่ได้ — มีราคาที่เริ่มวันนี้หรือหลังจากนี้อยู่แล้ว แก้ที่หน้ารายการราคา" };
    if (e instanceof OrderUnitMismatchError || e instanceof MappingUnitMismatchError) return { ok: false, error: "หน่วยนี้ไม่ใช่ของสินค้านี้" };
    throw e;
  }
}
