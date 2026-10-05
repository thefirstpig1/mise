"use client";

// ทดลองเมนู — the drafts table and the sheet that opens over it (Kong
// 2026-10-04, mockup approved). The whole row opens the draft; "+ ร่างสูตรใหม่"
// opens an empty one. Money in the table comes from the default branch's
// price book, loaded after paint (mise-ui-review §5c) — never ฿0 while it comes.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { IngredientOption, LabDraft, PriceBook, StandardUnit } from "@/server/menu-manager";
import EmptyState from "@/components/ui/EmptyState";
import { ingredientOptions, priceBook } from "../../_components/prefetch";
import { baht, thDate } from "../../_components/manager-format";
import { Portal } from "../../_components/sheet-parts";
import LabSheet from "./LabSheet";

export type LabMenu = {
  id: string;
  name: string;
  posCode: string | null;
  category: string | null;
  /** Plates and revenue over the last `factDays` days. */
  qty: number;
  net: number;
  hasRecipe: boolean;
};
export type Option = { id: string; name: string };

/** Cost of one plate from the price book; `missing` = lines nobody has bought. */
export function bookCost(lines: { kind: string; productId: string | null; componentMenuId: string | null; qty: number; toBaseRatio: number }[], servings: number, book: PriceBook | null) {
  if (book === null) return null;
  let sum = 0;
  let missing = 0;
  for (const l of lines) {
    const p = l.kind === "menu" ? (book.menus[l.componentMenuId ?? ""]?.costPerServing ?? null) : (book.products[l.productId ?? ""] ?? null);
    if (p === null) missing++;
    else sum += l.qty * l.toBaseRatio * p;
  }
  return { perPlate: sum / (servings || 1), missing };
}

