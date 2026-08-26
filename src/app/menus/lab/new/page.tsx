// Sprint 5 Part 24 L5b — /menus/lab/new: start a what-if.
//
// Unlike /recipes/new there is NO target in the URL and no `notFound()` for the
// want of one. That is Q3: half the reason to open this screen is a dish that
// does not exist yet, and a page that demanded an existing menu could only ever
// serve the other half. Saving the "new dish" side creates the `menu` row with
// `source: MISE` — inside the same transaction as the draft, so a draft that
// fails validation leaves no menu behind.

import { requireTenant } from "@/lib/require-tenant";
import { createDraftAction } from "../actions";
import { loadLabOptions } from "../options";
import LabForm from "../../_components/LabForm";

export default async function NewDraftPage() {
  const { tenantId } = await requireTenant();
  const options = await loadLabOptions(tenantId);

  return (
    <div className="space-y-6">
      <a
        href="/menus/lab"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← กลับหน้าทดลองเมนู
      </a>

      <div>
        <h2 className="text-xl font-bold">ร่างสูตรใหม่</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ใส่วัตถุดิบแล้วดูต้นทุนทันที — ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดบันทึกร่าง
          และยังไม่ตัดสต๊อกจนกว่าจะกดเผยแพร่
        </p>
      </div>

      <LabForm
        action={createDraftAction}
        mode="create"
        products={options.products}
        menus={options.menus}
        categories={options.categories}
        branches={options.branches}
        initial={null}
        initialMenuName={null}
        initialMenuHasSales={false}
      />
    </div>
  );
}
