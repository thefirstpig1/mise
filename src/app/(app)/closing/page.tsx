// /closing — ปิดร้านย้อนหลัง, one branch, one month (ADR 0042). Customers a
// day, per head, cash short/over, issues still open, and the customer-type
// estimate weighted by each day's guests. Money only for sales:view (Q7).
// A row opens that day's sheet.
//
// `searchParams` is a PROMISE in Next 15.

import { requireTenant } from "@/lib/require-tenant";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic, liveliestBranchId } from "@/server/branch";
import { getDailyCloseMonthLogic } from "@/server/daily-close";
import MonthInsight from "./_components/MonthInsight";
import { mixShares } from "@/lib/closing-insight";
import FilterLink from "@/components/ui/FilterLink";

const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const monthTh = (k: string) => `${MTH[+k.slice(5, 7) - 1]} ${String((+k.slice(0, 4) + 543) % 100).padStart(2, "0")}`;
const baht = (n: number, d = 0) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export default async function ClosingMonthPage({ searchParams }: { searchParams: Promise<{ branch?: string; m?: string }> }) {
  const { tenantId, reach, can, membership } = await requireTenant("any:member");
  const sp = await searchParams;
  const branches = await getBranchesLogic(tenantId, reach);
  if (branches.length === 0) return <div className="p-6 text-sm">ยังไม่มีสาขาในระบบ</div>;
  const fallback = sp.branch ? undefined : await liveliestBranchId(tenantId, branches.map((b) => b.id));
  const branch = branches.find((b) => b.id === sp.branch) ?? branches.find((b) => b.id === fallback) ?? branches[0];

  const today = computeBangkokToday();
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const m = sp.m && months.includes(sp.m) ? sp.m : months[0];
  const from = new Date(`${m}-01T00:00:00Z`);
  const end = addDays(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)), -1);
  const to = end.getTime() > today.getTime() ? today : end;
  // The month on screen plus every month in the chips: the mix trend and the
  // comparison with the month before both come from the same read.
  const monthRange = (k: string) => {
    const f = new Date(`${k}-01T00:00:00Z`);
    const e = addDays(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1)), -1);
    return { f, t: e.getTime() > today.getTime() ? today : e };
  };
  const prevKey = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const trendKeys = [...months].reverse();
  const [data, trendData, prevData] = await Promise.all([
    getDailyCloseMonthLogic(tenantId, branch.id, from, to),
    Promise.all(trendKeys.map((k) => getDailyCloseMonthLogic(tenantId, branch.id, monthRange(k).f, monthRange(k).t))),
    getDailyCloseMonthLogic(tenantId, branch.id, monthRange(prevKey).f, monthRange(prevKey).t),
  ]);
  const asMix = (rows: typeof data.rows) => rows.map((r) => ({ date: r.date, guests: r.guestCount, netRevenue: r.netRevenue, plates: r.plates, mix: r.mix }));
  const trend = trendKeys.map((k, i) => ({ label: monthTh(k), ...(() => { const f = mixShares(asMix(trendData[i].rows)); return { shares: f.shares, days: f.days }; })() }));

  const enabled = membership.tenant.dailyCloseEnabled;
  const seeMoney = can("sales:view");
  const withGuests = data.rows.filter((r) => r.guestCount !== null);
  const avgGuests = withGuests.length ? withGuests.reduce((t, r) => t + r.guestCount!, 0) / withGuests.length : null;
  const perHeadRows = data.rows.filter((r) => r.perHead !== null);
  const perHead = perHeadRows.length
    ? perHeadRows.reduce((t, r) => t + r.netRevenue!, 0) / perHeadRows.reduce((t, r) => t + r.guestCount!, 0)
    : null;
  const cashRows = data.rows.filter((r) => r.cashDiff !== null);
  const cashTotal = cashRows.reduce((t, r) => t + r.cashDiff!, 0);
  const shortDays = cashRows.filter((r) => r.cashDiff! < 0).length;
  const overDays = cashRows.filter((r) => r.cashDiff! > 0).length;
  const open = data.rows.reduce((t, r) => t + r.issuesOpen, 0);
  const allIssues = data.rows.reduce((t, r) => t + r.issuesOpen + r.issuesResolved + r.issuesNoted, 0);
  const missing = data.rows.filter((r) => !r.closed && r.netRevenue !== null).length;
  // The month before, per day / per head (rule SI1), for the two customer cards.
  const pg = prevData.rows.filter((r) => r.guestCount !== null);
  const prevGuests = pg.length ? pg.reduce((t, r) => t + r.guestCount!, 0) / pg.length : null;
  const ph = prevData.rows.filter((r) => r.perHead !== null);
  const prevHead = ph.length ? ph.reduce((t, r) => t + r.netRevenue!, 0) / ph.reduce((t, r) => t + r.guestCount!, 0) : null;
  const vsLabel = monthTh(prevKey);
  const order = data.mix.map((x) => x.customerTypeId);
  const dayLink = (date: string) => `/closing/day?branch=${branch.id}&date=${date}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">ปิดร้านประจำวัน</h2>
          <p className="mt-1 text-sm text-muted-foreground">ลูกค้า เงินสด ปัญหา และความเห็นของแต่ละวัน — ย้อนดูได้ไม่จำกัด</p>
        </div>
        {enabled && can("sales:import") && (
          <a href={dayLink(today.toISOString().slice(0, 10))} className="btn">
            ปิดร้านวันนี้
          </a>
        )}
      </div>

      {!enabled && (
        <p className="rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
          ร้านยังไม่ได้เปิดใช้รายงานปิดร้าน — ใบเก่าที่เคยบันทึกยังอ่านได้{can("settings:write") ? " · เปิดใช้ได้ที่ " : ""}
          {can("settings:write") && (
            <a href="/settings#daily-close" className="underline">
              ตั้งค่าร้าน
            </a>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {branches.length > 1 &&
          branches.map((b) => (
            <FilterLink
              key={b.id}
              href={`/closing?branch=${b.id}&m=${m}`}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${b.id === branch.id ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"}`}
            >
              {b.name}
            </FilterLink>
          ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {[...months].reverse().map((k) => (
          <FilterLink
            key={k}
            href={`/closing?branch=${branch.id}&m=${k}`}
            className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${k === m ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"}`}
          >
            {monthTh(k)}
          </FilterLink>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-3.5">
          <span className="text-xs text-muted-subtle">ลูกค้าต่อวัน</span>
          <b className="block font-display text-2xl tabular-nums">{avgGuests === null ? "—" : Math.round(avgGuests).toLocaleString("th-TH")}</b>
          <span className="text-xs text-muted-subtle">{withGuests.length ? `เฉลี่ย ${withGuests.length} วันที่มีจำนวนลูกค้า` : "ยังไม่มีวันที่กรอกจำนวนลูกค้า"}</span>
          {avgGuests !== null && prevGuests !== null && (
            <span className={`text-xs ${avgGuests >= prevGuests ? "text-good" : "text-bad"}`}>
              {avgGuests >= prevGuests ? "▲" : "▼"} {Math.abs(Math.round(avgGuests - prevGuests)).toLocaleString("th-TH")} คน/วัน เทียบ {vsLabel}
            </span>
          )}
        </div>
        {seeMoney && (
          <div className="rounded-2xl border border-border bg-surface p-3.5">
            <span className="text-xs text-muted-subtle">ต่อหัว</span>
            <b className="block font-display text-2xl tabular-nums">{perHead === null ? "—" : baht(perHead, 1)}</b>
            <span className="text-xs text-muted-subtle">ยอดขาย ÷ ลูกค้า ของวันที่มีทั้งสองอย่าง</span>
            {perHead !== null && prevHead !== null && (
              <span className={`text-xs ${perHead >= prevHead ? "text-good" : "text-bad"}`}>
                {perHead >= prevHead ? "▲" : "▼"} {baht(Math.abs(perHead - prevHead), 0)} เทียบ {vsLabel}
              </span>
            )}
          </div>
        )}
        {seeMoney && (
          <div className="rounded-2xl border border-border bg-surface p-3.5">
            <span className="text-xs text-muted-subtle">เงินขาด/เกินสะสม</span>
            <b className={`block font-display text-2xl tabular-nums ${cashTotal < 0 ? "text-bad" : ""}`}>
              {cashRows.length === 0 ? "—" : cashTotal === 0 ? "ตรง" : cashTotal < 0 ? `ขาด ${baht(-cashTotal, 2)}` : `เกิน ${baht(cashTotal, 2)}`}
            </b>
            <span className="text-xs text-muted-subtle">{cashRows.length ? `ขาด ${shortDays} วัน · เกิน ${overDays} วัน · จาก ${cashRows.length} วันที่นับ` : "ยังไม่มีวันที่นับเงินครบ"}</span>
          </div>
        )}
        <div className="rounded-2xl border border-border bg-surface p-3.5">
          <span className="text-xs text-muted-subtle">ปัญหาที่ยังค้าง</span>
          <b className={`block font-display text-2xl tabular-nums ${open > 0 ? "text-bad" : ""}`}>{open}</b>
          <span className="text-xs text-muted-subtle">จาก {allIssues} ที่บันทึกเดือนนี้</span>
        </div>
      </div>

      <MonthInsight
        days={asMix(data.rows)}
        types={data.types}
        branchId={branch.id}
        monthLabel={monthTh(m)}
        seeMoney={seeMoney}
        trend={trend}
      />

      {missing > 0 && <p className="text-xs text-muted-subtle">มียอดขายแต่ไม่ได้ปิดร้าน {missing} วัน · วันหรือช่องที่ไม่ได้กรอก แสดง “—” ไม่ใช่ 0</p>}

      {data.rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-muted/30 p-6 text-sm text-muted-foreground">ยังไม่มีข้อมูลของเดือนนี้</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">วัน</th>
                {seeMoney && <th className="px-3 py-2 text-right font-medium">ยอดขาย</th>}
                <th className="px-3 py-2 text-right font-medium">ลูกค้า</th>
                {seeMoney && <th className="px-3 py-2 text-right font-medium">ต่อหัว</th>}
                {seeMoney && <th className="px-3 py-2 text-right font-medium">เงินสด</th>}
                <th className="px-3 py-2 font-medium">ปัญหา</th>
                <th className="px-3 py-2 text-right font-medium">ความเห็น</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => {
                const d = new Date(`${r.date}T00:00:00Z`);
                return (
                  <tr key={r.date} className="group relative hover:bg-muted/50">
                    <td className="px-3 py-2">
                      <a href={dayLink(r.date)} className="after:absolute after:inset-0 after:content-['']">
                        {WD[d.getUTCDay()]} {d.getUTCDate()}
                      </a>
                      {!r.closed && <span className="ml-1.5 text-xs text-muted-subtle">ไม่ได้ปิดร้าน</span>}
                    </td>
                    {seeMoney && <td className="px-3 py-2 text-right tabular-nums">{r.netRevenue === null ? "—" : r.netRevenue.toLocaleString("th-TH")}</td>}
                    <td className="px-3 py-2 text-right tabular-nums">{r.guestCount ?? "—"}</td>
                    {seeMoney && <td className="px-3 py-2 text-right tabular-nums">{r.perHead === null ? "—" : r.perHead.toFixed(1)}</td>}
                    {seeMoney && (
                      <td className={`px-3 py-2 text-right tabular-nums ${r.cashDiff === null ? "" : r.cashDiff < 0 ? "text-bad" : r.cashDiff > 0 ? "text-good" : ""}`}>
                        {r.cashDiff === null ? "—" : r.cashDiff === 0 ? "ตรง" : `${r.cashDiff > 0 ? "+" : "−"}${Math.abs(r.cashDiff).toLocaleString("th-TH")}`}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {r.issuesOpen > 0 && <span className="whitespace-nowrap rounded-full bg-bad-bg px-2 py-0.5 text-[11px] text-bad">ค้าง {r.issuesOpen}</span>}
                        {r.issuesResolved > 0 && <span className="whitespace-nowrap rounded-full bg-good-bg px-2 py-0.5 text-[11px] text-good">จัดการแล้ว {r.issuesResolved}</span>}
                        {r.issuesNoted > 0 && <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">จดไว้ {r.issuesNoted}</span>}
                        {r.issuesOpen + r.issuesResolved + r.issuesNoted === 0 && <span className="text-xs text-muted-subtle">—</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.comments || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
