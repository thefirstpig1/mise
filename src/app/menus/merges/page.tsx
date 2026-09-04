// Sprint 5 Part 25 L5 — /menus/merges: two rows, one dish (ADR 0026).
//
// Server Component. `?menu=<id>` opens the form on one menu; `?q=` searches for
// the menu to open it on; `?revoked=true` shows the history.
//
// **THIS SCREEN NEVER FOLDS**, and that is the point of it existing separately
// from every report. Q6's table puts it beside `planMenuResolutionLogic` on the
// "never" side: a merge that could not be seen as two rows would be a merge
// nobody could undo, and the row a person comes here to un-merge is precisely
// the one a fold would hide.
//
// The list below the form is therefore the only place in Mise where a merged
// dish still looks like two menus. Everything else — revenue per menu, recipe
// coverage, the ledger from the effective date onwards — has already stopped
// counting them separately.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature
// type-checks under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix).

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getMenusLogic } from "@/server/menu";
import {
  getMenuMergesLogic,
  getMergeCandidatesLogic,
} from "@/server/menu-merge-read";
import { MERGE_NOT_SAME_DISH_WARNING_TH } from "@/lib/validations/menu-merge";
import {
  toMenuMergeRowView,
  toMergeCandidateRowView,
  toMergeSubjectView,
} from "../_components/menu-merge-view";
import MergeForm from "../_components/MergeForm";
import RevokeMergeButton from "../_components/RevokeMergeButton";


/** A uuid, or nothing. A stray `?menu=` must not become a database round trip. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MenuMergesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireTenant("master:write");
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const menuId = UUID.test(one("menu") ?? "") ? (one("menu") as string) : null;
  const search = one("q")?.trim() || undefined;
  const includeRevoked = one("revoked") === "true";

  const todayIso = computeBangkokToday().toISOString().slice(0, 10);

  const [merges, picked, searchResults] = await Promise.all([
    getMenuMergesLogic(tenantId, { winningMenuId: undefined, includeRevoked }),
    menuId === null
      ? Promise.resolve(null)
      : getMergeCandidatesLogic(tenantId, {
          menuId,
          limit: 8,
          includeMerged: false,
        }),
    search === undefined
      ? Promise.resolve(null)
      : getMenusLogic(tenantId, {
          stubsOnly: false,
          // ADR 0027 Q9 — the ONE picker that still offers retired menus. This
          // screen is the repair tool for exactly the row a shop retires when
          // it has not found the merge button yet, and that row is still taking
          // money every day. ADR 0026 Q6 already forbade hiding anything here.
          includeRetired: true,
          search,
        }),
  ]);

  const mergeRows = merges.map(toMenuMergeRowView);
  const liveCount = mergeRows.filter((m) => !m.isRevoked).length;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">รวมเมนูที่ซ้ำกัน</h2>
        <a href="/menus" className="text-sm text-primary hover:underline">
          ← กลับรายการเมนู
        </a>
      </div>

      {/* ---------- what this screen is for ---------- */}
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
        <p>
          ร้านที่มีมากกว่าหนึ่งสาขาจะได้เมนูซ้ำตั้งแต่ไฟล์ยอดขายไฟล์แรก
          เพราะเครื่อง POS ของแต่ละสาขาส่งรหัสของตัวเองมา — จานเดียวกันจึงกลายเป็นคนละรายการ
        </p>
        <p className="text-muted-foreground">
          การรวมทำให้ทุกหน้านับเป็นจานเดียว โดย
          <strong>ไม่ลบรายการไหนและไม่ย้ายยอดขายสักแถว</strong>
        </p>
        <p className="text-warn">{MERGE_NOT_SAME_DISH_WARNING_TH}</p>
      </div>

      {/* ---------- pick the menu ---------- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">เลือกเมนูที่ซ้ำ</h3>
        <form className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            ค้นหาเมนู
            <input
              name="q"
              defaultValue={search ?? ""}
              placeholder="ชื่อหรือรหัสเมนู"
              className={"input mt-1 block"}
            />
          </label>
          <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm">
            ค้นหา
          </button>
        </form>

        {searchResults !== null &&
          (searchResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">ไม่พบเมนูที่ตรงกับคำค้นนี้</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {searchResults.slice(0, 20).map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <span>
                    {m.name}
                    {m.posIntegration ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {m.posIntegration.name}
                      </span>
                    ) : null}
                  </span>
                  <a
                    href={`/menus/merges?menu=${m.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    เลือกรายการนี้ →
                  </a>
                </li>
              ))}
            </ul>
          ))}
      </section>

      {/* ---------- the form ---------- */}
      {picked !== null ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">
              {toMergeSubjectView(picked.subject).label}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {toMergeSubjectView(picked.subject).originLabel}
              {picked.subject.spellingCount > 0
                ? ` · เป็นเมนูหลักของ ${picked.subject.spellingCount} ชื่อแล้ว`
                : null}
            </p>
          </div>

          {picked.subject.mergedIntoMenuId !== null ? (
            <p className="rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn">
              เมนูนี้ถูกรวมเข้ากับเมนูอื่นอยู่แล้ว — ต้องยกเลิกการรวมเดิมด้านล่างก่อน
              จึงจะรวมใหม่ได้
            </p>
          ) : (
            <MergeForm
              subject={toMergeSubjectView(picked.subject)}
              candidates={picked.candidates.map(toMergeCandidateRowView)}
              todayIso={todayIso}
            />
          )}
        </section>
      ) : null}

      {/* ---------- what is already merged ---------- */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">การรวมที่ใช้งานอยู่ ({liveCount})</h3>
          <a
            href={
              includeRevoked ? "/menus/merges" : "/menus/merges?revoked=true"
            }
            className="text-xs text-primary hover:underline"
          >
            {includeRevoked ? "ซ่อนรายการที่ยกเลิกแล้ว" : "ดูรายการที่ยกเลิกแล้วด้วย"}
          </a>
        </div>

        {mergeRows.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
            ยังไม่มีการรวมเมนู
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {mergeRows.map((m) => (
              <li key={m.id} className="space-y-2 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{m.winner.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.winner.originLabel}
                  </span>
                  {m.isRevoked ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                      {m.statusLabel}
                    </span>
                  ) : null}
                </div>
                <div className="pl-4 text-xs text-muted-foreground">
                  ← {m.loser.label} · {m.loser.originLabel}
                </div>
                <p className="text-xs text-muted-foreground">{m.scopeLabel}</p>
                {m.isRevoked ? null : (
                  <RevokeMergeButton
                    mergeId={m.id}
                    loserLabel={m.loser.label}
                    winnerLabel={m.winner.label}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
