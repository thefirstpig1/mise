"use client";

// One dish, in a sheet over the list (Kong, 2026-10-04; mockup
// https://claude.ai/artifact/NquaaTFahRgeSmPsyzxor5). Everything about the dish
// is here and edited in place: name, category, department, selling or not, and
// its recipe — with one save at the bottom that writes only what changed.
//
// Rules this sheet keeps, each decided before it existed:
//   - × always closes and saves nothing; a toast names what was dropped (Kong).
//   - A recipe change asks once more, in a short box that names what changed,
//     what it costs, which branches get it and from when (ConfirmDialog).
//   - "ใช้กับ": the central recipe lands on every branch and needs shared reach;
//     "เฉพาะสาขา X" makes that branch's own line from the effective date
//     (saveRecipeForBranchAction) and it never follows central again (ADR 0021
//     Q8). A manager of one branch always saves for their branch.
//   - Saving with the SAME date as the version being edited corrects that
//     version; a later date makes a new one (ADR 0021 Q4) — the date is shown
//     beside the button for exactly that reason.
//   - Saving name / category / department clears รอตรวจ (Part 19); merging is
//     not done here (ADR 0026); เลิกขาย is reversible and ลบ goes to the server,
//     which refuses where deleting would break something (ADR 0027).
//   - Cost never appears without its confidence, and never to a reader without
//     the ticket (ADR 0029 Q12).

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getIngredientOptionsAction, getMenuSheetAction } from "@/app/(app)/menus/manager-actions";
import { createRecipeAction, deleteRecipeAction, saveRecipeForBranchAction, updateRecipeAction, type RecipeActionState } from "@/app/(app)/recipes/actions";
import { confirmMenuAliasAction, getMenuSuggestionsAction, updateMenuAction, type MenuAliasActionState } from "@/app/(app)/menus/actions";
import { deleteMenuAction, setMenuActiveAction } from "@/app/(app)/menus/lifecycle-actions";
import { RETIRE_MEANS_TH, RETIRE_NOT_IN_POS_TH } from "@/lib/validations/menu-lifecycle";
import type { IngredientOption, MenuSheet as SheetData } from "@/server/menu-manager";
import { rankBySearch, hasQuery, highlightRuns, STRONG_MATCH, type SearchField } from "@/lib/smart-search";
import { orStale } from "@/lib/stale-tab";
import type { MergeMenuView } from "./menu-merge-view";
import type { MenuSuggestionRowView } from "./menu-view";
import type { ManagerRow, Option, Perm } from "./MenuManager";
import { baht, confidenceHintTh, confidenceTh, newSubmitKey, qtyFmt, thDate, unitTh } from "./manager-format";
import { ConfirmDialog, type ConfirmSpec, PhotoSlot, Sheet } from "./sheet-parts";
import IngredientSheet from "./IngredientSheet";

type Line = {
  key: string;
  kind: "product" | "menu";
  productId: string | null;
  componentMenuId: string | null;
  label: string;
  sku: string | null;
  prepped: boolean;
  qty: string;
  unitId: string | null;
  unitName: string | null;
  ratio: number;
  notes: string;
  /** Baht per base unit (per serving for a menu); null = no price known here. */
  perBase: number | null;
};

let keySeq = 0;
const nextKey = () => `n${++keySeq}`;
const qtyOf = (l: Line) => (Number.isFinite(Number(l.qty)) ? Number(l.qty) : 0);
const lineCost = (l: Line) => (l.perBase === null ? null : qtyOf(l) * l.ratio * l.perBase);
const signature = (lines: Line[], servings: number) =>
  JSON.stringify([servings, lines.map((l) => [l.productId, l.componentMenuId, qtyOf(l), l.unitId, l.notes.trim()])]);

function Marked({ text, marks }: { text: string; marks: readonly number[] }) {
  return (
    <>
      {highlightRuns(text, marks).map((r, i) =>
        r.hit ? (
          <mark key={i} className="rounded-sm bg-highlight px-px text-inherit">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        )
      )}
    </>
  );
}

