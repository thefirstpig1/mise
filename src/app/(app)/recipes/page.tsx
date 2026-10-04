// /recipes — since 2026-10-04 the PREPPED half only: a dish's recipe is edited
// on "จัดการเมนู" (/menus), which took this page's menu axis along with
// /menus/coverage (Kong). What remains is the list of things the shop makes —
// น้ำซุป, ซอส, กุ้งแกะ — until the products screen gets its prepped filter in
// the UI run-through, which is where Kong decided they belong (ADR 0040 grill).
//
// A cost is as many numbers as there are branches (rule R4), so the branch picker
// is not a convenience — the figures in the column are meaningless without it,
// and it is why the heading says which branch and which day.
//
// Filters live in the URL as a plain GET form, the way /waste does, so the view
// is linkable and a revalidate refreshes what the user is actually looking at.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature type-checks
// under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix).

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getRecipeListLogic } from "@/server/recipe-read";
import { recipeListQuerySchema } from "@/lib/validations/recipe";
import {
  toRecipeListRowView,
  type RecipeListRowView,
} from "./_components/recipe-view";


const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const thNum = "px-3 py-2 text-right text-xs font-medium text-muted-foreground";
const td = "px-3 py-2 text-sm";
const tdNum = "px-3 py-2 text-right text-sm tabular-nums";

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * The confidence chip.
 *
 * It sits against the figure and never anywhere else, because the rule this Part
 * is arranged around is that a cost and the reason to doubt it travel together.
 * Six ingredients resolving and one silently free is the failure being guarded.
 */
function ConfidenceChip({ row }: { row: RecipeListRowView }) {
  if (row.confidence === null) return null;
  const tone =
    row.confidence === "HIGH"
      ? "bg-good-bg text-good border-good-border"
      : row.confidence === "MEDIUM"
        ? "bg-warn-bg text-warn border-warn-border"
        : "bg-bad-bg text-bad border-bad-border";
  return (
    <span
      className={`ml-2 inline-block rounded border px-1.5 py-0.5 text-[10px] font-normal ${tone}`}
    >
      {row.confidenceLabel}
    </span>
  );
}

/** The cost cell: the figure, its caveat, or an honest dash. */
function CostCell({
  row,
  costHidden,
}: {
  row: RecipeListRowView;
  costHidden: boolean;
}) {
  // Checked BEFORE the null branch below, because without the ticket every row
  // has a null cost and the em dash would say "no recipe to cost" about a dish
  // that has one. Two different facts, one shape in the data (rule A8).
  if (costHidden) {
    return <span className="text-xs text-muted-foreground">ไม่มีสิทธิ์ดู</span>;
  }
  if (row.problem !== null) {
    return (
      <span className="text-xs text-bad">{row.problemLabel}</span>
    );
  }
  if (row.costPerServing === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <>
      <span className="font-medium">{row.costPerServing}</span>
      <ConfidenceChip row={row} />
    </>
  );
}

