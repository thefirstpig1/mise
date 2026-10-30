// ============================================================
// คิดครัว — the reads behind "ตัดสต๊อกตามยอดขาย", as GET (mise-ui-review §5c)
// ============================================================
// what=accuracy-detail  one product's row in "ระบบตัดตามสูตร เทียบกับที่ใช้จริง":
//                       the menus behind the deduction, waste, receipts on the
//                       count day (src/server/deduction-accuracy.ts)
// Same gate as the page; the branch is asserted against the reader's reach,
// and the count lines are re-checked against branch and product by the read.
// ============================================================

import { z } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { guardRead, readInput } from "@/lib/read-api";
import { getDeductionAccuracyDetailLogic } from "@/server/deduction-accuracy";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const detailInput = z.object({
  branchId: z.string().uuid(),
  productId: z.string().uuid(),
  lineIds: z.array(z.string().uuid()).min(1).max(200),
});

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    if (url.searchParams.get("what") !== "accuracy-detail") return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
    const parsed = detailInput.safeParse(readInput(url));
    if (!parsed.success) return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
    const { tenantId, assertBranch } = await requireTenant("consumption:post");
    assertBranch(parsed.data.branchId);
    const detail = await getDeductionAccuracyDetailLogic(tenantId, parsed.data);
    return detail ? json({ ok: true, detail }) : json({ ok: false, formError: "ไม่พบข้อมูลของรายการนี้" }, 404);
  });
}
