"use client";

// Sprint 1 Part 5, Step 7.6 — supplier list with client-side search +
// active/inactive toggle (Q7). The Server Component (page.tsx) hands in the
// already-loaded, serialized rows; filtering happens here in the browser.

import { useState } from "react";
import Link from "next/link";
import type { SupplierView } from "./supplier-view";

export default function SupplierList({
  suppliers,
}: {
  suppliers: SupplierView[];
}) {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const term = search.trim().toLowerCase();
  const filtered = suppliers.filter((s) => {
    if (!showInactive && !s.isActive) return false;
    if (!term) return true;
    const haystack = [s.nameFull, s.nameShort, s.code]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">รายการซัพพลายเออร์</h2>
        <Link
          href="/suppliers/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
        >
          + เพิ่มซัพพลายเออร์
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ/รหัส"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          แสดงที่ไม่ใช้งาน
        </label>
      </div>

      {suppliers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          ยังไม่มีซัพพลายเออร์ — กด &quot;เพิ่มซัพพลายเออร์&quot; เพื่อเริ่มต้น
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          ไม่พบข้อมูลที่ค้นหา
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">ชื่อ</th>
                <th className="px-4 py-2 font-medium">รหัส</th>
                <th className="px-4 py-2 font-medium">ผู้ติดต่อ</th>
                <th className="px-4 py-2 font-medium">ภาษี</th>
                <th className="px-4 py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-border last:border-0 hover:bg-muted/20"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/suppliers/${s.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.nameFull}
                    </Link>
                    {s.nameShort && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({s.nameShort})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {s.code ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {s.contactName ?? "—"}
                    {s.contactPhone && (
                      <span className="block text-xs">{s.contactPhone}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {s.isVatRegistered && (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                          VAT
                        </span>
                      )}
                      {s.defaultSubjectToWht && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                          หัก ณ ที่จ่าย
                        </span>
                      )}
                      {!s.isVatRegistered && !s.defaultSubjectToWht && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {s.isActive ? (
                      <span className="text-xs text-green-700">ใช้งาน</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        ไม่ใช้งาน
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