export default function LabManager(props: {
  drafts: LabDraft[];
  menus: LabMenu[];
  factDays: number;
  categories: Option[];
  branches: Option[];
  defaultBranchId: string | null;
  today: string;
  costHidden: boolean;
  /** Applies a draft to every branch (recipe:write + reach over all of them). */
  canPublish: boolean;
  /** Endorses, edits anyone's draft, applies at a branch in reach (ADR 0041). */
  canWrite: boolean;
  viewerId: string;
  openDraftId: string | null;
  openNew: boolean;
}) {
  const { drafts, costHidden } = props;
  const router = useRouter();
  const [open, setOpen] = useState<{ id: string | null; n: number } | null>(
    props.openDraftId && drafts.some((d) => d.recipeId === props.openDraftId) ? { id: props.openDraftId, n: 0 } : props.openNew ? { id: null, n: 0 } : null
  );
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- price books, one per branch, loaded once ----
  const [books, setBooks] = useState<Record<string, PriceBook>>({});
  const asked = useRef(new Set<string>());
  const needBook = (branchId: string | null) => {
    if (!branchId || costHidden || asked.current.has(branchId)) return;
    asked.current.add(branchId);
    void priceBook(branchId).then((r) => {
      if (r.ok) setBooks((b) => ({ ...b, [branchId]: r.book }));
      else asked.current.delete(branchId);
    });
  };
  useEffect(() => needBook(props.defaultBranchId), []); // eslint-disable-line react-hooks/exhaustive-deps
  const dropBooks = () => {
    asked.current.clear();
    setBooks({});
  };
  const listBook = props.defaultBranchId ? (books[props.defaultBranchId] ?? null) : null;
  const branchName = props.branches.find((b) => b.id === props.defaultBranchId)?.name ?? "";

  // ---- the adder's list, on first need ----
  const [options, setOptions] = useState<IngredientOption[] | null>(null);
  const [standards, setStandards] = useState<StandardUnit[]>([]);
  const optionsAsked = useRef(false);
  const needOptions = () => {
    if (optionsAsked.current) return;
    optionsAsked.current = true;
    void ingredientOptions().then((r) => {
      if (!r.ok) return void (optionsAsked.current = false);
      setOptions(r.options);
      setStandards(r.standards);
    });
  };

  // A sheet opened from the address (?draft= / ?new=1) needs the list too.
  useEffect(() => {
    if (open) needOptions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the address on what is open, so a refresh or a shared link lands there.
  const setAddress = (id: string | null, isNew: boolean) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("draft");
    url.searchParams.delete("new");
    if (id) url.searchParams.set("draft", id);
    else if (isNew) url.searchParams.set("new", "1");
    window.history.replaceState(null, "", url);
  };
  const openDraft = (id: string | null) => {
    needOptions();
    setOpen({ id, n: Date.now() });
    setAddress(id, id === null);
  };
  const close = () => {
    setOpen(null);
    setAddress(null, false);
  };

  const waiting = drafts.filter((d) => waitsFor(d, props)).length;

  const openRow = open?.id ? (drafts.find((d) => d.recipeId === open.id) ?? null) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">ทดลองเมนู</h2>
          <p className="mt-1 text-sm text-muted-foreground">ลองคิดสูตรและราคาก่อนขายจริง ร่างที่นี่ยังไม่ตัดสต๊อกและยังไม่ถูกใช้คิดต้นทุนขาย จนกว่าจะกด “นำไปใช้จริง”</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openDraft(null)} className="btn whitespace-nowrap">
            + ร่างสูตรใหม่
          </button>
          <a href="/menus?filter=none" className="whitespace-nowrap rounded-full border border-border-strong bg-surface px-3 py-1.5 text-sm hover:bg-muted">
            เมนูที่ยังไม่มีสูตร
          </a>
          <a href="/menus" className="whitespace-nowrap rounded-full border border-border-strong bg-surface px-3 py-1.5 text-sm hover:bg-muted">
            จัดการเมนู
          </a>
        </div>
      </div>

      {waiting > 0 && (
        <p className="rounded-xl border border-warn-border bg-warn-bg px-3 py-2 text-sm">
          มีร่างสูตรรอคุณ <b className="tabular-nums">{waiting}</b> รายการ — {props.canPublish ? "รับรองหรือนำไปใช้จริง" : "ตรวจแล้วรับรอง หรือนำไปใช้จริงที่สาขาของคุณ"}
        </p>
      )}

      {drafts.length === 0 ? (
        <EmptyState art="start">
          <p className="text-sm text-muted-foreground">ยังไม่มีร่างสูตร · กด “ร่างสูตรใหม่” เพื่อลองคิดต้นทุนและราคาของจานที่ยังไม่ได้ขาย หรือลองแก้สูตรของเมนูที่ขายอยู่</p>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">ร่าง</th>
                {!costHidden && <th className="px-3 py-2 text-right font-medium">ต้นทุนต่อจาน</th>}
                <th className="px-3 py-2 text-right font-medium">ราคาที่ตั้งใจ</th>
                {!costHidden && <th className="px-3 py-2 text-right font-medium">ต้นทุน % ของราคา</th>}
                <th className="px-3 py-2 text-right font-medium">แก้ล่าสุด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {drafts.map((d) => {
                const c = bookCost(d.lines, d.servings, listBook);
                const pct = c && c.missing === 0 && d.plannedPrice ? (c.perPlate / d.plannedPrice) * 100 : null;
                const isNew = d.menuIsMise && !d.hasSales;
                return (
                  <tr key={d.recipeId} className="cursor-pointer hover:bg-muted/50" onClick={() => openDraft(d.recipeId)}>
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{d.menuName}</span>{" "}
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${isNew ? "bg-good-bg text-good" : "bg-warn-bg text-warn"}`}>{isNew ? "เมนูใหม่" : "แก้สูตรเมนูที่ขายอยู่"}</span>{" "}
                      <StatusChip status={d.draftStatus} />
                      <span className="block text-xs text-muted-subtle">
                        ร่างโดย {d.authorId === props.viewerId ? "คุณ" : d.authorName}
                        {d.endorsedByName ? ` · รับรองโดย ${d.endorsedByName}` : ""} ·{" "}
                        {d.lines.length} วัตถุดิบ · ทำครั้งละ {d.servings.toLocaleString("th-TH")} จาน
                        {d.liveRecipeId && !costHidden && listBook?.menus[d.menuId] ? ` · สูตรที่ใช้อยู่ ${baht(listBook.menus[d.menuId].costPerServing ?? 0, 2)}/จาน` : ""}
                      </span>
                    </td>
                    {!costHidden && (
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {c === null ? (
                          <span className="inline-block h-3.5 w-14 animate-pulse rounded bg-muted align-middle" />
                        ) : d.lines.length === 0 ? (
                          <span className="text-xs text-muted-subtle">ยังไม่มีวัตถุดิบ</span>
                        ) : (
                          <>
                            {baht(c.perPlate, 2)}
                            {c.missing > 0 && <span className="block text-[11px] text-warn">ขาดราคา {c.missing} รายการ</span>}
                          </>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right tabular-nums">{d.plannedPrice ? baht(d.plannedPrice) : <span className="text-xs text-muted-subtle">ยังไม่ตั้ง</span>}</td>
                    {!costHidden && <td className="px-3 py-2.5 text-right tabular-nums">{pct === null ? "—" : `${pct.toFixed(1)}%`}</td>}
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground">{thDate(d.updatedAt.slice(0, 10))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!costHidden && branchName && <p className="border-t border-border px-3 py-2 text-xs text-muted-subtle">ต้นทุนคิดจากราคาวัตถุดิบที่{branchName} ณ วันนี้ · เปิดร่างเพื่อเปลี่ยนสาขาที่ใช้คิด</p>}
        </div>
      )}

      {open && (
        <LabSheet
          key={open.n}
          draft={openRow}
          menus={props.menus}
          factDays={props.factDays}
          categories={props.categories}
          branches={props.branches}
          defaultBranchId={props.defaultBranchId}
          today={props.today}
          costHidden={costHidden}
          canPublish={props.canPublish}
          canWrite={props.canWrite}
          viewerId={props.viewerId}
          books={books}
          needBook={needBook}
          options={options}
          standards={standards}
          onClose={close}
          onToast={setToast}
          onSaved={(id) => {
            dropBooks();
            needBook(props.defaultBranchId);
            setOpen((o) => (o ? { ...o, id } : o));
            setAddress(id, false);
            router.refresh();
          }}
          onGone={() => {
            close();
            router.refresh();
          }}
          onPublished={(menuId) => {
            close();
            router.push(`/menus?menu=${menuId}` as Route);
          }}
        />
      )}

      {toast && (
        <Portal>
          <div role="status" className="fixed bottom-6 left-1/2 z-[80] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground shadow-card">
            {toast}
          </div>
        </Portal>
      )}
    </div>
  );
}

/** ADR 0041 — where a draft is on its way to the kitchen. */
export const STATUS_TH: Record<LabDraft["draftStatus"], string> = { DRAFT: "ร่าง", SUBMITTED: "รอรับรอง", ENDORSED: "รับรองแล้ว" };

export function StatusChip({ status }: { status: LabDraft["draftStatus"] }) {
  if (status === "DRAFT") return null;
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${status === "ENDORSED" ? "bg-good-bg text-good" : "border border-warn-border text-warn"}`}>
      {STATUS_TH[status]}
    </span>
  );
}

/**
 * A draft waits for this viewer when they can move it forward: a manager for
 * a proposed draft someone else wrote; whoever applies to every branch also
 * for an endorsed one.
 */
export function waitsFor(d: LabDraft, v: { canWrite: boolean; canPublish: boolean; viewerId: string }): boolean {
  if (!v.canWrite || d.authorId === v.viewerId) return false;
  return d.draftStatus === "SUBMITTED" || (d.draftStatus === "ENDORSED" && v.canPublish);
}