function MenuRow({
  row,
  costHidden,
}: {
  row: RecipeListRowView;
  costHidden: boolean;
}) {
  const href =
    row.recipeId !== null
      ? `/recipes/${row.recipeId}`
      : `/recipes/new?menu=${row.targetId}`;
  return (
    // The whole row opens the recipe (or starts one); no second target in it.
    <tr className="group relative border-t border-border transition-colors hover:bg-muted/50">
      <td className={td}>
        <a href={href} className="text-primary after:absolute after:inset-0 after:content-['']">
          {row.name}
        </a>
        {row.isPosStub ? (
          <span className="ml-2 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ยังไม่ได้ตรวจสอบ
          </span>
        ) : null}
      </td>
      <td className={`${td} text-muted-foreground`}>{row.categoryName ?? "—"}</td>
      <td className={td}>
        {row.recipeId === null ? (
          <a href={href} className="text-primary hover:underline">
            + เขียนสูตร
          </a>
        ) : row.isBranchOwn ? (
          <span className="rounded border border-border-strong bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            สูตรของสาขานี้
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">สูตรกลาง</span>
        )}
      </td>
      <td className={tdNum}>
        <CostCell row={row} costHidden={costHidden} />
      </td>
    </tr>
  );
}

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; q?: string; missing?: string }>;
}) {
  const { tenantId, reach, costAccess} = await requireTenant("any:member");
  const sp = await searchParams;

  const branches = await getBranchesLogic(tenantId, reach);
  if (branches.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
        ยังไม่มีสาขาในระบบ —{" "}
        <a href="/settings" className="text-primary hover:underline">
          เพิ่มสาขาในหน้าตั้งค่า
        </a>{" "}
        ก่อน แล้วค่อยกลับมาเขียนสูตร
      </div>
    );
  }

  const parsed = recipeListQuerySchema.safeParse({
    branchId: sp.branch,
    search: sp.q,
    missingOnly: sp.missing,
  });
  const query = parsed.success
    ? parsed.data
    : { branchId: undefined, search: undefined, missingOnly: false };

  // An unknown branch in the URL falls back to the first one rather than
  // erroring — the same courtesy /transfers/new gives `?from=`.
  const branchId =
    branches.find((b) => b.id === query.branchId)?.id ?? branches[0].id;
  const branchName = branches.find((b) => b.id === branchId)!.name;

  const asOf = computeBangkokToday();
  const result = await getRecipeListLogic(
    tenantId,
    {
      branchId,
      search: query.search,
      missingOnly: query.missingOnly,
    },
    costAccess
  );

  const prepped = result.prepped.map(toRecipeListRowView);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">สูตรของแปรรูป</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ของที่ร้านทำเอง เช่น น้ำซุป ซอส กุ้งแกะ — สูตรของเมนูย้ายไปอยู่ที่{" "}
          <a href="/menus" className="text-primary underline">
            จัดการเมนู
          </a>{" "}
          แล้ว (หน้านี้จะรวมเข้ากับหน้าวัตถุดิบเมื่อรีวิวถึงหน้านั้น)
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          ต้นทุนด้านล่างเป็นราคาของ <strong>{branchName}</strong> ณ วันที่{" "}
          {BANGKOK_DATE.format(asOf)} — สาขาอื่นซื้อของคนละราคา ตัวเลขจึงไม่เท่ากัน
        </p>
      </div>

      {/* GET form: the filters belong in the URL, not in component state. */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <select name="branch" defaultValue={branchId} className="input">
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input
          type="search"
          name="q"
          defaultValue={query.search ?? ""}
          placeholder="ค้นหาชื่อของแปรรูป"
          className="input"
        />
        <button
          type="submit"
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          กรอง
        </button>
      </form>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold">ของแปรรูป</h3>
          <p className="text-sm text-muted-foreground">{prepped.length} รายการ</p>
        </div>
        <p className="text-sm text-muted-foreground">
          ของที่ครัวทำขึ้นเองแล้วเอาไปใช้ต่อในเมนูอื่น เช่น น้ำพริกเผา ปลาแล่แล้ว
          ทำได้สองแบบเท่านั้น — <strong>แปรรูปจากสินค้าแม่ตัวเดียว</strong> โดยระบุ
          เปอร์เซ็นต์ผลผลิต หรือ <strong>มีสูตรผลิต</strong> ที่ใช้วัตถุดิบหลายอย่าง
          เลือกได้อย่างใดอย่างหนึ่ง
        </p>

        {prepped.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
            {query.missingOnly
              ? "ของแปรรูปทุกตัวระบุวิธีทำครบแล้ว"
              : "ยังไม่มีของแปรรูปในระบบ"}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[36rem]">
              <thead className="bg-muted/40">
                <tr>
                  <th className={th}>ของแปรรูป</th>
                  <th className={th}>หมวด</th>
                  <th className={th}>ทำจากอะไร</th>
                  <th className={thNum}>ต้นทุน/หน่วยผลิต (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {prepped.map((row) => (
                  <tr key={row.targetId} className="border-t border-border">
                    <td className={td}>
                      <a
                        href={
                          row.recipeId !== null
                            ? `/recipes/${row.recipeId}`
                            : `/products/${row.targetId}`
                        }
                        className="text-primary hover:underline"
                      >
                        {row.name}
                      </a>
                    </td>
                    <td className={`${td} text-muted-foreground`}>
                      {row.categoryName ?? "—"}
                    </td>
                    <td className={td}>
                      {row.preppedMethod === "NONE" ? (
                        <a
                          href={`/recipes/new?product=${row.targetId}`}
                          className="text-primary hover:underline"
                        >
                          + เขียนสูตรผลิต
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {row.preppedMethodLabel}
                        </span>
                      )}
                    </td>
                    <td className={tdNum}>
                      <CostCell row={row} costHidden={result.costHidden} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Q11, said on screen rather than left for somebody to discover in a
            count sheet. Nothing in the system can RAISE a prepped balance yet —
            production movements are a Part of their own — so the stock figure for
            these products only ever goes down. */}
        <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">
          <strong>ยังนับสต๊อกของแปรรูปไม่ได้</strong> — ตอนนี้ระบบยังไม่มีการ
          “บันทึกการผลิต” ที่จะเพิ่มยอดของแปรรูปเข้าคลัง ยอดคงเหลือจึงมีแต่ลดลง
          ถ้าไปนับสต๊อกของพวกนี้ ระบบจะรายงานว่า “ของเกิน” ทุกครั้ง
          ซึ่งไม่ได้แปลว่าผิด — แค่ยังไม่มีขาเข้าให้บันทึก
        </div>
      </section>
    </div>
  );
}
