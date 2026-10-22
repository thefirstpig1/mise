// /products/new — "+ เพิ่มสินค้า" is a sheet over the list now (Kong 2026-10-22,
// mockup 9KoNNnZYeQSyA1dVNEfKcr). The address stays so old links and bookmarks
// still land on it.
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";

export default async function NewProductPage() {
  await requireTenant("master:write");
  redirect("/products?new=1");
}