export default function MenuSheet(props: {
  menu: ManagerRow;
  factDays: number;
  branch: Option;
  branches: Option[];
  today: string;
  categories: Option[];
  departments: Option[];
  departmentsEnabled: boolean;
  posIntegrationId: string | null;
  spellings: MergeMenuView[];
  mergedIntoLabel: string | null;
  costHidden: boolean;
  perm: Perm;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string) => void;
}) {
  const { menu, branch, branches, today, costHidden, perm, onToast } = props;
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<IngredientOption[] | null>(null);

  // ---- the draft ----
  const [name, setName] = useState(menu.name);
  const [categoryId, setCategoryId] = useState(menu.menuCategoryId ?? "");
  const [departmentId, setDepartmentId] = useState(menu.primaryDepartmentId ?? "");
  const [retired, setRetired] = useState(menu.isRetired);
  const [lines, setLines] = useState<Line[]>([]);
  const [baseLines, setBaseLines] = useState<Line[]>([]);
  const [servings, setServings] = useState(1);
  const [notes, setNotes] = useState("");
  const [eff, setEff] = useState(today);
  const [scope, setScope] = useState<string>("all");
  const [showNotes, setShowNotes] = useState(false);

  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [ing, setIng] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const toLines = (s: SheetData): Line[] =>
    (s.recipe?.lines ?? []).map((l) => ({
      key: l.ingredientId,
      kind: l.kind,
      productId: l.productId,
      componentMenuId: l.componentMenuId,
      label: l.label,
      sku: l.sku,
      prepped: l.prepped,
      qty: String(l.qty),
      unitId: l.unitId,
      unitName: l.unitName,
      ratio: l.kind === "menu" ? 1 : l.toBaseRatio,
      notes: l.notes ?? "",
      perBase: l.cost === null || l.qty <= 0 ? null : l.cost / (l.qty * (l.kind === "menu" ? 1 : l.toBaseRatio)),
    }));

  const load = async () => {
    const res = await orStale(getMenuSheetAction(menu.id, branch.id));
    if (!res.ok) return setLoadError("error" in res ? res.error : "เปิดไม่ได้");
    setSheet(res.sheet);
    const ls = toLines(res.sheet);
    setLines(ls);
    setBaseLines(ls);
    setServings(res.sheet.recipe?.servings ?? 1);
    setNotes(res.sheet.recipe?.notes ?? "");
    setEff(today);
  };
  useEffect(() => {
    void load();
    if (perm.recipe) void orStale(getIngredientOptionsAction(branch.id)).then((r) => r.ok && setOptions(r.options));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.id, branch.id]);

  const recipe = sheet?.recipe ?? null;
  const isOwnLine = recipe !== null && recipe.branchIds.length > 0;
  const recipeEditable = perm.recipe && (perm.recipeShared || true); // a manager edits FOR their branch
  // Where a save lands. A branch's own line is edited as itself; a central (or
  // missing) recipe goes to every branch for someone with shared reach, and to
  // this branch for anyone else.
  const fixedScope: { kind: "line"; label: string } | { kind: "branch"; id: string } | null = isOwnLine
    ? { kind: "line", label: recipe!.branchNames.join(", ") }
    : !perm.recipeShared
      ? { kind: "branch", id: branch.id }
      : null;
  const scopeNow = fixedScope === null ? scope : fixedScope.kind === "branch" ? fixedScope.id : "line";

  const metaDirty: string[] = [];
  if (perm.editMenu) {
    if (name.trim() !== menu.name) metaDirty.push("ชื่อ");
    if (categoryId !== (menu.menuCategoryId ?? "")) metaDirty.push("หมวด");
    if (props.departmentsEnabled && departmentId !== (menu.primaryDepartmentId ?? "")) metaDirty.push("แผนก");
    if (retired !== menu.isRetired) metaDirty.push("สถานะ");
  }
  const recipeDirty = sheet !== null && signature(lines, servings) !== signature(baseLines, recipe?.servings ?? 1) || (sheet !== null && notes.trim() !== (recipe?.notes ?? "").trim());
  const dirty = [...metaDirty, ...(recipeDirty ? ["สูตร"] : [])];

  // ---- numbers ----
  const avg = menu.qty > 0 ? menu.net / menu.qty : null;
  const known = lines.every((l) => l.perBase !== null);
  const total = lines.reduce((s, l) => s + (lineCost(l) ?? 0), 0);
  const perPlate = lines.length === 0 ? null : total / (servings || 1);
  const basePerPlate = recipe?.costPerServing ?? null;
  const costChanged = recipeDirty && perPlate !== null && basePerPlate !== null && Math.abs(perPlate - basePerPlate) > 0.004;

  const facts = sheet?.facts ?? null;
  const stockLine = (l: Line) => {
    if (l.kind === "menu") return null;
    if (l.prepped) return <span>คงเหลือ: ยังไม่รู้ (ยังไม่มีการบันทึกการผลิต)</span>;
    const f = l.productId ? facts?.facts[l.productId] : undefined;
    if (!f) return null;
    return (
      <span className={f.belowPar ? "text-warn" : ""}>
        คงเหลือ {qtyFmt(f.onHand, f.baseUnitName)}
        {f.daysLeft !== null ? ` · พอ ~${f.daysLeft} วัน` : ""}
        {f.belowPar ? " · ต่ำกว่าขั้นต่ำ" : ""}
      </span>
    );
  };
  const plates = useMemo(() => {
    if (lines.length === 0 || !facts) return null;
    const prepped = lines.find((l) => l.prepped);
    if (prepped) return { blocked: prepped.label } as const;
    let best: { plates: number; label: string } | null = null;
    for (const l of lines) {
      const f = l.kind === "product" && l.productId ? facts.facts[l.productId] : undefined;
      const per = (qtyOf(l) * l.ratio) / (servings || 1);
      if (!f || per <= 0) continue;
      const p = Math.max(0, Math.floor(f.onHand / per));
      if (best === null || p < best.plates) best = { plates: p, label: l.label };
    }
    return best;
  }, [lines, facts, servings]);

  // ---- editing ----
  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = (o: IngredientOption) => {
    const base = o.units.find((u) => u.isBase) ?? o.units[0];
    setLines((ls) => [
      ...ls,
      {
        key: nextKey(),
        kind: o.kind,
        productId: o.kind === "product" ? o.id : null,
        componentMenuId: o.kind === "menu" ? o.id : null,
        label: o.name,
        sku: o.sku,
        prepped: o.prepped,
        qty: "",
        unitId: base?.id ?? null,
        unitName: base?.unitName ?? (o.kind === "menu" ? "จาน" : null),
        ratio: base?.toBaseRatio ?? 1,
        notes: "",
        perBase: o.costPerBase,
      },
    ]);
  };

  const close = () => {
    if (dirty.length) onToast(`ปิดแล้ว · ไม่ได้บันทึก ${dirty.join(" · ")}`);
    props.onClose();
  };

  // ---- saving ----
  const recipeForm = () => {
    const fd = new FormData();
    fd.set("submit_key", newSubmitKey());
    fd.set("menu_id", menu.id);
    fd.set("output_product_id", "");
    fd.set("servings", String(servings));
    fd.set("effective_from", eff);
    fd.set("notes", notes);
    for (const l of lines) {
      fd.append("ingredient_product_id", l.productId ?? "");
      fd.append("ingredient_component_menu_id", l.componentMenuId ?? "");
      fd.append("ingredient_qty", l.qty);
      fd.append("ingredient_product_unit_id", l.unitId ?? "");
      fd.append("ingredient_notes", l.notes);
    }
    return fd;
  };
  const errorOf = (res: RecipeActionState | { ok: false; formError?: string; fieldErrors?: Record<string, string> }) =>
    res.ok ? null : (res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "บันทึกไม่ได้");

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? branch.name;

  const doSave = (target: string) =>
    startSaving(async () => {
      setFormError(null);
      if (metaDirty.some((d) => d !== "สถานะ")) {
        const fd = new FormData();
        fd.set("menuId", menu.id);
        fd.set("name", name.trim());
        fd.set("menuCategoryId", categoryId);
        fd.set("primaryDepartmentId", departmentId);
        const res = await orStale(updateMenuAction(null, fd));
        if (res && !res.ok) return setFormError(res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "บันทึกไม่ได้");
      }
      if (metaDirty.includes("สถานะ")) {
        const res = await orStale(setMenuActiveAction(menu.id, menu.isRetired));
        if (!res.ok) return setFormError(res.error);
      }
      if (recipeDirty) {
        const fd = recipeForm();
        const res =
          target === "all"
            ? recipe === null
              ? await orStale(createRecipeAction({ ok: false }, fd))
              : await orStale(updateRecipeAction(recipe.id, { ok: false }, fd))
            : target === "line"
              ? await orStale(updateRecipeAction(recipe!.id, { ok: false }, fd))
              : await orStale(saveRecipeForBranchAction(target, { ok: false }, fd));
        const err = errorOf(res);
        if (err) return setFormError(err);
      }
      const where = !recipeDirty ? "" : target === "all" ? " · ทุกสาขา" : target === "line" ? ` · ${fixedScope?.kind === "line" ? fixedScope.label : ""}` : ` · เฉพาะ${branchName(target)}`;
      onToast(`บันทึกแล้ว${where}${recipeDirty ? ` · มีผลตั้งแต่ ${thDate(eff)}` : ""}`);
      props.onSaved();
      await load();
    });

  const diffLines = (): string[] => {
    const out: string[] = [];
    const before = new Map(baseLines.map((l) => [l.productId ?? l.componentMenuId, l]));
    for (const l of lines) {
      const o = before.get(l.productId ?? l.componentMenuId);
      if (!o) out.push(`เพิ่ม ${l.label} ${l.qty || "?"} ${unitTh(l.unitName)}`);
      else if (qtyOf(o) !== qtyOf(l) || o.unitId !== l.unitId) out.push(`${l.label} ${o.qty} ${unitTh(o.unitName)} → ${l.qty} ${unitTh(l.unitName)}`);
    }
    for (const o of baseLines) if (!lines.some((l) => (l.productId ?? l.componentMenuId) === (o.productId ?? o.componentMenuId))) out.push(`เอาออก ${o.label}`);
    if (servings !== (recipe?.servings ?? 1)) out.push(`สูตรนี้ทำได้ ${recipe?.servings ?? 1} → ${servings} จาน`);
    if (out.length === 0 && notes.trim() !== (recipe?.notes ?? "").trim()) out.push("แก้หมายเหตุ");
    return out;
  };

  const askSave = () => {
    if (!recipeDirty) return doSave(scopeNow);
    const target = scopeNow;
    const others = branches.filter((b) => b.id !== target).map((b) => b.name);
    const money =
      costHidden || perPlate === null
        ? null
        : basePerPlate === null
          ? `ต้นทุนต่อจาน ${baht(perPlate, 2)}${known ? "" : " (บางตัวยังไม่มีราคา)"}`
          : `ต้นทุนต่อจาน ${baht(basePerPlate, 2)} → ${baht(perPlate, 2)} (${perPlate >= basePerPlate ? "+" : "−"}${baht(Math.abs(perPlate - basePerPlate), 2)})`;
    // Same date as the version being edited = a correction of THAT version. Only
    // true when the save lands on the same line — saving for one branch starts
    // a line of its own and corrects nothing.
    const sameLine = target === "line" || (target === "all" && !isOwnLine);
    const correcting = recipe !== null && sameLine && recipe.effectiveFrom === eff;
    const dateNote =
      recipe === null
        ? `มีผลตั้งแต่ ${thDate(eff)} · ยอดขายก่อนวันนั้นยังไม่มีสูตร`
        : correcting
          ? `แก้สูตรของวันที่ ${thDate(eff)} (แทนที่เวอร์ชันเดิมของวันนั้น)`
          : `มีผลตั้งแต่ ${thDate(eff)} · วันก่อนหน้ายังคิดด้วยสูตรเดิม`;
    const spec: ConfirmSpec =
      target === "all"
        ? {
            title: `ใช้สูตรใหม่ของ${name}กับทุกสาขา?`,
            lines: diffLines(),
            money,
            who: `${branches.length > 1 ? branches.map((b) => b.name).join(" และ ") : branch.name} · ${dateNote} · สาขาที่มีสูตรของตัวเองไม่เปลี่ยน`,
            go: branches.length > 1 ? `ใช้กับทุกสาขา (${branches.length})` : "ใช้สูตรนี้",
            onGo: () => doSave("all"),
          }
        : target === "line"
          ? {
              title: `ใช้สูตรใหม่ของ${name}ที่${fixedScope?.kind === "line" ? fixedScope.label : branch.name}?`,
              lines: diffLines(),
              money,
              who: `สูตรของสาขา · ${dateNote}`,
              go: "ใช้สูตรนี้",
              onGo: () => doSave("line"),
            }
          : {
              title: `ใช้สูตรใหม่เฉพาะ${branchName(target)}?`,
              lines: diffLines(),
              money: money && target !== branch.id ? `${money} (ราคาที่${branch.name})` : money,
              who: `${recipe === null ? "" : `${branchName(target)}จะมีสูตรของตัวเองและไม่ตามสูตรกลางอีก · `}${others.length ? `${others.join(", ")}ยังใช้สูตรเดิม · ` : ""}${dateNote}`,
              go: `ใช้เฉพาะ${branchName(target)}`,
              onGo: () => doSave(target),
            };
    setConfirm(spec);
  };

  const revert = () => {
    setName(menu.name);
    setCategoryId(menu.menuCategoryId ?? "");
    setDepartmentId(menu.primaryDepartmentId ?? "");
    setRetired(menu.isRetired);
    setLines(baseLines);
    setServings(recipe?.servings ?? 1);
    setNotes(recipe?.notes ?? "");
    setEff(today);
    setFormError(null);
  };

  // ---- other actions ----
  const backToCentral = () =>
    setConfirm({
      title: `ให้${branch.name}กลับไปใช้สูตรกลาง?`,
      lines: [`สูตรของ${recipe?.branchNames.join(", ")}จะถูกลบ`],
      money: null,
      who: "ทุกวันที่ผ่านมาของสาขานี้จะคิดด้วยสูตรกลางด้วย ถ้าต้องการให้วันที่ผ่านมาคงเดิม ให้แก้สูตรของสาขาให้เหมือนสูตรกลางแทน",
      go: "กลับไปใช้สูตรกลาง",
      onGo: () =>
        startSaving(async () => {
          const res = await orStale(deleteRecipeAction(recipe!.id, true));
          if (!res.ok) return setFormError(res.error);
          onToast(`${branch.name}กลับไปใช้สูตรกลางแล้ว`);
          props.onSaved();
          await load();
        }),
    });

  const removeRecipe = (ack = false) =>
    startSaving(async () => {
      const res = await orStale(deleteRecipeAction(recipe!.id, ack));
      if (res.ok) {
        onToast("ลบสูตรแล้ว");
        props.onSaved();
        return void (await load());
      }
      if (res.needsAcknowledgement)
        return setConfirm({
          title: "ลบสูตรนี้?",
          lines: res.needsAcknowledgement.mergedMenuNames.map((n) => `${n} ใช้สูตรนี้ตัดสต๊อกอยู่`),
          money: null,
          who: "ถ้าลบ เมนูเหล่านี้จะขายต่อไปโดยไม่ตัดสต๊อกเลย",
          go: "ลบสูตรพร้อมผลกระทบนี้",
          onGo: () => removeRecipe(true),
        });
      setFormError(res.error);
    });

  const [deleteArmed, setDeleteArmed] = useState<number | null>(null);
  const removeMenu = (ack: boolean) =>
    startSaving(async () => {
      const res = await orStale(deleteMenuAction(menu.id, ack));
      if (res.ok) {
        onToast(`ลบ “${menu.name}” แล้ว`);
        props.onSaved();
        return props.onClose();
      }
      if (res.needsAcknowledgement) {
        setDeleteArmed(res.needsAcknowledgement.recipeCount);
        return setConfirm({
          title: `ลบ “${menu.name}” พร้อมสูตร?`,
          lines: [`เมนูนี้มีสูตรของตัวเอง ${res.needsAcknowledgement.recipeCount} รายการ ซึ่งจะถูกลบไปด้วย`],
          money: null,
          who: `${RETIRE_MEANS_TH} · ${RETIRE_NOT_IN_POS_TH}`,
          go: `ลบพร้อมสูตร ${res.needsAcknowledgement.recipeCount} รายการ`,
          onGo: () => removeMenu(true),
        });
      }
      setFormError(res.error);
    });
  void deleteArmed;

  // ---- render ----
  const dishCost = total || null;
  const openLine = ing === null ? null : lines.find((l) => l.productId === ing) ?? null;

  return (
    <Sheet onClose={close} labelledBy="menu-sheet-title">
      <div className="flex items-start gap-3 border-b border-border bg-surface px-5 py-4">
        <PhotoSlot size={84} label="รูปเมนู" />
        <div className="min-w-0 flex-1 space-y-1.5">
          {perm.editMenu ? (
            <input
              id="menu-sheet-title"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="ชื่อเมนู"
              className="-ml-1.5 w-full rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 font-display text-xl font-semibold hover:border-border focus:border-border-strong focus:bg-surface focus:outline-none"
            />
          ) : (
            <h3 id="menu-sheet-title" className="font-display text-xl font-semibold">
              {menu.name}
            </h3>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {menu.posMenuCode && <span className="rounded-full border border-border bg-surface-sunk px-2 py-0.5 tabular-nums" title="มาจากไฟล์ POS แก้ที่นี่ไม่ได้">รหัส POS {menu.posMenuCode}</span>}
            {perm.editMenu ? (
              <>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="หมวดเมนู" className="rounded-full border border-border bg-surface px-2 py-0.5">
                  <option value="">— ไม่ระบุหมวด —</option>
                  {props.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {props.departmentsEnabled && (
                  <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="แผนกที่รับรายได้" className="rounded-full border border-border bg-surface px-2 py-0.5">
                    <option value="">— แผนกที่รับรายได้ —</option>
                    {props.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
                <select value={retired ? "retired" : "selling"} onChange={(e) => setRetired(e.target.value === "retired")} aria-label="สถานะ" className="rounded-full border border-border bg-surface px-2 py-0.5">
                  <option value="selling">ขายอยู่</option>
                  <option value="retired">เลิกขายแล้ว</option>
                </select>
              </>
            ) : (
              <span className="text-muted-foreground">
                {menu.menuCategoryName ?? "ไม่มีหมวด"} · {menu.isRetired ? "เลิกขายแล้ว" : "ขายอยู่"}
              </span>
            )}
            {menu.isPosStub && <span className="badge">รอตรวจ</span>}
          </div>
          {menu.posName && <p className="text-xs text-muted-foreground">{menu.posName}</p>}
        </div>
        <button type="button" onClick={close} aria-label="ปิด" className="rounded-lg px-2 text-2xl leading-none text-muted-foreground hover:bg-muted">
          ×
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {menu.todoLabel && (
          <p className="text-sm text-warn">
            {menu.todoLabel}
            {menu.consequenceLabel && <span> — {menu.consequenceLabel}</span>}
          </p>
        )}
        {menu.lastSoldLabel && <p className="text-sm text-muted-foreground">{menu.lastSoldLabel}</p>}
        {props.mergedIntoLabel && <p className="text-sm text-muted-foreground">นับรวมเป็น “{props.mergedIntoLabel}” — รายการนี้ยังรับยอดขายใหม่ตามปกติ</p>}

        <div className={`grid gap-2 ${costHidden ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}>
          <Tile k={`ขาย ${props.factDays} วัน`} v={menu.qty > 0 ? `${menu.qty.toLocaleString("th-TH")} จาน` : "—"} s={menu.qty > 0 ? baht(menu.net) : "ยังไม่มียอดขาย"} />
          <Tile k="ราคาเฉลี่ยที่ขายจริง" v={avg === null ? "—" : baht(avg)} s="หลังส่วนลด ไม่รวม VAT" />
          {!costHidden && (
            <Tile
              k="ต้นทุนต่อจาน"
              v={perPlate === null ? "—" : baht(perPlate, 2)}
              s={
                perPlate === null
                  ? "ยังไม่มีสูตร"
                  : costChanged
                    ? `เดิม ${baht(basePerPlate!, 2)}`
                    : !known
                      ? "บางตัวยังไม่มีราคา"
                      : recipe?.confidence
                        ? `ความมั่นใจ${confidenceTh(recipe.confidence)} · ${branch.name}`
                        : branch.name
              }
              warn={costChanged || (!!recipe?.confidence && recipe.confidence !== "HIGH")}
              title={recipe?.confidence ? confidenceHintTh(recipe.confidence) : undefined}
            />
          )}
          {!costHidden && (
            <Tile
              k="ต้นทุน % · กำไรต่อจาน"
              v={perPlate !== null && avg ? `${((perPlate / avg) * 100).toFixed(1)}%` : "—"}
              s={perPlate !== null && avg ? `กำไร ${baht(avg - perPlate, 2)}/จาน` : perPlate === null ? "คิดได้เมื่อมีสูตร" : "ยังไม่มียอดขาย"}
              warn={costChanged}
            />
          )}
        </div>

        {/* ---------------- recipe ---------------- */}
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">สูตร</h4>
            {sheet && (
              <span className="badge">
                {recipe === null ? "ยังไม่มีสูตร" : isOwnLine ? `สูตรของ${recipe.branchNames.join(", ")} · ไม่ตามสูตรกลาง` : "สูตรกลาง · ใช้ทุกสาขาที่ไม่มีสูตรของตัวเอง"}
                {" · "}
                {recipeEditable && sheet ? (
                  <>
                    ทำได้{" "}
                    <input
                      type="number"
                      min="1"
                      step="any"
                      value={servings}
                      onChange={(e) => setServings(Math.max(0, Number(e.target.value) || 0))}
                      className="w-12 rounded border border-border bg-surface px-1 text-right tabular-nums"
                      aria-label="สูตรนี้ทำได้กี่จาน"
                    />{" "}
                    จาน
                  </>
                ) : (
                  `ทำได้ ${servings} จาน`
                )}
              </span>
            )}
          </div>

          {!sheet && !loadError && <div className="h-32 animate-pulse rounded-lg bg-muted" />}
          {loadError && <p className="text-sm text-bad">{loadError}</p>}

          {sheet && perm.recipe && !perm.recipeShared && !isOwnLine && (
            <p className="text-xs text-muted-foreground">
              {recipe === null ? "สูตรที่คุณเขียนจะใช้" : "นี่คือสูตรกลาง ที่คุณแก้จะใช้"}
              <b className="text-foreground">เฉพาะ{branch.name}</b> สาขาอื่นยังใช้สูตรกลางเหมือนเดิม
            </p>
          )}

          {sheet && lines.length === 0 && (
            <div className="rounded-lg border-[1.5px] border-dashed border-border-strong bg-surface-sunk p-3 text-sm text-muted-foreground">
              <b className="text-foreground">ยังไม่มีสูตร</b>
              {menu.qty > 0 ? ` · ${props.factDays} วันที่ผ่านมาขายไป ${menu.qty.toLocaleString("th-TH")} จาน (${baht(menu.net)}) แต่ยังคิดต้นทุนและตัดสต๊อกไม่ได้` : ""}
              {menu.hasDraft && " · มีร่างใน “ทดลองเมนู”"}
              {perm.recipe ? " · เริ่มจากวัตถุดิบหลักก่อนก็ได้ แล้วค่อยเติมทีหลัง" : ""}
            </div>
          )}

          {sheet && lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">วัตถุดิบ</th>
                    <th className="py-1 text-right font-medium">ปริมาณ</th>
                    <th className="py-1 pl-2 font-medium">หน่วย</th>
                    {!costHidden && <th className="py-1 text-right font-medium">ต้นทุน</th>}
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((l) => {
                    const o = baseLines.find((b) => (b.productId ?? b.componentMenuId) === (l.productId ?? l.componentMenuId));
                    const changed = !o ? "bg-good-bg" : qtyOf(o) !== qtyOf(l) || o.unitId !== l.unitId ? "bg-warn-bg" : "";
                    const units = options?.find((x) => x.kind === "product" && x.id === l.productId)?.units ?? [];
                    const c = lineCost(l);
                    return (
                      <tr
                        key={l.key}
                        className={`${l.kind === "product" ? "cursor-pointer hover:bg-muted/60" : ""} ${changed}`}
                        onClick={(e) => {
                          if (l.kind !== "product" || !l.productId) return;
                          if ((e.target as HTMLElement).closest("input,select,button")) return;
                          setIng(l.productId);
                        }}
                      >
                        <td className="py-1.5 pr-2">
                          <span>{l.label}</span>
                          {l.prepped && <span className="ml-1.5 rounded border border-warn-border bg-warn-bg px-1 text-[10px] text-warn">ของแปรรูป</span>}
                          {l.kind === "menu" && <span className="ml-1.5 rounded border border-border px-1 text-[10px] text-muted-foreground">เมนู</span>}
                          <span className="block text-[11px] text-muted-subtle">{stockLine(l)}</span>
                          {!costHidden && c !== null && total > 0 && (
                            <span className="mt-0.5 block h-1 rounded-full bg-border-strong/60" style={{ width: `${Math.max(2, (c / total) * 100)}%` }} />
                          )}
                          {showNotes && recipeEditable && (
                            <input value={l.notes} onChange={(e) => setLine(l.key, { notes: e.target.value })} placeholder="หมายเหตุของบรรทัดนี้" className="input mt-1 w-full py-0.5 text-xs" aria-label={`หมายเหตุ ${l.label}`} />
                          )}
                          {!showNotes && l.notes && <span className="block text-[11px] italic text-muted-foreground">{l.notes}</span>}
                        </td>
                        <td className="py-1.5 text-right">
                          {recipeEditable ? (
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={l.qty}
                              autoFocus={l.qty === "" && !o}
                              onChange={(e) => setLine(l.key, { qty: e.target.value })}
                              className="input w-20 py-0.5 text-right tabular-nums"
                              aria-label={`ปริมาณ ${l.label}`}
                            />
                          ) : (
                            <span className="tabular-nums">{l.qty}</span>
                          )}
                        </td>
                        <td className="py-1.5 pl-2">
                          {recipeEditable && units.length > 1 ? (
                            <select
                              value={l.unitId ?? ""}
                              onChange={(e) => {
                                const u = units.find((x) => x.id === e.target.value)!;
                                setLine(l.key, { unitId: u.id, unitName: u.unitName, ratio: u.toBaseRatio });
                              }}
                              className="rounded border border-border bg-surface px-1 py-0.5 text-sm"
                              aria-label={`หน่วย ${l.label}`}
                            >
                              {units.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {unitTh(u.unitName)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            unitTh(l.unitName) || (l.kind === "menu" ? "จาน" : "")
                          )}
                        </td>
                        {!costHidden && <td className="py-1.5 text-right tabular-nums">{c === null ? <span className="text-xs text-warn">ไม่มีราคา</span> : baht(c, 2)}</td>}
                        <td className="py-1.5 text-right">
                          {recipeEditable && (
                            <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`เอา ${l.label} ออก`} className="rounded px-1.5 text-muted-subtle hover:bg-bad-bg hover:text-bad">
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {sheet && recipeEditable && <Adder options={options} exclude={new Set([...lines.map((l) => l.productId ?? l.componentMenuId ?? ""), menu.id])} costHidden={costHidden} onPick={add} />}
          {sheet && !perm.recipe && <p className="rounded-lg bg-surface-sunk p-3 text-sm text-muted-foreground"><b className="text-foreground">ดูได้อย่างเดียว</b> ถ้าสูตรไม่ตรงกับที่ทำจริง แจ้งหัวหน้าหรือผู้จัดการสาขา</p>}

          {sheet && lines.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
              {!costHidden && perPlate !== null && (
                <p className="flex justify-between gap-2">
                  <span>รวมต้นทุนต่อจาน · ราคาวัตถุดิบที่{branch.name} ณ วันนี้</span>
                  <b className="font-display text-sm text-foreground tabular-nums">{baht(perPlate, 2)}</b>
                </p>
              )}
              {!costHidden && recipe && recipe.unpriced.length > 0 && (
                <p className="text-warn">
                  ยังไม่รู้ต้นทุนของ {recipe.unpriced.join(", ")} ที่{branch.name} — ตัวเลขนี้ต่ำกว่าความจริง ·{" "}
                  <a href="/cost" className="underline">
                    ระบุต้นทุน
                  </a>
                </p>
              )}
              {plates && "blocked" in plates ? (
                <p>ของในสต๊อกพอทำได้อีกกี่จาน: คิดไม่ได้ เพราะยังไม่รู้ว่ามี{plates.blocked}เหลือเท่าไร</p>
              ) : plates ? (
                <p>
                  ของในสต๊อก{branch.name}พอทำจานนี้อีก <b className="text-foreground tabular-nums">~{plates.plates.toLocaleString("th-TH")} จาน</b> · ติดที่{plates.label}ก่อน (ถ้าไม่เอาไปใช้กับเมนูอื่น)
                </p>
              ) : null}
              {facts?.postedThrough && <p>คงเหลือตามระบบ ตัดสต๊อกตามยอดขายถึง {thDate(facts.postedThrough, false)}</p>}
              {recipeEditable && (
                <button type="button" onClick={() => setShowNotes((v) => !v)} className="underline decoration-dotted underline-offset-2 hover:text-foreground">
                  {showNotes ? "ซ่อนหมายเหตุ" : "หมายเหตุ"}
                </button>
              )}
              {showNotes && recipeEditable && (
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="หมายเหตุของสูตร เช่น วิธีทำ" className="input w-full text-sm" aria-label="หมายเหตุของสูตร" />
              )}
              {!showNotes && recipe?.notes && <p className="italic">{recipe.notes}</p>}
            </div>
          )}
        </section>

        {sheet && sheet.history.length > 0 && (
          <details className="rounded-xl border border-border bg-surface p-4">
            <summary className="cursor-pointer font-semibold">ประวัติสูตร ({sheet.history.length})</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {sheet.history.map((h) => (
                <li key={h.recipeId} className={`flex justify-between gap-2 ${h.isSuperseded ? "text-muted-subtle line-through" : ""}`}>
                  <span>ตั้งแต่ {thDate(h.effectiveFrom)}</span>
                  <span className="text-xs">{h.isCurrent ? <span className="text-good">● ใช้อยู่</span> : h.isSuperseded ? "แก้ทับแล้ว" : "เวอร์ชันก่อน"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">ทุกครั้งที่บันทึกสูตร ระบบเก็บเวอร์ชันใหม่ต่อท้าย วันก่อนหน้ายังคิดต้นทุนด้วยสูตรเดิม</p>
          </details>
        )}

        {props.spellings.length > 0 && (
          <section className="rounded-xl border border-border bg-surface p-4 text-sm">
            <p className="font-medium">ชื่ออื่นที่รวมเข้ากับเมนูนี้แล้ว</p>
            <ul className="mt-1 space-y-0.5 border-l-2 border-border pl-3">
              {props.spellings.map((s) => (
                <li key={s.id} className="text-muted-foreground">
                  {s.label} · {s.originLabel}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              ชื่อเหล่านี้ยังรับยอดขายใหม่ทุกวัน — แก้หรือยกเลิกการรวมได้ที่{" "}
              <a href="/menus/merges" className="underline">
                หน้ารวมเมนู
              </a>
            </p>
          </section>
        )}

        {perm.editMenu && props.posIntegrationId && menu.posMenuName && <AliasBlock menu={menu} posIntegrationId={props.posIntegrationId} />}

        {(perm.editMenu || perm.deleteMenu || isOwnLine) && (
          <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
            <h4 className="font-semibold">อื่น ๆ</h4>
            <div className="flex flex-wrap gap-2">
              {isOwnLine && perm.recipe && (
                <button type="button" onClick={backToCentral} className="rounded-full border border-border-strong px-3 py-1 text-sm hover:bg-muted">
                  กลับไปใช้สูตรกลาง
                </button>
              )}
              {perm.editMenu && (
                <a href={`/menus/merges?menu=${menu.id}`} className="rounded-full border border-border-strong px-3 py-1 text-sm hover:bg-muted">
                  รวมกับเมนูที่ซ้ำ
                </a>
              )}
              {recipe && !isOwnLine && perm.recipeShared && (
                <button
                  type="button"
                  onClick={() =>
                    setConfirm({
                      title: `ลบสูตรของ${menu.name}?`,
                      lines: [`ทุกเวอร์ชันของสูตรกลางนี้จะถูกลบ`],
                      money: null,
                      who: "ยอดขายที่ยังไม่ได้ตัดสต๊อกจะคิดต้นทุนและตัดสต๊อกเมนูนี้ไม่ได้ จนกว่าจะเขียนสูตรใหม่ · สาขาที่มีสูตรของตัวเองไม่เปลี่ยน",
                      go: "ลบสูตร",
                      onGo: () => removeRecipe(false),
                    })
                  }
                  className="rounded-full border border-bad-border px-3 py-1 text-sm text-bad hover:bg-bad-bg"
                >
                  ลบสูตร
                </button>
              )}
              {perm.deleteMenu && (
                <button
                  type="button"
                  onClick={() =>
                    setConfirm({
                      title: `ลบ “${menu.name}” ออกจากระบบ?`,
                      lines: [],
                      money: null,
                      who: `${RETIRE_MEANS_TH} · ${RETIRE_NOT_IN_POS_TH}`,
                      go: "ลบเมนู",
                      onGo: () => removeMenu(false),
                    })
                  }
                  className="rounded-full border border-bad-border px-3 py-1 text-sm text-bad hover:bg-bad-bg"
                >
                  ลบเมนู
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {RETIRE_MEANS_TH} · {RETIRE_NOT_IN_POS_TH}
            </p>
          </section>
        )}
      </div>

      {/* ---------------- footer ---------------- */}
      {(perm.editMenu || perm.recipe) && (
        <div className="space-y-1 border-t border-border bg-surface px-5 py-3">
          {formError && <p className="text-sm text-bad">{formError}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
              {dirty.length === 0 ? (
                perm.recipe && !perm.editMenu ? "ชื่อและหมวดของเมนูแก้ได้เฉพาะเจ้าของร้าน ส่วนกลาง และผู้ดูแลทุกสาขา" : "ยังไม่มีอะไรเปลี่ยน"
              ) : (
                <>
                  แก้ {dirty.join(" · ")}
                  {recipeDirty && (
                    <>
                      {" · ใช้กับ "}
                      {fixedScope === null ? (
                        <select value={scope} onChange={(e) => setScope(e.target.value)} className="rounded border border-border-strong bg-surface px-1 py-0.5 text-foreground" aria-label="ใช้กับสาขาไหน">
                          <option value="all">ทุกสาขา (สูตรกลาง)</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              เฉพาะ{b.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <b className="text-foreground">{fixedScope.kind === "line" ? fixedScope.label : `เฉพาะ${branch.name}`}</b>
                      )}
                      {" · มีผลตั้งแต่ "}
                      <input type="date" value={eff} max={today} onChange={(e) => setEff(e.target.value)} className="rounded border border-border-strong bg-surface px-1 py-0.5 text-foreground" aria-label="วันที่สูตรใหม่มีผล" />
                    </>
                  )}
                </>
              )}
            </span>
            <span className="flex gap-2">
              {dirty.length > 0 && (
                <button type="button" onClick={revert} className="rounded-full border border-border-strong px-3 py-1.5 text-sm hover:bg-muted">
                  ยกเลิกการแก้
                </button>
              )}
              <button type="button" disabled={dirty.length === 0 || saving} onClick={askSave} className="btn">
                {saving ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </span>
          </div>
        </div>
      )}

      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
      {ing && (
        <IngredientSheet
          productId={ing}
          branch={branch}
          today={today}
          inThisDish={
            openLine
              ? {
                  dishName: name,
                  qty: qtyOf(openLine),
                  unitName: openLine.unitName,
                  toBaseRatio: openLine.ratio,
                  cost: lineCost(openLine),
                  dishCost,
                  servings: servings || 1,
                }
              : null
          }
          costHidden={costHidden}
          perm={perm}
          onClose={() => setIng(null)}
          onToast={onToast}
          onPreppedSaved={() => {
            props.onSaved();
            void load();
            void orStale(getIngredientOptionsAction(branch.id)).then((r) => r.ok && setOptions(r.options));
          }}
        />
      )}
    </Sheet>
  );
}

function Tile({ k, v, s, warn, title }: { k: string; v: string; s: string; warn?: boolean; title?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-2.5" title={title}>
      <p className="text-[11px] text-muted-subtle">{k}</p>
      <p className={`font-display text-lg font-semibold tabular-nums transition-colors ${warn ? "text-warn" : ""}`}>{v}</p>
      <p className="text-[11px] text-muted-foreground">{s}</p>
    </div>
  );
}

/** "+ เพิ่มวัตถุดิบ" — the app-wide smart search over products and dishes. */
function Adder({
  options,
  exclude,
  costHidden,
  onPick,
}: {
  options: IngredientOption[] | null;
  exclude: Set<string>;
  costHidden: boolean;
  onPick: (o: IngredientOption) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  const items = (options ?? []).filter((o) => !exclude.has(o.id));
  const fields: SearchField<IngredientOption>[] = [
    { get: (o) => o.name, kind: "name" },
    { get: (o) => o.sku, kind: "code" },
  ];
  const price = (o: IngredientOption) => {
    if (costHidden) return null;
    if (o.costPerBase === null) return <small className="text-xs text-muted-subtle">ยังไม่มีราคา</small>;
    const base = o.units.find((u) => u.isBase);
    return (
      <small className="text-xs tabular-nums text-muted-subtle">
        {baht(o.costPerBase, 2)}/{o.kind === "menu" ? "จาน" : unitTh(base?.unitName)}
      </small>
    );
  };
  const row = (o: IngredientOption, marks: { field: number | null; marks: number[] }, weak = false) => (
    <button
      key={`${o.kind}-${o.id}`}
      type="button"
      onClick={() => {
        onPick(o);
        setQ("");
        setOpen(false);
      }}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted ${weak ? "opacity-45" : ""}`}
    >
      <span className="min-w-0">
        {marks.field === 0 ? <Marked text={o.name} marks={marks.marks} /> : o.name}{" "}
        {o.sku && <small className="text-xs tabular-nums text-muted-subtle">{marks.field === 1 ? <Marked text={o.sku} marks={marks.marks} /> : o.sku}</small>}
        {o.prepped && <span className="ml-1 rounded border border-warn-border bg-warn-bg px-1 text-[10px] text-warn">ของแปรรูป</span>}
      </span>
      {price(o)}
    </button>
  );

  let list: React.ReactNode;
  if (options === null) list = <p className="px-2 py-2 text-xs text-muted-subtle">กำลังโหลดรายการ…</p>;
  else if (!hasQuery(q)) {
    const plain = { field: null, marks: [] as number[] };
    const prepped = items.filter((o) => o.kind === "product" && o.prepped);
    const raw = items.filter((o) => o.kind === "product" && !o.prepped).sort((a, b) => a.name.localeCompare(b.name, "th"));
    const menus = items.filter((o) => o.kind === "menu");
    list = (
      <>
        {prepped.length > 0 && <p className="px-2 pt-1 font-display text-[11px] text-muted-subtle">ของแปรรูป</p>}
        {prepped.map((o) => row(o, plain))}
        <p className="px-2 pt-1 font-display text-[11px] text-muted-subtle">วัตถุดิบ</p>
        {raw.map((o) => row(o, plain))}
        {menus.length > 0 && <p className="px-2 pt-1 font-display text-[11px] text-muted-subtle">เมนู (สำหรับเซ็ต)</p>}
        {menus.map((o) => row(o, plain))}
      </>
    );
  } else {
    const ranked = rankBySearch(items, q, fields);
    const strong = ranked.filter((r) => r.score >= STRONG_MATCH);
    const rest = ranked.filter((r) => r.score < STRONG_MATCH);
    list = (
      <>
        {strong.length === 0 && <p className="px-2 py-1 text-xs text-muted-subtle">ไม่มีที่ตรงกับ “{q}” · ถ้าเป็นวัตถุดิบใหม่ เพิ่มที่หน้าวัตถุดิบ</p>}
        {strong.map((r) => row(r.item, r))}
        {rest.length > 0 && <p className="px-2 pt-1 font-display text-[11px] text-muted-subtle">รายการอื่น</p>}
        {rest.map((r) => row(r.item, r, true))}
      </>
    );
  }

  return (
    <div className="relative" ref={box}>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="+ เพิ่มวัตถุดิบ พิมพ์ชื่อหรือรหัส"
        aria-label="เพิ่มวัตถุดิบ"
        className="w-full rounded-lg border border-dashed border-border-strong bg-surface-sunk px-3 py-1.5 text-sm focus:border-solid focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {open && <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-card">{list}</div>}
    </div>
  );
}

/** ADR 0019 Q8 — "this name from the file is a dish we already have". */
function AliasBlock({ menu, posIntegrationId }: { menu: ManagerRow; posIntegrationId: string }) {
  const [state, action, saving] = useActionState<MenuAliasActionState | null, FormData>(confirmMenuAliasAction, null);
  const [suggestions, setSuggestions] = useState<MenuSuggestionRowView[] | null>(null);
  const [looking, startLooking] = useTransition();
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-medium">ชื่อนี้เป็นเมนูเดิมที่มีอยู่แล้วหรือเปล่า</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        ระบบจะจำว่า “{menu.posMenuName}” หมายถึงเมนูที่เลือก — <strong>มีผลกับไฟล์ที่นำเข้าครั้งถัดไป</strong> ยอดขายที่บันทึกไปแล้วยังอยู่ที่เมนูนี้
      </p>
      {suggestions === null ? (
        <button
          type="button"
          onClick={() =>
            startLooking(async () => {
              const r = await orStale(getMenuSuggestionsAction(menu.posMenuName ?? menu.name));
              setSuggestions(r.ok ? r.suggestions : []);
            })
          }
          disabled={looking}
          className="mt-2 text-sm text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid"
        >
          {looking ? "กำลังค้นหา…" : "หาเมนูใกล้เคียง"}
        </button>
      ) : suggestions.filter((s) => s.id !== menu.id).length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">ไม่พบเมนูใกล้เคียง</p>
      ) : (
        <form action={action} className="mt-2 space-y-2">
          <input type="hidden" name="posIntegrationId" value={posIntegrationId} />
          <input type="hidden" name="rawName" value={menu.posMenuName ?? ""} />
          <select name="menuId" className="input w-full" defaultValue="">
            <option value="" disabled>
              — เลือกเมนูที่ใช่ —
            </option>
            {suggestions
              .filter((s) => s.id !== menu.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {s.badge}
                </option>
              ))}
          </select>
          {state?.ok === false && <p className="text-sm text-bad">{state.formError ?? Object.values(state.fieldErrors ?? {})[0] ?? "จับคู่ไม่สำเร็จ"}</p>}
          {state?.ok && <p className="text-sm text-good">จำไว้แล้ว</p>}
          <button type="submit" disabled={saving} className="btn">
            {saving ? "กำลังบันทึก…" : "จำชื่อนี้ไว้"}
          </button>
        </form>
      )}
    </section>
  );
}
