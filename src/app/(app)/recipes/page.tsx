// /recipes held the shop's PREPPED items after "จัดการเมนู" took the dishes
// (2026-10-04). Since 2026-10-21 they live on สินค้า/วัตถุดิบ under the
// "ของแปรรูป" filter, where their production recipe or yield is edited in the
// product's sheet (Kong, ADR 0040 grill). The address stays for old links.
import { redirect } from "next/navigation";

export default function RecipesPage() {
  redirect("/products?filter=prepped");
}
