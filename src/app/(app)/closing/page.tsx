// /closing — ปิดร้านย้อนหลัง, one branch, one month (ADR 0042). Customers a
// day, per head, cash short/over, issues still open, and the customer-type
// estimate weighted by each day's guests. Money only for sales:view (Q7).
// A row opens that day's sheet.
//
// `searchParams` is a PROMISE in Next 15.

import { requireTenant } from "@/lib/require-tenant";
import PageHelp from "@/components/ui/PageHelp";
import EmptyTable from "@/components/ui/EmptyTable";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic, liveliestBranchId } from "@/server/branch";
import { getDailyCloseMonthLogic } from "@/server/daily-close";
import MonthInsight from "./_components/MonthInsight";
import { mixShares } from "@/lib/closing-insight";
import FilterLink from "@/components/ui/FilterLink";
import PillScroller from "@/components/ui/PillScroller";
import Stat, { StatGrid } from "@/components/ui/Stat";
import { Banknote, CircleAlert, UserRound, Users } from "lucide-react";
type DayRow = Awaited<ReturnType<typeof getDailyCloseMonthLogic>>["rows"][number];

/** A day's issues as the kit's chips; a day nobody closed says so. */
function IssueChips({ r, closed }: { r: DayRow; closed: boolean }) {
  if (!closed) return <span className="chip shrink-0">ไม่ได้ปิดร้าน</span>;
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-1">
      {r.issuesOpen > 0 && <span className="chip chip-bad">ค้าง {r.issuesOpen}</span>}
      {r.issuesResolved > 0 && <span className="chip chip-good">จัดการแล้ว {r.issuesResolved}</span>}
      {r.issuesNoted > 0 && <span className="chip">จดไว้ {r.issuesNoted}</span>}
    </span>
  );
}

