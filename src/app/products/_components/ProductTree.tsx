"use client";

// Sprint 1 Part 7a — products grouped by category as a 3-tier tree (Q6/Q6b):
//   account (COGS/OpEx) → accountingSection → groupName → product (leaf).
// Built client-side from a flat ProductView[] (the page loads + serializes the
// rows). Products with no category fall into a top-level "ไม่มีหมวด" bucket.
// Reuses CategoryTree's expand/collapse + client search, and adds an
// active-only toggle (default on, Q6). Leaf name links to the edit page.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ACCOUNT_LABELS_TH, type Account } from "@/lib/validations/category";
import type { ProductView } from "./product-view";

type GroupNode = { group: string; products: ProductView[] };
type SectionNode = { section: string; total: number; groups: GroupNode[] };
type AccountNode = { account: string; total: number; sections: SectionNode[] };

/** Group a (pre-sorted) flat list into account → section → group, + the uncategorized bucket. */
function buildTree(products: ProductView[]): {
  accounts: AccountNode[];
  uncategorized: ProductView[];
} {
  const byAcc = new Map<string, Map<string, Map<string, ProductView[]>>>();
  const uncategorized: ProductView[] = [];

  for (const p of products) {
    if (!p.category) {
      uncategorized.push(p);
      continue;
    }
    const { account, accountingSection, groupName } = p.category;
    if (!byAcc.has(account)) byAcc.set(account, new Map());
    const secs = byAcc.get(account)!;
    if (!secs.has(accountingSection)) secs.set(accountingSection, new Map());
    const grps = secs.get(accountingSection)!;
    if (!grps.has(groupName)) grps.set(groupName, []);
    grps.get(groupName)!.push(p);
  }

  const accounts: AccountNode[] = [...byAcc.entries()].map(([account, secs]) => {
    const sections: SectionNode[] = [...secs.entries()].map(([section, grps]) => {
      const groups: GroupNode[] = [...grps.entries()].map(([group, products]) => ({
        group,
        products,
      }));
      return {
        section,
        groups,
        total: groups.reduce((n, g) => n + g.products.length, 0),
      };
    });
    return {
      account,
      sections,
      total: sections.reduce((n, s) => n + s.total, 0),
    };
  });

  return { accounts, uncategorized };
}

function ProductLeaf({ p, pad }: { p: ProductView; pad: string }) {
  const extraUnits = p.units.filter((u) => !u.isBase).length;
  return (
    <Link
      href={`/products/${p.id}`}
      className={`flex items-center justify-between gap-3 px-4 py-1.5 ${pad} hover:bg-muted/20`}
    >
      <span className="text-sm text-primary hover:underline">{p.name}</span>
      <span className="text-xs text-muted-foreground">
        {p.sku}
        {p.baseUnitName ? ` · ${p.baseUnitName}` : ""}
        {extraUnits > 0 ? ` (+${extraUnits})` : ""}
        {!p.isActive ? " · ปิดใช้งาน" : ""}
      </span>
    </Link>
  );
}

export default function ProductTree({ products }: { products: ProductView[] }) {
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  // Track COLLAPSED nodes → default (empty set) = everything expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const term = search.trim().toLowerCase();
  const searching = term.length > 0;

  const { accounts, uncategorized } = useMemo(() => {
    const filtered = products.filter((p) => {
      if (activeOnly && !p.isActive) return false;
      if (!searching) return true;
      const hay = [
        p.name,
        p.nameEn ?? "",
        p.sku,
        p.category?.account ?? "",
        p.category?.accountingSection ?? "",
        p.category?.groupName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
    return buildTree(filtered);
  }, [products, term, searching, activeOnly]);

  const hasResults = accounts.length > 0 || uncategorized.length > 0;

  // When searching, force-expand matching branches regardless of collapsed set.
  const isExpanded = (key: string) => searching || !collapsed.has(key);
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">สินค้า/วัตถุดิบ</h2>
        <Link
          href="/products/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
        >
          + เพิ่มสินค้า
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา ชื่อ/รหัส/หมวดหมู่"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          เฉพาะที่ใช้งาน
        </label>
      </div>

      {products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          ยังไม่มีสินค้า — กด &quot;เพิ่มสินค้า&quot; เพื่อเริ่มต้น
        </div>
      ) : !hasResults ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          ไม่พบสินค้าที่ค้นหา
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {accounts.map((acc) => {
            const accKey = `acc:${acc.account}`;
            const accOpen = isExpanded(accKey);
            return (
              <div key={acc.account}>
                <button
                  type="button"
                  onClick={() => toggle(accKey)}
                  className="flex w-full items-center justify-between px-4 py-2 text-left font-semibold hover:bg-muted/40"
                >
                  <span>
                    <span className="inline-block w-4 text-muted-foreground">
                      {accOpen ? "▾" : "▸"}
                    </span>
                    {ACCOUNT_LABELS_TH[acc.account as Account] ?? acc.account}
                  </span>
                  <span className="text-xs text-muted-foreground">{acc.total}</span>
                </button>

                {accOpen &&
                  acc.sections.map((sec) => {
                    const secKey = `sec:${acc.account}/${sec.section}`;
                    const secOpen = isExpanded(secKey);
                    return (
                      <div key={sec.section}>
                        <button
                          type="button"
                          onClick={() => toggle(secKey)}
                          className="flex w-full items-center justify-between px-4 py-1.5 pl-8 text-left text-sm font-medium hover:bg-muted/40"
                        >
                          <span>
                            <span className="inline-block w-4 text-muted-foreground">
                              {secOpen ? "▾" : "▸"}
                            </span>
                            {sec.section}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {sec.total}
                          </span>
                        </button>

                        {secOpen &&
                          sec.groups.map((grp) => {
                            const grpKey = `grp:${acc.account}/${sec.section}/${grp.group}`;
                            const grpOpen = isExpanded(grpKey);
                            return (
                              <div key={grp.group}>
                                <button
                                  type="button"
                                  onClick={() => toggle(grpKey)}
                                  className="flex w-full items-center justify-between px-4 py-1.5 pl-12 text-left text-sm hover:bg-muted/40"
                                >
                                  <span>
                                    <span className="inline-block w-4 text-muted-foreground">
                                      {grpOpen ? "▾" : "▸"}
                                    </span>
                                    {grp.group}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {grp.products.length}
                                  </span>
                                </button>

                                {grpOpen &&
                                  grp.products.map((p) => (
                                    <ProductLeaf key={p.id} p={p} pad="pl-20" />
                                  ))}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
              </div>
            );
          })}

          {uncategorized.length > 0 &&
            (() => {
              const key = "uncat";
              const open = isExpanded(key);
              return (
                <div>
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="flex w-full items-center justify-between px-4 py-2 text-left font-semibold text-muted-foreground hover:bg-muted/40"
                  >
                    <span>
                      <span className="inline-block w-4">{open ? "▾" : "▸"}</span>
                      ไม่มีหมวด
                    </span>
                    <span className="text-xs">{uncategorized.length}</span>
                  </button>
                  {open &&
                    uncategorized.map((p) => (
                      <ProductLeaf key={p.id} p={p} pad="pl-8" />
                    ))}
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
}
