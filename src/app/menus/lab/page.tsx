// Sprint 5 Part 24 L5b — /menus/lab: what am I in the middle of?
//
// Server Component. The list carries no cost figure and that is deliberate
// (L5a): costing N drafts is N graph walks against a FIFO replay, and a list is
// not where a price gets weighed. One dish at a time, on its own page, with the
// branch named beside the number.
//
// Two warnings live on the row rather than behind the click, because both change
// what somebody is about to do: a draft that would take over a live recipe, and
// a dish that already sells — where the SOLD price is the price and ราคาที่ตั้งใจ
// is only a comparison (Q2).

import { requireTenant } from "@/lib/require-tenant";
import { getDraftsLogic } from "@/server/menu-lab-read";
import { toDraftRowView } from "../_components/menu-lab-view";
import { PLANNED_PRICE_LABEL_TH } from "@/lib/validations/menu-lab";

export default async function MenuLabPage() {
  const { tenantId } = await requireTenant("recipe:write");
  const drafts = (await getDraftsLogic(tenantId)).map(toDraftRowView);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">ทดลองเมนู</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ลองคิดสูตรและราคาก่อนขายจริง — ร่างที่นี่ยังไม่ตัดสต๊อก
            และยังไม่ถูกใช้คิดต้นทุนขาย จนกว่าจะกดเผยแพร่
          </p>
        </div>
        <a
          href="/menus/lab/new"
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          + ร่างสูตรใหม่
        </a>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <a href="/menus/coverage" className="text-primary underline">
          เมนูไหนยังไม่มีสูตร →
        </a>
        <a href="/recipes" className="text-muted-foreground underline">
          สูตรที่ใช้งานจริง →
        </a>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            ยังไม่มีร่างสูตร — กด “ร่างสูตรใหม่” เพื่อลองคิดต้นทุนของจานที่ยังไม่ได้ขาย
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {drafts.map((d) => (
            <li
              key={d.recipeId}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <a
                  href={`/menus/lab/${d.recipeId}`}
                  className="text-base font-semibold hover:underline"
                >
                  {d.menuName}
                </a>
                <span className="text-xs text-muted-foreground">
                  แก้ล่าสุด {d.updatedAtLabel}
                </span>
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                วัตถุดิบ {d.ingredientCount} รายการ · ทำได้ครั้งละ {d.servings} จาน
                {d.plannedPrice !== null
                  ? ` · ${PLANNED_PRICE_LABEL_TH} ${d.plannedPrice} บาท`
                  : ""}
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                {d.menuIsMise ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    เมนูใหม่ที่สร้างจากหน้านี้ ยังไม่มีในระบบขาย
                  </span>
                ) : null}
                {d.liveRecipeId !== null ? (
                  <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[11px] text-warn">
                    เผยแพร่แล้วจะใช้แทนสูตรเดิมของเมนูนี้
                  </span>
                ) : null}
                {d.hasSales ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    เมนูนี้มียอดขายแล้ว — ราคาที่ใช้จริงคือราคาที่ขายได้
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
