# Mise — Restaurant Back-Office Platform

ระบบหลังบ้านสำหรับร้านอาหาร SME ในประเทศไทย — "MarketMan สำหรับ SME ไทย" ราคาถูกกว่า ~90% ตั้งค่าเสร็จใน 30 นาที ใช้ได้โดยไม่ต้องมีสูตรอาหาร

> **สถานะ:** Sprint 1 (Master Data) ✅ เสร็จสมบูรณ์ — รายละเอียดความคืบหน้าทุก Sprint ดูที่ [`docs/sprint-progress.md`](docs/sprint-progress.md) (source of truth)

---

## 🧱 Tech Stack

Next.js 15 (App Router) · React 19 · TypeScript · Prisma 5 · PostgreSQL (Neon, Singapore) · Auth.js v5 (email magic link) · Tailwind CSS · Vitest — package manager: **pnpm 11**

---

## ✨ สิ่งที่ระบบทำได้ตอนนี้

- **Multi-tenant + Auth** — สมัคร/เข้าสู่ระบบด้วย Email magic link (Auth.js v5); dev mode พิมพ์ลิงก์ที่ terminal
- **Tenant / Branch / Department** — สร้างร้าน + สาขา + แผนก, ตั้งค่าเปิด/ปิดฟีเจอร์ Department และ VAT
- **Master Data**
  - **ซัพพลายเออร์** — ฟอร์มเต็ม (ภาษีซื้อ VAT / หัก ณ ที่จ่าย WHT), รหัสไม่ซ้ำ (partial-unique), soft-delete
  - **หมวดบัญชี (Categories)** — 3 ชั้น (account → accounting section → group) แบบ tree; 16 หมวดเริ่มต้นถูกสร้างอัตโนมัติตอนเปิดร้าน
  - **สินค้า/วัตถุดิบ (Products)** — RAW + PREPPED (สายการผลิตแม่-ลูก, ลึกได้ ≤ 5 ชั้น), หลายหน่วย (base + หน่วยเสริม), ความหนาแน่นของเหลว (g/ml: ใช้ค่ามาตรฐานหรือใส่เอง)
- **ราคาซัพพลายเออร์ (Supplier-Product Mapping)**
  - ราคาแบบ time-series (เพิ่มราคาใหม่ปิดราคาเก่าอัตโนมัติ), เผื่อราคาเฉพาะสาขา (branch override), ตั้งราคาแนะนำ (isPreferred)
  - ลบแบบ cascade ที่ผู้ใช้คุมเองได้ + กล่องยืนยันแสดง "ผลกระทบ" (blast-radius), ตัวดูประวัติราคา
  - ดูได้ **2 มุมมอง** — รายสินค้า (product-centric, อ่าน+เขียน) และรายซัพพลายเออร์ (supplier-centric, อ่านอย่างเดียว)

---

## 🚀 ติดตั้งและรัน

### สิ่งที่ต้องมีก่อน
- **Node.js 20+**
- **pnpm 11** (`npm i -g pnpm`)
- บัญชี **Neon** (PostgreSQL cloud ฟรี) — โปรเจกต์นี้ใช้ Neon ไม่ใช่ Docker/Postgres local แล้ว

### ขั้นตอน

**1. Clone**
```bash
git clone https://github.com/thefirstpig1/mise.git
cd mise
```

**2. ติดตั้ง dependencies**
```bash
pnpm install
```
> หมายเหตุ: pnpm จะ block build scripts โดย default — โปรเจกต์อนุญาตไว้แล้วใน `pnpm-workspace.yaml` (`allowBuilds:` — Prisma, esbuild, sharp). ถ้าเจอ `ERR_PNPM_IGNORED_BUILDS` ให้เพิ่มชื่อ package แล้ว `pnpm install` ใหม่ คำเตือน peer-dep ของ react/nodemailer เป็นเรื่องปกติ ข้ามได้

