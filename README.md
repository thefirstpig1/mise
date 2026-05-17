# Mise — Restaurant Back-Office Platform

ระบบหลังบ้านสำหรับร้านอาหารใน Thailand SME

**Sprint 0 — Foundation + Auth + Tenant + Department**

---

## 🎯 สิ่งที่ Sprint 0 ทำได้

- ✅ สมัครสมาชิก + เข้าสู่ระบบ (Email magic link)
- ✅ สร้างร้าน (Tenant) + สาขาแรก
- ✅ Auto-create "Main" department
- ✅ ตั้งค่าเปิด/ปิดฟีเจอร์ Department + VAT
- ✅ Dashboard เปล่า แสดงข้อมูลสมาชิก
- ✅ Tenant isolation ด้วย PostgreSQL RLS
- ✅ PermissionService skeleton (สำหรับ Sprint 2+)

---

## 📦 ติดตั้งครั้งแรก

### ขั้นตอน 1: เปิด Docker Desktop

เปิดโปรแกรม **Docker Desktop** บนเครื่อง — รอจน icon เป็นสีเขียวที่ system tray

### ขั้นตอน 2: Clone repo

```bash
git clone https://github.com/thefirstpig1/mise.git
cd mise
```

### ขั้นตอน 3: ติดตั้ง dependencies

```bash
npm install
```

(ใช้เวลา 2-3 นาที — ติดตั้ง ~500MB ของ packages)

### ขั้นตอน 4: ตั้งค่า environment

```bash
copy .env.example .env
```

(Windows ใช้ `copy`, Mac/Linux ใช้ `cp`)

แก้ไฟล์ `.env` — Sprint 0 ใช้ค่า default ได้เลย ยกเว้น `AUTH_SECRET`:

```bash
# สร้าง secret ด้วย Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy ผลลัพธ์ไปใส่ใน `AUTH_SECRET` ใน `.env`

### ขั้นตอน 5: เริ่ม Postgres

```bash
npm run db:up
```

รอ 10-20 วินาที ให้ container start (Postgres ทำงานที่ port 5432)

### ขั้นตอน 6: สร้าง schema

```bash
npm run db:migrate
```

ตอบ "y" + ตั้งชื่อ migration (เช่น `init`)

### ขั้นตอน 7: เปิด RLS

Sprint 0 ต้องเปิด RLS policies ด้วยตนเอง:

```bash
docker exec -i mise-postgres psql -U mise -d mise_db < prisma/migrations/manual/enable_rls.sql
```

### ขั้นตอน 8: Seed ข้อมูล demo (optional)

```bash
npm run db:seed
```

ระบบจะสร้าง:
- User: kongnithipat5@gmail.com
- Tenant: Demo Restaurant
- Branch: สาขาหลัก
- Department: Main

### ขั้นตอน 9: รัน dev server

```bash
npm run dev
```

เปิดเบราว์เซอร์ที่ **http://localhost:3000**

---

## 🚀 ลองใช้งาน

### ทดสอบ signup

1. เปิด http://localhost:3000
2. กด "สมัครใช้งาน"
3. กรอกข้อมูล (ชื่อ, อีเมล, ชื่อร้าน, สาขา)
4. กด "สร้างบัญชี"
5. ดู terminal ของ dev server — จะเห็น magic link

```
============================================================
📧 Magic link login (dev mode)
============================================================
To: you@example.com
Click here: http://localhost:3000/api/auth/callback/email?...
============================================================
```

6. Copy link → paste ในเบราว์เซอร์ → เข้า dashboard

### ทดสอบ tenant isolation

```bash
npm run test
```

จะรัน RLS test — verify ว่า Tenant A อ่าน Tenant B ไม่ได้

---

## 📁 โครงสร้างโปรเจกต์

```
mise/
├── README.md                    ← คู่มือนี้
├── docker-compose.yml           ← Postgres local
├── package.json                 ← dependencies
├── .env.example                 ← template
│
├── prisma/
│   ├── schema.prisma            ← Sprint 0 tables (7 ตาราง)
│   ├── seed.ts                  ← Tenant init logic (H.1)
│   └── migrations/manual/
│       └── enable_rls.sql       ← RLS policies (H.10)
│
├── src/
│   ├── app/                     ← Next.js App Router
│   │   ├── page.tsx             ← Landing
│   │   ├── login/page.tsx       ← Login
│   │   ├── signup/page.tsx      ← Signup + create tenant
│   │   ├── dashboard/page.tsx   ← Dashboard
│   │   ├── settings/page.tsx    ← Tenant settings
│   │   └── api/auth/
│   │       └── [...nextauth]/   ← Auth.js handler
│   │
│   ├── lib/
│   │   ├── db.ts                ← Prisma + RLS context
│   │   ├── auth.ts              ← Auth.js config
│   │   └── permissions/
│   │       └── service.ts       ← PermissionService (H.4)
│   │
│   └── server/
│       └── tenant-init.ts       ← createTenant function
│
└── tests/
    ├── setup.ts
    └── tenant-isolation.test.ts ← RLS leak tests
