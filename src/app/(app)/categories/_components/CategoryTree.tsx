"use client";

// Sprint 1 Part 6, Step 6.4 — the 3-tier category model (D1):
//   account (COGS/OpEx) → accountingSection → groupName (leaf = Category row).
// account/section are grouping headers DERIVED from the flat list in the
// client; only leaves are real records (click → edit popup, queue item 9).
//
// UI run-through (Kong, 2026-09-29): one BOX per account instead of a
// collapsible tree with counts. There are only two accounts and a shop has a
// few dozen groups at most, so everything fits on one screen — collapsing
// hid the list and the counts on the right answered a question nobody asked.
// Both boxes always show, because which box a group sits in is the whole
// point of the page (food cost vs running the shop).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Category } from "@prisma/client";
import { ACCOUNT_VALUES, type Account } from "@/lib/validations/category";

import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import CategoryDialog, { ACCOUNT_BOX as BOX } from "./CategoryForm";

type SectionNode = { section: string; leaves: Category[] };

/** Group a (pre-sorted) flat list into section → leaves for one account. */
function sectionsOf(categories: Category[], account: Account): SectionNode[] {
  const sections = new Map<string, Category[]>();
  for (const c of categories) {
    if (c.account !== account) continue;
    if (!sections.has(c.accountingSection)) sections.set(c.accountingSection, []);
    sections.get(c.accountingSection)!.push(c);
  }
  return [...sections.entries()].map(([section, leaves]) => ({ section, leaves }));
}

export default function CategoryTree({
  categories,
  canWrite,
  initialOpen,
}: {
  categories: Category[];
  canWrite: boolean;
  /** From the address: "new", a category id, or nothing. */
  initialOpen: string | null;
}) {
  const [search, setSearch] = useState("");
  // "new" | a category | null — the popup over the list.
  const [open, setOpen] = useState<"new" | Category | null>(() =>
    !canWrite || initialOpen === null ? null : initialOpen === "new" ? "new" : (categories.find((c) => c.id === initialOpen) ?? null)
  );
  const close = useCallback(() => setOpen(null), []);
  // /categories/new and /categories/<id> land here with ?new / ?edit; once
  // the popup is open the address goes back to the plain list.
  useEffect(() => {
    if (initialOpen === null) return;
    try {
      window.history.replaceState(null, "", "/categories");
    } catch {
      /* the address bar is a convenience */
    }
  }, [initialOpen]);
  const sectionsByAccount = useMemo(
    () =>
      Object.fromEntries(
        ACCOUNT_VALUES.map((a) => [a, [...new Set(categories.filter((c) => c.account === a).map((c) => c.accountingSection))]])
      ) as Record<Account, string[]>,
    [categories]
  );
  const term = search.trim().toLowerCase();
  const searching = term.length > 0;

  const boxes = useMemo(() => {
    const filtered = searching
      ? categories.filter((c) =>
          [BOX[c.account as Account]?.title ?? c.account, c.accountingSection, c.groupName]
            .join(" ")
            .toLowerCase()
            .includes(term)
        )
      : categories;
    return ACCOUNT_VALUES.map((account) => ({
      account,
      sections: sectionsOf(filtered, account),
    }));
  }, [categories, term, searching]);

  const nothingFound = searching && boxes.every((b) => b.sections.length === 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="หมวดบัญชี"
        description={`ใช้จัดสินค้าและบิลค่าใช้จ่ายเข้าบัญชี · ต้นทุนขายนับเป็นต้นทุนอาหาร ค่าใช้จ่ายดำเนินงานไม่นับ${canWrite ? " · กดที่กลุ่มเพื่อแก้ไข" : ""}`}
        actions={
          canWrite && (
            <button type="button" onClick={() => setOpen("new")} className="btn">
              + เพิ่มหมวดบัญชี
            </button>
          )
        }
      />

      {categories.length === 0 ? (
        <EmptyState art="start">
          ยังไม่มีหมวดบัญชี — กด &quot;เพิ่มหมวดบัญชี&quot; เพื่อเริ่มต้น
        </EmptyState>
      ) : (
        <>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาหมวดหรือกลุ่ม"
            className="input w-full"
          />

          {nothingFound ? (
            <EmptyState art="none">ไม่พบหมวดบัญชีที่ค้นหา</EmptyState>
          ) : (
            <div className="grid items-start gap-4 md:grid-cols-2">
              {boxes
                .filter((b) => !searching || b.sections.length > 0)
                .map(({ account, sections }) => (
                  <section
                    key={account}
                    className="animate-pop-in rounded-2xl border border-border bg-surface p-5 shadow-card"
                  >
                    <header className="mb-4 border-b border-border pb-3">
                      <h3 className="text-lg font-semibold">
                        {BOX[account].title}{" "}
                        <span className="text-xs font-normal text-muted-subtle">
                          {BOX[account].code}
                        </span>
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">{BOX[account].hint}</p>
                    </header>

                    {sections.length === 0 ? (
                      <p className="text-sm text-muted-subtle">ยังไม่มีหมวดในกลุ่มนี้</p>
                    ) : (
                      <div className="space-y-4">
                        {sections.map((sec) => (
                          <div key={sec.section}>
                            <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-subtle">
                              {sec.section}
                            </h4>
                            <ul className="-mx-2">
                              {sec.leaves.map((leaf) => (
                                <li key={leaf.id}>
                                  {/* Editing is gated on master:write — only a writer gets a button. */}
                                  {canWrite ? (
                                    <button
                                      type="button"
                                      onClick={() => setOpen(leaf)}
                                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                                    >
                                      {leaf.groupName}
                                    </button>
                                  ) : (
                                    <span className="block px-2 py-1.5 text-sm">{leaf.groupName}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                ))}
            </div>
          )}
        </>
      )}

      {open && (
        <CategoryDialog
          key={open === "new" ? "new" : open.id}
          initial={open === "new" ? null : open}
          sectionsByAccount={sectionsByAccount}
          onClose={close}
        />
      )}
    </div>
  );
}
