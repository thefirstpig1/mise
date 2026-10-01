// Sprint 5 Part 24 L5c — /menus/coverage: which dish should get a recipe first?
//
// REBUILT 2026-10-01. The original page was written on the Windows machine and
// never reached git: `.gitignore` carried `coverage/` (meant for the test
// coverage report at the repo root) and it matched this folder too. It is
// rebuilt here from what git did keep — `getRecipeCoverageLogic` and its tests,
// ADR 0025 Q5 and the L5c line in sprint-progress:
//
//   - the ordering IS the answer: menus with no recipe, ranked by REVENUE;
//   - no 0% for a period that earned nothing — the headline is "—" and says why;
//   - nothing grouped, hidden or merged — a similarity score suggests, a person
//     decides (ADR 0019);
//   - an absent duplicate hint means "not looked at", never "no duplicate".
//
// Rule A5: "ทุกสาขา" exists only for someone who reaches every branch, because
// the coverage read itself does not narrow by reach.

import type { Route } from "next";
import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getRecipeCoverageLogic } from "@/server/menu-lab-read";
import { recipeCoverageQuerySchema } from "@/lib/validations/menu-lab";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { periodLabelTh } from "@/lib/sales-insight";
import EmptyState from "@/components/ui/EmptyState";

const WINDOWS = [
  { key: "7", days: 7, label: "7 วัน" },
  { key: "30", days: 30, label: "30 วัน" },
  { key: "90", days: 90, label: "90 วัน" },
] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const baht = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;
const num = (d: { toString(): string }) => Number(d.toString());