```

---

## 🛠️ คำสั่งที่ใช้บ่อย

| Command | Purpose |
|---------|---------|
| `npm run dev` | เริ่ม dev server (http://localhost:3000) |
| `npm run db:up` | เปิด Postgres container |
| `npm run db:down` | ปิด Postgres container |
| `npm run db:migrate` | สร้าง/อัปเดต schema |
| `npm run db:seed` | สร้างข้อมูล demo |
| `npm run db:studio` | เปิด Prisma Studio (GUI ดู data) |
| `npm run db:reset` | ลบ database + สร้างใหม่ |
| `npm run test` | รัน tests |
| `npm run build` | Build for production |

---

## 🐛 แก้ปัญหา

### "Cannot connect to database"

```bash
# เช็คว่า Postgres ทำงานอยู่ไหม
docker ps

# ถ้าไม่มี mise-postgres → start ใหม่
npm run db:up
```

### "Migration failed"

```bash
# Reset database (ระวัง: ลบข้อมูลทั้งหมด)
npm run db:reset
npm run db:migrate
```

### "RLS policy already exists"

```bash
# ลบ database แล้วทำใหม่
npm run db:reset
npm run db:migrate
docker exec -i mise-postgres psql -U mise -d mise_db < prisma/migrations/manual/enable_rls.sql
```

### Magic link ไม่ขึ้น

ดู terminal ของ `npm run dev` — link จะอยู่ที่นั่น (dev mode)

---

## 📊 สถานะ Sprint 0

### ✅ เสร็จแล้ว

- [x] Next.js 15 + TypeScript + Tailwind
- [x] Prisma + PostgreSQL
- [x] Docker Compose
- [x] Auth.js v5 (email magic link)
- [x] 7 Sprint 0 tables
- [x] Tenant init logic (H.1)
- [x] RLS policies (H.10)
- [x] PermissionService skeleton (H.4)
- [x] Tenant isolation tests

### 📅 Sprint 1 ถัดไป

- [ ] Master Data: Suppliers, Products, Categories
- [ ] Multi-unit system (Section E)
- [ ] Liquid density templates
- [ ] Default category seed (16 หมวด)

---

## 🔗 Documentation อ้างอิง

- **Master Spec v1.4** — [Google Doc](https://docs.google.com/document/d/110FrOwFwzPbXsxDHUC_f-oqK8ld8a6utAKnrs5KLbfc/edit)
- **Changelog v5** — [Google Doc](https://docs.google.com/document/d/1uWxAg2dU7RnyQfHhK5KjLW3L0B3uCuXtsPigeuHCOqg/edit)
- **System Diagrams** — `mise_diagrams.html` (เปิดในเบราว์เซอร์)
- **Schema** — `mise_schema.dbml` (paste ใน dbdiagram.io)

---

## 🌱 ต่อไป

หลัง Sprint 0 ทำงานได้ → push ไป GitHub:

```bash
git add .
git commit -m "Sprint 0: Foundation + Auth + Tenant"
git remote add origin https://github.com/thefirstpig1/mise.git
git branch -M main
git push -u origin main
```

แล้วเริ่ม Sprint 1 (Master Data) ต่อ

---

**Last updated:** May 16, 2026
