# ADR 0038 — สิทธิ์ที่ร้านปรับเอง: ค่าเริ่มต้นของบทบาท + ข้อยกเว้นรายคน

**Status:** accepted · **Date:** 2026-09-29 · **Grill:** Q1–Q3 (Kong, 2026-09-29)
**Part:** ยังไม่จัด — ต้องมาก่อน Part ที่สร้าง ADR 0037 (สิทธิ์ "บันทึกของที่ซื้อเอง") · **แก้** ADR 0029 Q8 (สิทธิ์อยู่ในโค้ดเท่านั้น) · **มี migration**

## Context
Kong: *"สิทธิ์อะไรพวกนี้เราควรมีตั้งค่าผู้ใช้ ให้ทางร้านเลือกเองว่าใครจะเห็น/ไม่เห็น ทำอะไรได้/ไม่ได้ บ้าง แต่เราเซ็ต default ไว้ให้"* และ *"ให้ผู้จัดการเปิด/ปิดสิทธิ์การมองเห็น cost พวกนี้ได้เอง"*

ADR 0029 Q8 วางตารางบทบาทไว้ในโค้ดด้วยเหตุผลสองข้อที่ยังจริง: ชื่อสิทธิ์พิมพ์ผิดแล้ว compile ไม่ผ่าน และตารางในฐานข้อมูลคือตารางที่ไม่มีหน้าจอเขียน — ADR นี้เก็บข้อแรกไว้ และตอบข้อสองด้วยหน้าจอ

ข้อเท็จจริงที่พบระหว่าง grill: หน้าใบสั่งซื้อ ใบรับของ แคตตาล็อกผู้ขาย และหน้าตัดรอบ **แสดงราคาโดยไม่เช็ก `cost:view` เลย** — ปลอดภัยวันนี้เพราะทุกบทบาทที่มีสิทธิ์เข้าหน้าเหล่านั้น *บังเอิญ* มี `cost:view` อยู่แล้ว การปรับสิทธิ์รายร้านทำลายความบังเอิญนั้นทันที

## Decision

### Q1 — สองชั้น (แบบ ค.)
**สิทธิ์จริง = สิทธิ์ของบทบาท (ตามที่ร้านปรับ) + ที่เปิดให้คนนั้น − ที่ปิดให้คนนั้น**
1. **ปรับได้เฉพาะสิทธิ์ที่ร้านต่างกันจริง** (~10–12 ข้อ: เห็นต้นทุน/ยอดขาย/ค่าใช้จ่าย/ประวัติมื้อพนักงาน · อนุมัติใบสั่งซื้อ · สร้างใบสั่งซื้อ · รับของ · บันทึกของที่ซื้อเอง · ปิดใบนับ · อนุมัติมื้อพนักงาน · ฯลฯ)
2. **สิทธิ์เชิงโครงสร้างล็อกกับบทบาท**: `member:manage`, `settings:write` — เปิดให้ปรับ = ช่องโหว่ยกสิทธิ์ตัวเองกลับมา
3. **กฎ subset containment (ADR 0029 Q10 rule 1) คิดจากสิทธิ์จริงหลังปรับ** — ให้คนอื่นได้ไม่เกินที่ตัวเองมีจริง
4. **ตารางบทบาท: เจ้าของเท่านั้น** · ข้อยกเว้นรายคน: คนที่จัดการสมาชิกได้ ภายใต้ข้อ 3
5. **ทุกการเปลี่ยนมีบันทึก** ใคร เปลี่ยนสิทธิ์อะไร ของใคร/บทบาทไหน เมื่อไหร่

### Q2 — สิทธิ์ที่เห็นเงินในตัว ต้องมาคู่กับ "เห็นต้นทุน"
ตารางคู่สิทธิ์อยู่ในโค้ด: รับของตามใบสั่งซื้อ · สร้าง/อนุมัติใบสั่งซื้อ · แก้ข้อมูลผู้ขาย/สินค้า ⇒ `cost:view` · หน้าตั้งค่าติ๊กตามให้พร้อมบอกเหตุผล และไม่ยอมให้เอา `cost:view` ออกโดยไม่เอาสิทธิ์ที่พึ่งมันออกด้วย · **"บันทึกของที่ซื้อเอง" ไม่ต้องมี** — แต่หน้านั้นต้องไม่แสดงราคาในอดีต · **เทสต์แดงเมื่อหน้าใหม่แสดงราคาโดยไม่อยู่ในตารางนี้**

