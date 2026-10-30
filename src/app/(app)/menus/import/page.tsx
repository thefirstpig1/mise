// /menus/import — นำเข้าสูตรจากไฟล์ (คิวงานข้อ 5d, Kong 2026-10-30; the
// recipes tab of mockup https://claude.ai/artifact/R3vZEuvaWr2gWQosAgYfkA).
// The same file the ingredient import reads, sheet "สูตร". Every recipe is
// saved as a DRAFT — nothing moves until "ใช้สูตร" in ทดลองเมนู.

import Link from "next/link";
import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";
import { buildProductImportPrompt } from "@/lib/product-import";
import { getImportCategoriesLogic } from "@/server/product-import";
import ImportGuide from "@/components/import/ImportGuide";
import RecipeImport from "./_components/RecipeImport";

export default async function RecipeImportPage() {
  const { tenantId } = await requireTenant("recipe:draft");
  const [categories, counts] = await Promise.all([
    getImportCategoriesLogic(tenantId),
    withTenantContext(tenantId, async (tx) => ({
      menus: await tx.menu.count({ where: { tenantId, deletedAt: null } }),
      products: await tx.product.count({ where: { tenantId, deletedAt: null } }),
    })),
  ]);
  const prompt = buildProductImportPrompt(categories.map((c) => c.label));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-subtle">
            <Link href="/menus" className="hover:text-foreground">
              จัดการเมนู
            </Link>{" "}
            › นำเข้าสูตรจากไฟล์
          </p>
          <h2 className="text-2xl font-semibold">นำเข้าสูตรจากไฟล์</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            บันทึกเป็น <b className="font-medium text-foreground">สูตรร่าง</b> ทั้งหมด ยังไม่ตัดสต๊อกจนกว่าจะกด “ใช้สูตร” ทีละเมนูที่หน้าทดลองเมนู
          </p>
        </div>
        <ImportGuide prompt={prompt} kind="recipes" />
      </div>
      <RecipeImport prompt={prompt} menuCount={counts.menus} productCount={counts.products} />
    </div>
  );
}
