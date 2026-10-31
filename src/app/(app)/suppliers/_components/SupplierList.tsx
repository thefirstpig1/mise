"use client";

// Sprint 1 Part 5, Step 7.6 — supplier list with client-side search +
// active/inactive toggle (Q7). The Server Component (page.tsx) hands in the
// already-loaded, serialized rows; filtering happens here in the browser.

import { useState } from "react";
import Link from "next/link";
import type { SupplierView } from "./supplier-view";

import EmptyState from "@/components/ui/EmptyState";
import ActionLink from "@/components/ui/ActionLink";
export default function SupplierList({
  suppliers,
  canOrder,
}: {
  suppliers: SupplierView[];
  canOrder: boolean;
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
        <div>
          <h2 className="text-2xl font-semibold">รายชื่อผู้ขาย</h2>
          <p className="mt-1 text-sm text-muted-foreground">ซัพพลายเออร์ทุกรายที่ร้านซื้อของด้วย — ร้านค้าส่ง ฟาร์ม แผงในตลาด</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/suppliers/import" className="btn-secondary">
            นำเข้าบิลซื้อย้อนหลัง
          </a>
          <Link
            href="/suppliers/new"
            className="btn"
          >
            + เพิ่มผู้ขาย
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ/รหัส"
          className="flex-1 input"
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
        <EmptyState art="start">
          ยังไม่มีผู้ขาย — กด &quot;นำเข้าบิลซื้อย้อนหลัง&quot; ได้ผู้ขายและราคาจากบิลเก่าในครั้งเดียว หรือ &quot;เพิ่มผู้ขาย&quot; ทีละราย
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState art="none">
          ไม่พบข้อมูลที่ค้นหา
        </EmptyState>
      ) : (
        <>
        {/* Queue item 9 (Kong 2026-10-31): six columns on a phone wrapped every
            phone number a syllable a line — a card per supplier there, the whole
            card opening it and สั่งซื้อ sitting above the stretched link. */}
        <ul className="space-y-2 sm:hidden">
          {filtered.map((s) => (
            <li key={s.id} className="relative rounded-[18px] border border-border/70 bg-surface p-3.5 shadow-card active:bg-surface-sunk">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/suppliers/${s.id}`} className="font-semibold text-foreground after:absolute after:inset-0 after:content-['']">
                    {s.nameFull}
                  </Link>
                  {s.nameShort && <span className="ml-1.5 text-xs text-muted-foreground">({s.nameShort})</span>}
                </div>
                {canOrder && s.isActive && (
                  <ActionLink href={`/suppliers/${s.id}/order`} className="relative z-10">
                    สั่งซื้อ
                  </ActionLink>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {[s.code, s.contactName, s.contactPhone].filter(Boolean).join(" · ") || "ไม่มีผู้ติดต่อ"}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {s.isVatRegistered && <span className="chip">VAT</span>}
                {s.defaultSubjectToWht && <span className="chip chip-warn">หัก ณ ที่จ่าย</span>}
                {!s.isActive && <span className="chip">ไม่ใช้งาน</span>}
              </div>
            </li>
          ))}
        </ul>
        <div className="data-table hidden sm:block">
          <table>
            <thead>
              <tr>
                <th className="px-4 py-2">ชื่อ</th>
                <th className="px-4 py-2">รหัส</th>
                <th className="px-4 py-2">ผู้ติดต่อ</th>
                <th className="px-4 py-2">ภาษี</th>
                <th className="px-4 py-2">สถานะ</th>
                {canOrder && <th className="px-4 py-2" aria-label="สั่งซื้อ" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                // The whole row opens the supplier (stretched link); สั่งซื้อ sits above it.
                <tr
                  key={s.id}
                  className="group relative border-b border-border transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/suppliers/${s.id}`}
                      className="whitespace-nowrap font-semibold text-foreground after:absolute after:inset-0 after:content-['']"
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
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          VAT
                        </span>
                      )}
                      {s.defaultSubjectToWht && (
                        <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn">
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
                      <span className="text-xs text-good">ใช้งาน</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        ไม่ใช้งาน
                      </span>
                    )}
                  </td>
                  {canOrder && (
                    <td className="px-4 py-2 text-right">
                      {s.isActive && <ActionLink href={`/suppliers/${s.id}/order`} className="relative z-10">สั่งซื้อ</ActionLink>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