export default async function RecipeCoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; w?: string }>;
}) {
  const { tenantId, reach, can } = await requireTenant("sales:view");
  const sp = await searchParams;
  const canWrite = can("recipe:write");

  const win = WINDOWS.find((w) => w.key === sp.w) ?? WINDOWS[1];
  const to = computeBangkokToday();
  const from = addDays(to, -(win.days - 1));

  const branches = await getBranchesLogic(tenantId, reach);
  if (branches.length === 0) {
    return <EmptyState art="setup">คุณยังไม่มีสาขาที่ดูได้ — โปรดติดต่อเจ้าของร้าน</EmptyState>;
  }
  // A branch id from the URL is never trusted: it must be one this person reaches.
  const picked = branches.find((b) => b.id === sp.branch);
  const branchId = picked?.id ?? (reach.allBranches ? undefined : branches[0].id);

  const cov = await getRecipeCoverageLogic(
    tenantId,
    recipeCoverageQuerySchema.parse({ branchId, from: iso(from), to: iso(to), limit: 100 })
  );

  const href = (next: { branch?: string; w?: string }) => {
    const q = new URLSearchParams();
    const b = "branch" in next ? next.branch : branchId;
    const w = next.w ?? win.key;
    if (b) q.set("branch", b);
    if (w !== "30") q.set("w", w);
    const s = q.toString();
    return (s ? `/menus/coverage?${s}` : "/menus/coverage") as Route;
  };
  const pill = (active: boolean) =>
    `whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors ${
      active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"
    }`;

  const total = num(cov.totalRevenue);
  const covered = num(cov.coveredRevenue);
  const uncovered = num(cov.uncoveredRevenue);
  const pct = cov.coveragePercent === null ? null : num(cov.coveragePercent);
  const periodTh = periodLabelTh(iso(from), iso(to));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">เมนูที่ยังไม่มีสูตร</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          เรียงตามยอดขาย เมนูบนสุดคือเมนูที่ควรใส่สูตรก่อน เพราะต้นทุนของเมนูเหล่านี้ยังเป็นการประมาณ
          และมีผลกับกำไรขั้นต้นมากที่สุด
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {WINDOWS.map((w) => (
          <a key={w.key} href={href({ w: w.key })} className={pill(w.key === win.key)}>
            {w.label}
          </a>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {reach.allBranches ? (
          <a href={href({ branch: undefined })} className={pill(branchId === undefined)}>
            ทุกสาขา
          </a>
        ) : null}
        {branches.length > 1 || reach.allBranches
          ? branches.map((b) => (
              <a key={b.id} href={href({ branch: b.id })} className={pill(b.id === branchId)}>
                {b.name}
              </a>
            ))
          : <span className="text-sm text-muted-foreground">{branches[0].name}</span>}
      </div>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <p className="text-sm text-muted-foreground">สูตรครอบคลุมยอดขาย · {periodTh}</p>
        {pct === null ? (
          <>
            <p className="mt-1 text-3xl font-semibold tabular-nums">—</p>
            <p className="mt-1 text-sm text-muted-foreground">ยังไม่มียอดขายในช่วงนี้ จึงยังไม่มีอะไรให้วัด</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{pct.toFixed(1)}%</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full origin-left animate-grow-x rounded-full bg-good" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              มีสูตรแล้ว <span className="tabular-nums text-foreground">{baht(covered)}</span> · ยังไม่มีสูตร{" "}
              <span className="tabular-nums text-foreground">{baht(uncovered)}</span> จากยอดขาย{" "}
              <span className="tabular-nums">{baht(total)}</span>
            </p>
          </>
        )}
      </section>

      {cov.rows.length === 0 ? (
        <EmptyState art="none">
          {pct === null ? "ยังไม่มียอดขายในช่วงนี้" : "ทุกเมนูที่ขายในช่วงนี้มีสูตรครบแล้ว"}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunk text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">เมนู</th>
                <th className="px-4 py-2 text-right font-medium">ยอดขาย</th>
                <th className="px-4 py-2 text-right font-medium">สัดส่วน</th>
                <th className="px-4 py-2 text-right font-medium">จาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cov.rows.map((r, i) => {
                const opens = canWrite && !r.isDeleted;
                return (
                  <tr key={r.menuId} className={`group relative ${opens ? "hover:bg-muted/50" : ""}`}>
                    <td className="px-4 py-2.5 align-top tabular-nums text-muted-subtle">{i + 1}</td>
                    <td className="px-4 py-2.5 align-top">
                      {opens ? (
                        <a
                          href={`/recipes/new?menu=${r.menuId}`}
                          className="font-medium after:absolute after:inset-0 after:content-['']"
                        >
                          {r.name}
                        </a>
                      ) : (
                        <span className="font-medium">{r.name}</span>
                      )}
                      <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                        {r.hasDraft ? <span className="badge whitespace-nowrap">มีร่างสูตรอยู่</span> : null}
                        {r.isRetired ? <span className="badge whitespace-nowrap">เลิกขายแล้ว</span> : null}
                        {r.isDeleted ? <span className="badge whitespace-nowrap">ลบเมนูแล้ว</span> : null}
                      </span>
                      {r.duplicateHint ? (
                        <p className="mt-0.5 text-xs text-warn">
                          อาจเป็นเมนูเดียวกับ “{r.duplicateHint.name}”
                          {r.duplicateHint.hasRecipe ? " ซึ่งมีสูตรแล้ว — ลองรวมเมนูแทนการเขียนสูตรใหม่" : ""}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right align-top tabular-nums">{baht(num(r.revenue))}</td>
                    <td className="px-4 py-2.5 text-right align-top tabular-nums">{num(r.shareOfRevenue).toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-right align-top tabular-nums">
                      {num(r.qty).toLocaleString("th-TH", { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {cov.rows.length > 0 ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          {cov.uncoveredMenuCount > cov.rows.length ? (
            <p>
              แสดง {cov.rows.length} จาก {cov.uncoveredMenuCount} เมนูที่ยังไม่มีสูตร (เรียงตามยอดขาย)
            </p>
          ) : null}
          {cov.hintedRowCount < cov.rows.length ? (
            <p>
              ตรวจหาเมนูที่อาจซ้ำกันเฉพาะ {cov.hintedRowCount} อันดับแรก — แถวหลังจากนั้นยังไม่ได้ตรวจ
              ไม่ได้แปลว่าไม่ซ้ำ
            </p>
          ) : null}
          {canWrite ? <p>กดที่เมนูเพื่อเขียนสูตร</p> : null}
        </div>
      ) : null}
    </div>
  );
}
