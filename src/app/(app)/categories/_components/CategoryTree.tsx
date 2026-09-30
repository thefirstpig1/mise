"use client";

// Sprint 1 Part 6, Step 6.4 — the 3-tier category model (D1):
//   account (COGS/OpEx) → accountingSection → groupName (leaf = Category row).
// account/section are grouping headers DERIVED from the flat list in the
// client; only leaves are real records (click → edit page).
//
// UI run-through (Kong, 2026-09-29): one BOX per account instead of a
// collapsible tree with counts. There are only two accounts and a shop has a
// few dozen groups at most, so everything fits on one screen — collapsing
// hid the list and the counts on the right answered a question nobody asked.
// Both boxes always show, because which box a group sits in is the whole
// point of the page (food cost vs running the shop).

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Category } from "@prisma/client";
import { ACCOUNT_VALUES, type Account } from "@/lib/validations/category";

import EmptyState from "@/components/ui/EmptyState";

type SectionNode = { section: string; leaves: Category[] };

/** What each box means to the shop, in the shop's words. */
const BOX: Record<Account, { title: string; code: string; hint: string }> = {
  COGS: {
    title: "ต้นทุนขาย",
    code: "COGS",
    hint: "ของที่ซื้อมาทำอาหารและเครื่องดื่ม นับเป็นต้นทุนอาหาร",
  },
  OpEx: {
    title: "ค่าใช้จ่ายดำเนินงาน",
    code: "OpEx",
    hint: "ค่าใช้จ่ายในการเปิดร้าน เช่น ค่าเช่า ค่าไฟ ค่าแรง ไม่นับเป็นต้นทุนอาหาร",
  },
};

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
}: {
  categories: Category[];
  canWrite: boolean;
}) {
  const [search, setSearch] = useState("");
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
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">หมวดบัญชี</h2>
        {canWrite && (
          <Link href="/categories/new" className="btn">
            + เพิ่มหมวดบัญชี
          </Link>
        )}
      </div>

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
                    className="animate-pop-in rounded-xl border border-border bg-surface p-5 shadow-card"
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
                                  {/* The edit page is gated on master:write — only a writer gets a link. */}
                                  {canWrite ? (
                                    <Link
                                      href={`/categories/${leaf.id}`}
                                      className="block rounded px-2 py-1.5 text-sm hover:bg-muted"
                                    >
                                      {leaf.groupName}
                                    </Link>
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
    </div>
  );
}
