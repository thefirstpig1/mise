// Sprint 4 Part 19 L5 — /sales: what was sold, and what the file cannot say.
//
// Server Component. Filters live in the URL (`?branch=&from=&to=&category=`) so
// the view is linkable and `revalidatePath("/sales")` from the L4 write path
// refreshes whatever the user is actually looking at.
//
// The page is organised around the angles the shop's previous spreadsheet
// actually used — total after discount, the category share, the per-menu table,
// discount as a percentage of the pre-discount total — plus the one it could
// never do: **by day of week**, which is the number staffing is planned from.
// That angle is the reason `business_date` is stored as a plain DATE.
//
// The availability notices are not filler. A daily-summary export carries no
// bill and no time, so rather than printing a 0 that reads as "none", the page
// says the file does not contain them (rule P11).
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature
// type-checks under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix).

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getSalesDaysLogic, getSalesSummaryLogic } from "@/server/sales";
import { getMenuCategoriesLogic } from "@/server/menu";
import { getSalesQuerySchema } from "@/lib/validations/sales-import";
import {
  toSalesDayRowView,
  toSalesSummaryView,
} from "./_components/sales-view";

const inputClass =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

const baht = (v: string) =>
  Number(v).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bahtShort = (v: string) => Number(v).toLocaleString("th-TH", { maximumFractionDigits: 0 });