**3. ตั้งค่า environment**
```bash
copy .env.example .env      # Windows  (Mac/Linux ใช้ cp)
```
แก้ไฟล์ `.env` ให้มีค่าเหล่านี้ (ดู [ADR 0003](docs/adr/0003-neon-pooled-and-direct-urls.md) — Neon ต้องมี **ทั้งสอง** URL):
```bash
# Neon pooled URL (มี "-pooler" ใน hostname) — ใช้ตอน runtime
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/DB?sslmode=require"
# Neon direct URL (ไม่มี "-pooler") — ใช้ตอน migrate
DIRECT_URL="postgresql://USER:PASSWORD@ep-xxx.ap-southeast-1.aws.neon.tech/DB?sslmode=require"
# Auth.js secret
AUTH_SECRET="<สุ่มด้วยคำสั่งข้างล่าง>"
```
> ⚠️ `.env.example` ปัจจุบันยังเป็นค่า Docker เก่าและ **ไม่มี `DIRECT_URL`** — เพิ่มเองตามด้านบน
```bash
# สร้าง AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**4. สร้าง schema (migrate ไป Neon)**
```bash
pnpm db:migrate          # = prisma migrate dev (ใช้ DIRECT_URL)
```

**5. ลง manual SQL (RLS + partial-unique indexes — อยู่นอก migrations โดยตั้งใจ)**
```bash
pnpm exec prisma db execute --schema ./prisma/schema.prisma --file ./prisma/manual/enable_rls.sql
pnpm exec prisma db execute --schema ./prisma/schema.prisma --file ./prisma/manual/supplier_code_unique.sql
pnpm exec prisma db execute --schema ./prisma/schema.prisma --file ./prisma/manual/supplier_product_mapping_unique.sql
```
> RLS policies ถูกติดตั้งไว้แต่ยัง **inert** จนถึง Sprint 7 — การแยกข้อมูลระหว่างร้านตอนนี้บังคับที่ชั้นแอป (`withTenantContext`, [ADR 0004](docs/adr/0004-withtenantcontext-data-access-pattern.md))

**6. Seed ข้อมูลระบบ (หน่วยวัด + ความหนาแน่นของเหลว)**
```bash
pnpm db:seed:system      # 11 unit templates + 5 liquid-density templates
```
> 16 หมวดบัญชีเริ่มต้น **ไม่** อยู่ในขั้นนี้ — ถูกสร้างอัตโนมัติตอนเปิดร้านใหม่ (signup)

**7. รัน dev server**
```bash
pnpm dev
```
เปิด **http://localhost:3000** → กด "สมัครใช้งาน" → กรอกข้อมูลร้าน → ดู **terminal** เพื่อ copy magic link → เข้า dashboard

---

## 🛠️ คำสั่งที่ใช้บ่อย

| Command | ใช้ทำอะไร |
|---|---|
| `pnpm dev` | เริ่ม dev server |
| `pnpm build` | build สำหรับ production |
| `pnpm test` | รัน Vitest |
| `pnpm db:migrate` | สร้าง/อัปเดต schema (`prisma migrate dev`) |
| `pnpm db:seed:system` | seed หน่วยวัด + ความหนาแน่นของเหลว |
| `pnpm db:studio` | เปิด Prisma Studio ดูข้อมูล |
| `pnpm db:reset` | ⚠️ ลบ DB แล้ว migrate ใหม่ (ข้อมูลหายหมด) |

> `db:up` / `db:down` ใน package.json เป็นของ Docker เดิม (Sprint 0) — ไม่ใช้แล้วเมื่อย้ายมา Neon

---

## 🐛 แก้ปัญหา

**Prisma ค้าง ~5 วิ แล้ว P1001 บน Windows** — Neon ประกาศ IPv6 (AAAA) และ Windows มักเลือก IPv6 ก่อน ทำให้ Prisma (Rust engine) ค้าง แก้ด้วยการ pin IPv4 ใน hosts file (รัน PowerShell แบบ Administrator) — ดูขั้นตอนเต็มที่ [`.claude/skills/known-pitfalls/SKILL.md`](.claude/skills/known-pitfalls/SKILL.md) #29

**P1001 ทั้งที่ DB ปกติ** — Neon free-tier หลับเองหลัง idle 5 นาที; รัน `SELECT 1` ใน Neon SQL Editor เพื่อปลุก (~10 วิ) แล้วลองใหม่ (Pitfall #17)

**Migrate ฟ้อง connection** — ตรวจว่า `DIRECT_URL` ถูกตั้ง (pooled ใช้ migrate ไม่ได้ — [ADR 0003](docs/adr/0003-neon-pooled-and-direct-urls.md) / Pitfall #18)

**Magic link ไม่ขึ้น** — dev mode พิมพ์ลิงก์ที่ terminal ของ `pnpm dev` ไม่ได้ส่งอีเมลจริง

---

## 📚 เอกสารอ้างอิง

- **ความคืบหน้า Sprint (LIVE)** — [`docs/sprint-progress.md`](docs/sprint-progress.md)
- **Architecture Decision Records** — [`docs/adr/`](docs/adr/) (0001–0009)
- **Master Spec v1.4** — [Google Doc](https://docs.google.com/document/d/110FrOwFwzPbXsxDHUC_f-oqK8ld8a6utAKnrs5KLbfc/edit)
- **Changelog v5** — [Google Doc](https://docs.google.com/document/d/1uWxAg2dU7RnyQfHhK5KjLW3L0B3uCuXtsPigeuHCOqg/edit)
- **Domain glossary** — [`CONTEXT.md`](CONTEXT.md)

---

**Last updated:** June 7, 2026 — Sprint 1 (Master Data) COMPLETE
