"use client";

// The history's product filter (Kong's standing rule: never a <select> of every
// product). Posts `product` with the GET form; empty = every product.

import { useState } from "react";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";

export default function ProductFilter({ products, initial }: { products: PickerProduct[]; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-[240px]">
        <ProductPicker products={products} value={value} onChange={setValue} name="product" placeholder="ทุกวัตถุดิบ — พิมพ์เพื่อค้นหา" />
      </div>
      {value && (
        <button type="button" onClick={() => setValue("")} className="whitespace-nowrap text-xs text-primary hover:underline">
          ล้าง
        </button>
      )}
    </div>
  );
}
