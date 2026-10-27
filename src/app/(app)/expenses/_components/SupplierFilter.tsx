"use client";

// The list's supplier filter (expense review 2026-10-27): type to find, never a
// <select> of every supplier. Posts `supplier` with the GET form; empty = all.

import { useState } from "react";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";

export default function SupplierFilter({ items, value: initial }: { items: PickerProduct[]; value: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ProductPicker
      products={items}
      value={value}
      onChange={setValue}
      name="supplier"
      inputId="supplier"
      thumbs={false}
      placeholder="ผู้ขายทั้งหมด — พิมพ์เพื่อค้นหา"
    />
  );
}
