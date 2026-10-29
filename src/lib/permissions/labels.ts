// ============================================================
// Mise — Thai names for the capabilities a shop can change (ADR 0038)
// ============================================================
// Words a shop owner recognises, not capability ids. A plain module so a
// Server Component can import it (never a "use client" file — see the
// value-import trap in mise-ui-review).
// ============================================================

import type { Capability } from "./service";

export const CAPABILITY_GROUP_LABELS_TH: Record<"money" | "buying" | "stock" | "books", string> = {
  money: "เห็นตัวเลขเงิน",
  buying: "ซื้อของ",
  stock: "สต๊อกและครัว",
  books: "ยอดขายและบัญชี",
};

export const CAPABILITY_LABELS_TH: Partial<Record<Capability, { label: string; hint: string }>> = {
  "cost:view": { label: "เห็นต้นทุนและกำไร", hint: "ราคาซื้อ ต้นทุนเมนู food cost % กำไรขั้นต้น" },
  "sales:view": { label: "เห็นยอดขาย", hint: "ยอดขายรายวัน รายเมนู และตัวเลขที่คิดจากยอดขาย" },
  "expense:view": { label: "เห็นค่าใช้จ่ายร้าน", hint: "ค่าเช่า ค่าไฟ ค่าบริการ" },
  "staff:view": { label: "ดูประวัติมื้อพนักงานรายคน", hint: "ใครกินอะไร เท่าไร (ข้อมูลส่วนบุคคล)" },
  "purchase:write": { label: "ร่างใบสั่งซื้อ", hint: "เลือกผู้ขาย ใส่จำนวนและราคา" },
  "purchase:approve": { label: "ส่งหรือยกเลิกใบสั่งซื้อ", hint: "ขั้นที่ร้านผูกพันว่าจะจ่ายเงิน" },
  "receive:write": { label: "รับของตามใบสั่งซื้อ", hint: "ยืนยันใบรับของ ยกเลิกใบรับของ" },
  "master:write": { label: "แก้ข้อมูลผู้ขาย สินค้า เมนู", hint: "รวมราคาตามแคตตาล็อกผู้ขาย" },
  "stock:write": { label: "ปรับยอดสต๊อก โอนระหว่างสาขา", hint: "รวมตั้งจุดสั่งซื้อขั้นต่ำ" },
  "waste:write": { label: "บันทึกของเสีย", hint: "" },
  "count:close": { label: "ปิดใบนับของคนอื่น", hint: "ไม่ให้ใบนับค้างเมื่อคนเปิดกลับบ้านไปแล้ว" },
  "recipe:write": { label: "แก้สูตร และนำร่างสูตรไปใช้จริง", hint: "ร่างและเสนอสูตรเป็นสิทธิ์พื้นฐาน" },
  "sales:import": { label: "อัปโหลดไฟล์ POS", hint: "และบันทึกยอดปิดร้าน" },
  "consumption:post": { label: "ตัดสต๊อกตามยอดขาย", hint: "ตัดให้อัตโนมัติหลังอัปโหลด ถ้ามีสิทธิ์นี้" },
  "expense:write": { label: "บันทึกค่าใช้จ่าย", hint: "รวมค่าใช้จ่ายประจำ" },
  "staffmeal:approve": { label: "อนุมัติมื้อพนักงาน", hint: "ของคนอื่นเท่านั้น ไม่ใช่ของตัวเอง" },
  "purchase:self": { label: "บันทึกของที่ซื้อเอง", hint: "ถ่ายรูปบิล บอกว่าจ่ายยังไง — เงินตัวเองเป็นสำรองจ่าย" },
  "refund:pay": { label: "คืนเงินพนักงาน", hint: "รับรองบิลเงินสดที่ไม่มีสลิป และโอนคืน — ไม่ใช่ของตัวเอง" },
};

export const capabilityLabelTh = (c: string) => CAPABILITY_LABELS_TH[c as Capability]?.label ?? c;