const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const monthTh = (k: string) => `${MTH[+k.slice(5, 7) - 1]} ${String((+k.slice(0, 4) + 543) % 100).padStart(2, "0")}`;
const dayTh = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MTH[d.getUTCMonth()]}`;
};
const cashTh = (v: number) => (v === 0 ? "ตรง" : v < 0 ? `ขาด ${baht(-v, 0)}` : `เกิน ${baht(v, 0)}`);
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
  const canFill = enabled && can("sales:import");
  const dayLink = (date: string) => `/closing/day?branch=${branch.id}&date=${date}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
          <h1 className="page-title">ปิดร้านประจำวัน</h1>
          <PageHelp page="closing" />
        </div>
          <p className="mt-1 text-sm text-muted-foreground">ลูกค้า เงินสด ปัญหา และความเห็นของแต่ละวัน — ย้อนดูได้ไม่จำกัด</p>
        </div>
        {canFill && (
          <a href={dayLink(today.toISOString().slice(0, 10))} className="btn">
            ปิดร้านวันนี้
          </a>
        )}
      </div>

      {!enabled && (
        <p className="rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
          ร้านยังไม่ได้เปิดใช้รายงานปิดร้าน — ใบเก่าที่เคยบันทึกยังอ่านได้{can("settings:write") ? " · เปิดใช้ได้ที่ " : ""}
          {can("settings:write") && (
            <a href="/settings#daily-close" className="link">
              ตั้งค่าทั่วไป
            </a>
          )}
        </p>
      )}

      {/* Queue item 9: on a phone the branch pills and six month pills broke
          into two rows. Branches are one switch; months are one line that
          scrolls sideways, opened at the month on screen. */}
      <div data-help="closing-filters" className="flex flex-wrap items-center gap-2">
        {branches.length > 1 && (
          <PillScroller className="w-full sm:w-auto">
            <div className="seg flex-none">
              {branches.map((b) => (
                <FilterLink key={b.id} href={`/closing?branch=${b.id}&m=${m}`} aria-current={b.id === branch.id ? "true" : undefined} className={`seg-item ${b.id === branch.id ? "is-on" : ""}`}>
                  {b.name}
                </FilterLink>
              ))}
            </div>
          </PillScroller>
        )}
        <PillScroller className="w-full sm:w-auto">
          {[...months].reverse().map((k) => (
            <FilterLink key={k} href={`/closing?branch=${branch.id}&m=${k}`} aria-current={k === m ? "true" : undefined} className={`pill shrink-0 ${k === m ? "is-on" : ""}`}>
              {monthTh(k)}
            </FilterLink>
          ))}
        </PillScroller>
      </div>

      <StatGrid help="closing-kpis" className={seeMoney ? "" : "lg:grid-cols-2"}>
        <Stat
          icon={Users}
          label="ลูกค้าต่อวัน"
          value={avgGuests === null ? "—" : Math.round(avgGuests).toLocaleString("th-TH")}
          sub={
            <>
              <span className="block">{withGuests.length ? `เฉลี่ย ${withGuests.length} วันที่มีจำนวนลูกค้า` : "ยังไม่มีวันที่กรอกจำนวนลูกค้า"}</span>
              {avgGuests !== null && prevGuests !== null && (
                <span className={`block ${avgGuests >= prevGuests ? "text-good" : "text-bad"}`}>
                  {avgGuests >= prevGuests ? "▲" : "▼"} {Math.abs(Math.round(avgGuests - prevGuests)).toLocaleString("th-TH")} คน/วัน เทียบ {vsLabel}
                </span>
              )}
            </>
          }
        />
        {seeMoney && (
          <Stat
            icon={UserRound}
            label="ต่อหัว"
            value={perHead === null ? "—" : baht(perHead, 1)}
            sub={
              <>
                {/* Queue item 10: "—" with its reason. */}
                <span className="block">
                  {perHead === null
                    ? withGuests.length === 0
                      ? "คิดได้เมื่อมีวันที่กรอกจำนวนลูกค้า"
                      : "ยังไม่มีวันที่มีทั้งยอดขายและจำนวนลูกค้า"
                    : "ยอดขาย ÷ ลูกค้า ของวันที่มีทั้งสองอย่าง"}
                </span>
                {perHead !== null && prevHead !== null && (
                  <span className={`block ${perHead >= prevHead ? "text-good" : "text-bad"}`}>
                    {perHead >= prevHead ? "▲" : "▼"} {baht(Math.abs(perHead - prevHead), 0)} เทียบ {vsLabel}
                  </span>
                )}
              </>
            }
          />
        )}
        {seeMoney && (
          <Stat
            icon={Banknote}
            label="เงินขาด/เกินสะสม"
            tone={cashTotal < 0 ? "bad" : undefined}
            value={cashRows.length === 0 ? "—" : cashTotal === 0 ? "ตรง" : cashTotal < 0 ? `ขาด ${baht(-cashTotal, 2)}` : `เกิน ${baht(cashTotal, 2)}`}
            sub={cashRows.length ? `ขาด ${shortDays} วัน · เกิน ${overDays} วัน · จาก ${cashRows.length} วันที่นับ` : "ยังไม่มีวันที่นับเงินครบ"}
          />
        )}
        {/* Queue item 10: "0 จาก 0" said nothing — nothing was recorded. */}
        <Stat
          icon={CircleAlert}
          label="ปัญหาที่ยังค้าง"
          tone={open > 0 ? "bad" : undefined}
          value={allIssues === 0 ? "—" : open}
          sub={allIssues === 0 ? "ยังไม่มีปัญหาที่บันทึกเดือนนี้" : `จาก ${allIssues} ที่บันทึกเดือนนี้`}
        />
      </StatGrid>

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
        <EmptyTable help="closing-days"
          label="ตารางปิดร้านรายวัน"
          columns={[
            { label: "วัน" },
            ...(seeMoney ? [{ label: "ยอดขาย", right: true }] : []),
            { label: "ลูกค้า", right: true },
            ...(seeMoney ? [{ label: "ต่อหัว", right: true, hide: "sm" as const }, { label: "เงินสด", right: true, hide: "sm" as const }] : []),
            { label: "ปัญหา", hide: "md" },
            { label: "ความเห็น", right: true, hide: "md" },
          ]}
        >
          ยังไม่มีข้อมูลของเดือนนี้
        </EmptyTable>
      ) : (
        <div data-help="closing-days">
          {/* Queue item 9: a phone read seven columns through a sideways scroll
              and saw three. Each day is a card; what was not filled in is left
              out of it rather than shown as 0. The whole card opens the day. */}
          <ul className="space-y-2 sm:hidden">
            {data.rows.map((r) => {
              const meta = r.closed
                ? [
                    r.guestCount !== null ? `ลูกค้า ${r.guestCount.toLocaleString("th-TH")}` : null,
                    seeMoney && r.perHead !== null ? `ต่อหัว ${baht(r.perHead, 0)}` : null,
                    seeMoney && r.cashDiff !== null ? `เงินสด ${cashTh(r.cashDiff)}` : null,
                    r.comments > 0 ? `ความเห็น ${r.comments}` : null,
                  ].filter(Boolean)
                : [];
              return (
                <li key={r.date}>
                  <a href={dayLink(r.date)} className="block rounded-[18px] border border-border/70 bg-surface p-3.5 shadow-card transition-colors hover:bg-surface-sunk">
                    <span className="flex items-baseline justify-between gap-3">
                      <b className="font-display font-semibold">{dayTh(r.date)}</b>
                      {seeMoney && <span className="font-display font-semibold tabular-nums">{r.netRevenue === null ? "—" : baht(r.netRevenue)}</span>}
                    </span>
                    <span className="mt-1 flex items-start justify-between gap-3">
                      <span className="min-w-0 text-xs text-muted-foreground">
                        {/* "วันนี้" on a past day read as today; the chip already says it was not closed. */}
                        {!r.closed ? (canFill ? "กดเพื่อปิดร้านย้อนหลัง" : "ไม่มีใบปิดร้านของวันนั้น") : meta.length > 0 ? meta.join(" · ") : "ปิดร้านแล้ว"}
                      </span>
                      <IssueChips r={r} closed={r.closed} />
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          <div className="data-table hidden sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th>วัน</th>
                  {seeMoney && <th className="text-right">ยอดขาย</th>}
                  <th className="text-right">ลูกค้า</th>
                  {seeMoney && <th className="text-right">ต่อหัว</th>}
                  {seeMoney && <th className="text-right">เงินสด</th>}
                  <th>ปัญหา</th>
                  <th className="text-right">ความเห็น</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.date} className="group relative hover:bg-muted/50">
                    <td>
                      <a href={dayLink(r.date)} className="after:absolute after:inset-0 after:content-['']">
                        {dayTh(r.date)}
                      </a>
                      {!r.closed && <span className="ml-1.5 text-xs text-muted-subtle">ไม่ได้ปิดร้าน</span>}
                    </td>
                    {seeMoney && <td className="text-right tabular-nums">{r.netRevenue === null ? "—" : r.netRevenue.toLocaleString("th-TH")}</td>}
                    <td className="text-right tabular-nums">{r.guestCount ?? "—"}</td>
                    {seeMoney && <td className="text-right tabular-nums">{r.perHead === null ? "—" : r.perHead.toFixed(1)}</td>}
                    {seeMoney && (
                      <td className={`px-3 py-2 text-right tabular-nums ${r.cashDiff === null ? "" : r.cashDiff < 0 ? "text-bad" : r.cashDiff > 0 ? "text-good" : ""}`}>
                        {r.cashDiff === null ? "—" : r.cashDiff === 0 ? "ตรง" : `${r.cashDiff > 0 ? "+" : "−"}${Math.abs(r.cashDiff).toLocaleString("th-TH")}`}
                      </td>
                    )}
                    <td>
                      {/* The dash reads like every other empty cell. */}
                      {r.issuesOpen + r.issuesResolved + r.issuesNoted === 0 ? "—" : <IssueChips r={r} closed />}
                    </td>
                    <td className="text-right tabular-nums">{r.comments || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