/** Defaults to THIS MONTH, the period a shop actually reviews (the /waste rule). */
function currentMonthBangkok(): { from: string; to: string } {
  const today = computeBangkokToday();
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { from: first.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireTenant();
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const month = currentMonthBangkok();
  const parsed = getSalesQuerySchema.safeParse({
    branchId: one("branch"),
    from: one("from") ?? month.from,
    to: one("to") ?? month.to,
    menuCategoryId: one("category"),
    includeSuperseded: "false",
  });
  const query = parsed.success
    ? parsed.data
    : {
        branchId: undefined,
        from: new Date(`${month.from}T00:00:00.000Z`),
        to: new Date(`${month.to}T00:00:00.000Z`),
        menuCategoryId: undefined,
        includeSuperseded: false,
      };

  const [branches, categories, summaryRaw, daysRaw] = await Promise.all([
    getBranchesLogic(tenantId),
    getMenuCategoriesLogic(tenantId),
    getSalesSummaryLogic(tenantId, query),
    getSalesDaysLogic(tenantId, {
      branchId: query.branchId,
      from: query.from,
      to: query.to,
    }),
  ]);

  const s = toSalesSummaryView(summaryRaw);
  const days = daysRaw.map(toSalesDayRowView);
  const empty = s.totals.rows === 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">ยอดขาย</h2>
        <a href="/sales/import" className="text-sm text-primary hover:underline">
          นำเข้ายอดขาย →
        </a>
      </div>

      {/* ---------- filters ---------- */}
      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <label className="text-sm">
          สาขา
          <select name="branch" defaultValue={one("branch") ?? ""} className={`${inputClass} mt-1 block`}>
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          ตั้งแต่
          <input type="date" name="from" defaultValue={one("from") ?? month.from} className={`${inputClass} mt-1 block`} />
        </label>
        <label className="text-sm">
          ถึง
          <input type="date" name="to" defaultValue={one("to") ?? month.to} className={`${inputClass} mt-1 block`} />
        </label>
        <label className="text-sm">
          หมวดเมนู
          <select name="category" defaultValue={one("category") ?? ""} className={`${inputClass} mt-1 block`}>
            <option value="">ทุกหมวด</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm">
          ดู
        </button>
      </form>

      {empty ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm">
          <p className="font-medium">ยังไม่มียอดขายในช่วงนี้</p>
          <p className="mt-2 text-muted-foreground">
            ยอดขายเข้าระบบด้วยการนำเข้าไฟล์จาก POS — ไฟล์เดียวครอบได้หลายวัน
          </p>
          <a
            href="/sales/import"
            className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            นำเข้ายอดขาย
          </a>
        </div>
      ) : (
        <>
          {/* ---------- totals ---------- */}
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Tile label="ยอดขาย (หลังหักส่วนลด)" value={`฿${baht(s.totals.net)}`} note="ไม่รวม VAT และ Service charge" />
            <Tile label="จำนวนที่ขายได้" value={Number(s.totals.qty).toLocaleString("th-TH")} note={`${s.totals.days} วันที่มีข้อมูล`} />
            <Tile label="ส่วนลดรวม" value={`฿${baht(s.totals.discount)}`} note={`${s.totals.discountPercent}% ของยอดก่อนหัก`} />
            <Tile label="VAT ขาย" value={`฿${baht(s.totals.vat)}`} note={`Service charge ฿${bahtShort(s.totals.serviceCharge)}`} />
          </section>

          {(s.availability.billNotice || s.availability.timeNotice) && (
            <section className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
              {s.availability.billNotice && <p>{s.availability.billNotice}</p>}
              {s.availability.timeNotice && <p className="mt-1">{s.availability.timeNotice}</p>}
            </section>
          )}

          {s.unidentifiedMenuCount > 0 && (
            <section className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
              มีเมนูที่ยังไม่ได้ตรวจ {s.unidentifiedMenuCount} รายการในช่วงนี้ —{" "}
              <a href="/menus?stubs=true" className="text-primary underline">
                ไปจัดการ
              </a>
            </section>
          )}

          {/* ---------- by weekday ---------- */}
          <section>
            <h3 className="text-sm font-medium">วันไหนของสัปดาห์ขายดี</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              เฉลี่ยต่อวัน หารด้วยจำนวนวันนั้นที่มีจริงในช่วง — สามวันจันทร์ไม่ใช่หนึ่งวันจันทร์
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-2 py-1 text-left">วัน</th>
                    <th className="px-2 py-1 text-right">เฉลี่ย/วัน</th>
                    <th className="px-2 py-1 text-right">รวม</th>
                    <th className="px-2 py-1 text-right">จำนวนวัน</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byWeekday.map((w) => (
                    <tr key={w.weekday} className="border-b border-border/50">
                      <td className="px-2 py-1">{w.weekdayLabel}</td>
                      <td className="px-2 py-1 text-right font-medium">฿{baht(w.averageNet)}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground">฿{bahtShort(w.net)}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{w.dayCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---------- by category ---------- */}
          <section>
            <h3 className="text-sm font-medium">สัดส่วนหมวดเมนู</h3>
            <ul className="mt-2 space-y-1">
              {s.byCategory.map((c) => (
                <li key={c.menuCategoryId ?? "none"} className="text-sm">
                  <div className="flex justify-between">
                    <a
                      href={`/sales?${new URLSearchParams({
                        ...(one("branch") ? { branch: one("branch")! } : {}),
                        from: one("from") ?? month.from,
                        to: one("to") ?? month.to,
                        ...(c.menuCategoryId ? { category: c.menuCategoryId } : {}),
                      }).toString()}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </a>
                    <span className="text-muted-foreground">
                      ฿{bahtShort(c.net)} · {c.sharePercent}%
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full rounded bg-border">
                    <div className="h-1.5 rounded bg-primary" style={{ width: `${c.sharePercent}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* ---------- top menus ---------- */}
          <section>
            <h3 className="text-sm font-medium">เมนูทำเงินสูงสุด</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-2 py-1 text-left">เมนู</th>
                    <th className="px-2 py-1 text-left">หมวด</th>
                    <th className="px-2 py-1 text-right">จำนวน</th>
                    <th className="px-2 py-1 text-right">ยอดขาย</th>
                  </tr>
                </thead>
                <tbody>
                  {s.topMenus.map((m) => (
                    <tr key={m.menuId} className="border-b border-border/50">
                      <td className="px-2 py-1">
                        {m.name}
                        {m.isPosStub && (
                          <span className="ml-1 rounded bg-amber-500/20 px-1 text-xs">รอตรวจ</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{m.menuCategoryName ?? "—"}</td>
                      <td className="px-2 py-1 text-right">{Number(m.qty).toLocaleString("th-TH")}</td>
                      <td className="px-2 py-1 text-right font-medium">฿{bahtShort(m.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---------- the days themselves ---------- */}
          <section>
            <h3 className="text-sm font-medium">รายวัน</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              แต่ละวันมาจากไฟล์ไหน — อัปไฟล์ทับวันเดิมได้ ระบบจะแทนที่ทั้งวัน ·
              ตัวเลขในวงเล็บคือ <strong>ยอดจากไฟล์ − ยอดที่คีย์ตอนปิดร้าน</strong> (เทียบยอดที่ลูกค้าจ่ายทั้งคู่)
              ติดลบแปลว่าไฟล์ได้น้อยกว่าที่เครื่องเก็บเงินบอก มักแปลว่า export มาไม่ครบทั้งวัน
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-2 py-1 text-left">วันที่</th>
                    <th className="px-2 py-1 text-right">ยอดขาย</th>
                    <th className="px-2 py-1 text-right">รายการ</th>
                    <th className="px-2 py-1 text-right">ยอดที่คีย์ตอนปิดร้าน</th>
                    <th className="px-2 py-1 text-left">ที่มา</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.businessDate} className="border-b border-border/50">
                      <td className="px-2 py-1">
                        {d.dayLabel} <span className="text-muted-foreground">({d.weekdayLabel})</span>
                      </td>
                      <td className="px-2 py-1 text-right font-medium">฿{bahtShort(d.net)}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{d.rows}</td>
                      <td className="px-2 py-1 text-right">
                        {d.pulseAmount === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <span>฿{bahtShort(d.pulseAmount)}</span>
                            {d.pulseDifference !== null && (
                              <span
                                className={`ml-1 text-xs ${d.pulseIsMismatch ? "font-medium text-red-700" : "text-muted-foreground"}`}
                              >
                                ({Number(d.pulseDifference) >= 0 ? "+" : ""}
                                {bahtShort(d.pulseDifference)})
                              </span>
                            )}
                          </>
                        )}
                        {d.pulseNote && (
                          <span className="block text-[10px] text-muted-foreground">
                            “{d.pulseNote}”
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">{d.sourceLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
