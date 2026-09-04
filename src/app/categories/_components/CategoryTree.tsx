"use client";

// Sprint 1 Part 6, Step 6.4 — 3-tier tree view (D1):
//   account (COGS/OpEx) → accountingSection → groupName (leaf = Category row).
// account/section are grouping headers DERIVED from the flat list in the
// client; only leaves are real records (click → edit page). Expand/collapse +
// client search live here; the page (Server Component) just loads the rows.

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Category } from "@prisma/client";
import { ACCOUNT_LABELS_TH, type Account } from "@/lib/validations/category";

type SectionNode = { section: string; leaves: Category[] };
type AccountNode = { account: string; total: number; sections: SectionNode[] };

/** Group a (pre-sorted) flat list into account → section → leaves. */
function buildTree(categories: Category[]): AccountNode[] {
  const byAccount = new Map<string, Map<string, Category[]>>();
  for (const c of categories) {
    if (!byAccount.has(c.account)) byAccount.set(c.account, new Map());
    const sections = byAccount.get(c.account)!;
    if (!sections.has(c.accountingSection)) sections.set(c.accountingSection, []);
    sections.get(c.accountingSection)!.push(c);
  }
  return [...byAccount.entries()].map(([account, sections]) => ({
    account,
    total: [...sections.values()].reduce((n, leaves) => n + leaves.length, 0),
    sections: [...sections.entries()].map(([section, leaves]) => ({
      section,
      leaves,
    })),
  }));
}

export default function CategoryTree({
  categories,
}: {
  categories: Category[];
}) {
  const [search, setSearch] = useState("");
  // Track COLLAPSED nodes → default (empty set) = everything expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const term = search.trim().toLowerCase();
  const searching = term.length > 0;

  const tree = useMemo(() => {
    const filtered = searching
      ? categories.filter((c) =>
          [c.account, c.accountingSection, c.groupName]
            .join(" ")
            .toLowerCase()
            .includes(term)
        )
      : categories;
    return buildTree(filtered);
  }, [categories, term, searching]);

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
        <h2 className="text-xl font-bold">หมวดบัญชี</h2>
        <Link
          href="/categories/new"
          className="btn"
        >
          + เพิ่มหมวดบัญชี
        </Link>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ค้นหา บัญชี/หมวด/กลุ่ม"
        className="input w-full"
      />

      {categories.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          ยังไม่มีหมวดบัญชี — กด &quot;เพิ่มหมวดบัญชี&quot; เพื่อเริ่มต้น
        </div>
      ) : tree.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          ไม่พบหมวดบัญชีที่ค้นหา
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {tree.map((acc) => {
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
                            {sec.leaves.length}
                          </span>
                        </button>

                        {secOpen &&
                          sec.leaves.map((leaf) => (
                            <Link
                              key={leaf.id}
                              href={`/categories/${leaf.id}`}
                              className="block px-4 py-1.5 pl-16 text-sm text-primary hover:bg-muted/20 hover:underline"
                            >
                              {leaf.groupName}
                            </Link>
                          ))}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
