# Thai Language Conventions

## When to use Thai vs English

### Thai (ภาษาไทย)
- User-facing UI text (labels, buttons, error messages, notifications)
- Form placeholders
- Tooltips
- Page titles (browser tab + h1)
- Help text

### English
- Code (variable names, function names, comments)
- Database table/column names (snake_case English)
- Git commit messages
- Error logs (server-side console.log)
- API responses (until i18n layer added in Phase 2)
- Documentation files (README, CLAUDE.md, skills)

## Translation patterns for common terms

| English | Thai |
|---------|------|
| Add | เพิ่ม |
| Edit | แก้ไข |
| Delete | ลบ |
| Save | บันทึก |
| Cancel | ยกเลิก |
| Confirm | ยืนยัน |
| Search | ค้นหา |
| Filter | กรอง |
| Loading... | กำลังโหลด... |
| No data | ไม่มีข้อมูล |
| Required | จำเป็น |
| Optional | ไม่บังคับ |
| Active | ใช้งาน |
| Inactive | ไม่ใช้งาน |
| Settings | ตั้งค่า |
| Dashboard | ภาพรวม |
| Suppliers | ซัพพลายเออร์ |
| Products | สินค้า/วัตถุดิบ |
| Categories | หมวดหมู่ |
| Branches | สาขา |
| Departments | แผนก |
| Recipe | สูตร |
| Menu | เมนู |
| Cost | ต้นทุน |
| Price | ราคา |
| Quantity | จำนวน |
| Unit | หน่วย |

## Restaurant/F&B specific terms

| English | Thai |
|---------|------|
| Purchase Request (PR) | ใบขอซื้อ |
| Purchase Order (PO) | ใบสั่งซื้อ |
| Goods Receipt (GR) | ใบรับสินค้า |
| Stock Count | นับสต็อก |
| VAT | ภาษีมูลค่าเพิ่ม |
| Withholding Tax | ภาษีหัก ณ ที่จ่าย |
| Tax Invoice | ใบกำกับภาษี |
| Receipt | ใบเสร็จ |
| Inventory | สินค้าคงคลัง |
| Waste | ของเสีย |
| Consumption | การใช้ |
| Yield | yield (technical, can stay English in UI) |

## Numeric formatting

- Currency: ฿1,234.56 (Thai Baht symbol)
- Date: 17 พ.ค. 2569 (short month + Buddhist Era for display)
  - But store as ISO 8601 UTC internally
- Time: 14:30 น.

## Mixing languages
- OK: "เพิ่ม Supplier" (Thai action + English entity)
- OK: "Total: ฿1,234" (English label + Thai currency)
- Avoid: Excessive Thai-English code switching in single sentence
