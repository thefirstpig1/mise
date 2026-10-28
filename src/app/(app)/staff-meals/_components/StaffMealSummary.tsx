"use client";

// ============================================================
// Mise — สรุป: who ate how much this month (Kong 2026-10-28)
// ============================================================
// Mockup RkKwhwCmh4akz2QvgeMcis. Four questions a manager asks of staff meals:
// what did they cost (the ingredients, FIFO — kept apart from food cost so it
// reads as a staff benefit), how big is that against sales, who ate how much,
// and who keeps going over the quota. Selling-price value is shown beside cost
// and labelled for what it is: the quota's yardstick, not money spent.
// A person's row narrows the list below to that person.
// ============================================================

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import Stat, { StatGrid } from "@/components/ui/Stat";
import { readApi } from "@/lib/read-api";
import type { StaffMealSummaryResult } from "../summary-read";

/** Small shares keep their digits: 0.05% must not read as 0.0%. */
const pct = (v: number) => `${v.toFixed(v < 0.1 ? 2 : 1)}%`;
const baht = (v: number) => `฿${Math.round(v).toLocaleString("th-TH")}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "UTC" });
};
const lastMonths = (end: string, n: number) => {
  const [y, m] = end.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
};

export default function StaffMealSummary({
  todayIso,
  branches,
}: {
  todayIso: string;
  branches: { id: string; name: string }[];
}) {
  const months = lastMonths(todayIso.slice(0, 7), 3);
  const [month, setMonth] = useState(months[months.length - 1]);
  const [branchId, setBranchId] = useState("");
  const [res, setRes] = useState<{ key: string; r: StaffMealSummaryResult } | null>(null);
  const key = `${month}|${branchId}`;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startNav] = useTransition();

  useEffect(() => {
    let live = true;
    void readApi<StaffMealSummaryResult>("/api/staff-meals", "summary", { month, branchId: branchId || undefined }).then(
      (r) => live && setRes({ key, r })
    );
    return () => {
      live = false;
    };
  }, [key, month, branchId]);

  const r = res?.r;
  const stale = res?.key !== key;
  const s = r && r.ok ? r.summary : null;
  const potShare = s && s.cost ? (s.people.find((p) => p.staffMemberId === null)?.cost ?? 0) / s.cost : null;
  const worst = s?.people.filter((p) => (p.overQuotaDays ?? 0) > 0).sort((a, b) => (b.overQuotaDays ?? 0) - (a.overQuotaDays ?? 0))[0];
  const maxDay = s ? Math.max(1, ...s.costByDay.map((d) => d.cost)) : 1;

  const showPerson = (id: string | null) => {
    if (!id) return;
    const q = new URLSearchParams(params.toString());
    q.set("member", id);
    q.set("tab", "summary");
    startNav(() => router.push(`${pathname}?${q}#meal-list` as Route, { scroll: false }));
  };

  return (
    <div className={`space-y-4 transition-opacity ${stale && res ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="seg">
          {months.map((m) => (
            <button key={m} type="button" onClick={() => setMonth(m)} className={`seg-item ${m === month ? "is-on" : ""}`}>
              {monthLabel(m)}
            </button>
          ))}
        </div>
        {branches.length > 1 && (
          <div className="seg">
            <button type="button" onClick={() => setBranchId("")} className={`seg-item ${branchId === "" ? "is-on" : ""}`}>
              ทุกสาขา
            </button>
            {branches.map((b) => (
              <button key={b.id} type="button" onClick={() => setBranchId(b.id)} className={`seg-item ${branchId === b.id ? "is-on" : ""}`}>
                {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {!r ? (
        <div aria-busy className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[92px] animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
          <div className="h-48 animate-pulse rounded-2xl bg-muted" />
        </div>
      ) : !r.ok ? (
        <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted-foreground">{r.formError}</p>
      ) : s && s.meals === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">
          ยังไม่มีมื้อพนักงานที่อนุมัติแล้วใน {monthLabel(month)}
        </div>
      ) : (
        s && (
          <>
            <StatGrid>
              <Stat
                label="ต้นทุนจริง (วัตถุดิบ)"
                value={s.cost === null ? "—" : baht(s.cost)}
                sub={s.cost === null ? "เห็นเฉพาะคนที่ดูต้นทุนได้" : `${baht(s.cost / Math.max(1, s.days))} ต่อวันที่มีมื้อ`}
              />
              <Stat
                label="คิดเป็นของยอดขาย"
                value={s.cost === null || r.sales === null || r.sales === 0 ? "—" : pct((s.cost / r.sales) * 100)}
                sub={r.sales === null ? "เห็นเฉพาะคนที่ดูยอดขายได้" : r.sales === 0 ? `ยังไม่มียอดขาย ${monthLabel(month)}` : `ต้นทุนมื้อพนักงาน ÷ ยอดขาย ${monthLabel(month)}`}
              />
              <Stat label="จำนวนมื้อ" value={`${s.meals} มื้อ`} sub={`${(s.meals / Math.max(1, s.days)).toFixed(1)} มื้อต่อวัน · ${s.days} วันที่มีมื้อ`} />
              <Stat label="มูลค่าตามราคาขาย" value={baht(s.value)} sub="ใช้เทียบโควตา ไม่ใช่ต้นทุน" />
            </StatGrid>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-2">
                <h3 className="text-base font-semibold">รายคน</h3>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>พนักงาน</th>
                        <th className="text-right">มื้อ</th>
                        <th className="text-right">ตามราคาขาย</th>
                        <th className="text-right">วันที่เกินโควตา</th>
                        {r.canSeeCost && <th className="text-right">ต้นทุนจริง</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {s.people.map((p) => (
                        <tr
                          key={p.staffMemberId ?? "pot"}
                          onClick={() => showPerson(p.staffMemberId)}
                          className={p.staffMemberId ? "cursor-pointer transition-colors hover:bg-surface-sunk" : ""}
                        >
                          <td>
                            <span className="font-semibold">{p.name}</span>
                            <div className="text-xs text-muted-foreground">{p.staffMemberId ? p.branchName : "ทำกินเองจากของในร้าน"}</div>
                          </td>
                          <td className="text-right tabular-nums">{p.meals}</td>
                          <td className="text-right tabular-nums">
                            {p.staffMemberId === null ? "—" : baht(p.value)}
                            {p.unpriced > 0 && <div className="text-xs text-muted-foreground">อีก {p.unpriced} มื้อไม่มีราคา</div>}
                          </td>
                          <td className="text-right">
                            {p.overQuotaDays === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : p.overQuotaDays > 0 ? (
                              <span className="chip chip-warn">{p.overQuotaDays} วัน</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">0</span>
                            )}
                          </td>
                          {r.canSeeCost && <td className="text-right tabular-nums">{p.cost === null ? "—" : baht(p.cost)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">กดชื่อเพื่อดูรายมื้อของคนนั้นด้านล่าง · “—” ในวันที่เกินโควตา = ร้านยังไม่ได้ตั้งโควตา</p>
              </div>

              <div className="min-w-0 space-y-3">
                {r.canSeeCost && (
                  <div className="space-y-1.5">
                    <h3 className="text-base font-semibold">ต้นทุนรายวัน</h3>
                    <div className="flex h-28 items-end gap-1 rounded-xl border border-border bg-surface px-2 pt-2" aria-label="ต้นทุนมื้อพนักงานรายวัน">
                      {Array.from({ length: r.days }, (_, i) => {
                        const day = `${month}-${String(i + 1).padStart(2, "0")}`;
                        const c = s.costByDay.find((d) => d.day === day)?.cost ?? null;
                        const top = c !== null && c === maxDay;
                        return (
                          <span
                            key={day}
                            title={`${i + 1} ${monthLabel(month)} · ${c === null ? "ไม่มีมื้อ" : baht(c)}`}
                            className={`flex-1 origin-bottom rounded-t ${c === null ? "h-px border-b border-dotted border-border-strong" : top ? "bg-gradient-to-b from-[#C0692B] to-[#E8A76F]" : "bg-gradient-to-b from-[#5E6B14] to-[#9DAA55]"}`}
                            style={c === null ? undefined : { height: `${Math.max(4, (c / maxDay) * 100)}%` }}
                          />
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">เส้นประ = วันที่ไม่มีมื้อ · แท่งสีส้มอิฐ = วันที่สูงสุด</p>
                  </div>
                )}
                <div className="space-y-1 rounded-xl border border-border bg-surface p-3.5 text-sm">
                  <p className="font-display font-semibold">ที่ควรดู</p>
                  {worst ? <p>• {worst.name} เกินโควตา {worst.overQuotaDays} วัน</p> : <p className="text-muted-foreground">• ไม่มีใครเกินโควตา</p>}
                  {potShare !== null && potShare > 0 && <p>• หม้อใหญ่ {(potShare * 100).toFixed(0)}% ของต้นทุนทั้งหมด</p>}
                  <p className={s.rejected || s.voided ? "" : "text-muted-foreground"}>
                    • ไม่อนุมัติ {s.rejected} ตั๋ว · ยกเลิกหลังบันทึก {s.voided} ตั๋ว
                  </p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              ต้นทุนจริง = ราคาวัตถุดิบที่ตัดออกจากสต๊อกจริง (FIFO) · นับเฉพาะมื้อที่อนุมัติแล้วและไม่ได้ยกเลิก · ใช้ดูเป็นค่าสวัสดิการพนักงาน แยกจากต้นทุนอาหารที่ขาย
            </p>
          </>
        )
      )}
    </div>
  );
}
