// /products/import — นำเข้าวัตถุดิบจากไฟล์ (คิวงานข้อ 5, Kong 2026-10-30,
// mockup https://claude.ai/artifact/R3vZEuvaWr2gWQosAgYfkA round 3). The prompt
// is built from the shop's own categories, so its AI can only pick one that
// exists. Everything after the upload happens in the client component; the
// read is POST /api/products/import and the save a Server Action.

import Link from "next/link";
import { requireTenant } from "@/lib/require-tenant";
import { buildProductImportPrompt } from "@/lib/product-import";
import { getImportCategoriesLogic } from "@/server/product-import";
import ImportGuide from "@/components/import/ImportGuide";
import ProductImport from "./_components/ProductImport";

export default async function ProductImportPage() {
  const { tenantId } = await requireTenant("master:write");
  const categories = await getImportCategoriesLogic(tenantId);
  const prompt = buildProductImportPrompt(categories.map((c) => c.label));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-subtle">
            <Link href="/products" className="hover:text-foreground">
              สินค้า/วัตถุดิบ
            </Link>{" "}
            › นำเข้าจากไฟล์
          </p>
          <h2 className="text-2xl font-semibold">นำเข้าวัตถุดิบจากไฟล์</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            ระบบจะแสดงข้อมูลให้ตรวจทานก่อน และบันทึกเมื่อกดปุ่มบันทึกเท่านั้น ·{" "}
            <Link href="/products?new=1" className="underline decoration-dotted underline-offset-4 hover:text-foreground">
              หรือเพิ่มทีละรายการ
            </Link>
          </p>
        </div>
        <ImportGuide prompt={prompt} kind="products" />
      </div>
      <ProductImport prompt={prompt} />
    </div>
  );
}