### Q3 — เก็บเฉพาะสิ่งที่ร้านเปลี่ยนจากค่าเริ่มต้น
ค่าเริ่มต้นอยู่ในโค้ดเหมือนเดิม · ฐานข้อมูลเก็บเฉพาะส่วนต่าง (บทบาท × สิทธิ์ และคน × สิทธิ์) · สิทธิ์ใหม่ที่ออกภายหลังได้ค่าเริ่มต้นในทุกร้านเอง · สิทธิ์ใหม่ที่เกี่ยวกับเงินเริ่มแบบระวัง (เฉพาะบทบาทที่เห็นเงินอยู่แล้ว) + แถบ "มีสิทธิ์ใหม่ ตรวจดูได้" · ปุ่ม "กลับเป็นค่าเริ่มต้น" รายบทบาท *(ปฏิเสธ: ร้านถือตารางเต็มของตัวเอง — สิทธิ์ใหม่จะไม่มีใครได้จนกว่าร้านรู้และไปติ๊ก)*

## Consequences
1. `hasCapability(role, need)` และ `costAccessFor(role)` ต้องกลายเป็นการถามจาก **สิทธิ์จริงของสมาชิก** — ทุกที่ที่เรียกด้วยบทบาทล้วน (เช่น ผู้รับอีเมลใบขอซื้อ, กฎการเชิญ) ต้องเปลี่ยนตาม · `requireTenant` โหลดส่วนต่างพร้อม membership ในคิวรีเดียว ไม่เพิ่มรอบไปฐานข้อมูล
2. drift test ของ ADR 0029 (matrix, grant rules) ต้องทดสอบกับสิทธิ์จริง ไม่ใช่กับตารางค่าเริ่มต้นอย่างเดียว
3. หน้าที่แสดงราคาต้องถูกไล่ใส่ในตารางคู่สิทธิ์ครั้งแรก — งาน audit หนึ่งรอบก่อนเปิดให้ร้านปรับ
4. ทะเบียน `docs/settings-register.md` ได้แถว "ตารางสิทธิ์ของบทบาท" และ "สิทธิ์รายคน"

## Amendment 2026-10-26 — mockup approved (Kong) + the price audit

Mockup: `docs/mockups/permissions.html` (artifact ShGwn4G37nphkvnQrnf3WN). Kong took all three recommendations:

- **Q4 — 16 adjustable capabilities in four groups**, not cut to 12: เห็นตัวเลขเงิน (`cost:view` `sales:view` `expense:view` `staff:view`) · ซื้อของ (`purchase:write` `purchase:approve` `receive:write` `master:write`) · สต๊อกและครัว (`stock:write` `waste:write` `count:close` `recipe:write`) · ยอดขายและบัญชี (`sales:import` `consumption:post` `expense:write` `staffmeal:approve`). The basics every working role needs (`purchase:request` `count:write` `staffmeal:write` `recipe:draft`) are not in the table. Locked: `member:manage` `settings:write`.
- **Q5 — `admin` is locked like `owner`.** To narrow one admin, use a per-person exception.
- **Q6 — a second pair: `expense:write` ⇒ `expense:view`**, because the expense list prints every amount.

### What the audit found (step 2, Consequence 3)
Pages that print money while gated only by a capability that does not imply seeing it:

| Page | Money shown | Gate today | Pair needed |
|---|---|---|---|
| `/purchase-orders` `[id]` `[id]/edit` | line prices, totals | `purchase:write` | `cost:view` |
| `/goods-receipts` `[id]` `[id]/edit` | line prices, totals | `receive:write` | `cost:view` |
| `/suppliers/[id]` `/suppliers/[id]/order` `/products/[id]` | catalogue price | `master:write` / `purchase:write` | `cost:view` |
| `/expenses/new` | — (the list it returns to) | `expense:write` | `expense:view` |

Safe today only because every role holding those gates happens to hold the pair.

🔴 **One is NOT safe today:** `/stock-counts/[id]` (`count:write`) sends `costPerBaseUnit` for every product to the browser and prints **มูลค่าส่วนต่าง ฿** — so a cook and a head of department, who ADR 0029 says see no money anywhere, see the value of the count variance and can read unit costs out of the page payload.

Already gated correctly: `/cost/*` `/sales` `/dashboard` `/closing` (`sales:view`) `/stock` `/stock/history` `/transfers` `/menus` `/menus/lab` `/recipes` `/products` `/waste` `/purchase-requests` (+`/cut`), `/api/products` `/api/menus` `/api/cost` `/api/expenses`. `/staff-meals` prints selling prices and quotas only, which are not cost.
