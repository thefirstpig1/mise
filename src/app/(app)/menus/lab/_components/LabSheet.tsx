"use client";

// One draft in the lab (Kong 2026-10-04, mockup approved): what it costs a
// plate, the price being considered, the food-cost % between them and the
// price a target % would ask for; for a dish that already sells, the draft
// beside the recipe in use and the price customers actually paid (Q2: the
// sold price is the price, ราคาที่ตั้งใจ only compares). The recipe table is
// the one "จัดการเมนู" uses, units and all.
//
// Two figures, never confused: while typing, the branch's price book; after
// a save, the engine's figure for the saved draft with its confidence
// (ADR 0025 Q4 — the lab owns no arithmetic the engine does not agree with).
//
// × closes without saving and says so. Publishing is a shared edit (every
// branch), so it needs the reach over every branch; anyone else saves the
// draft and the button says who can publish.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { applyDraftToBranchAction, createDraftAction, discardDraftAction, endorseDraftAction, publishDraftAction, submitDraftAction, updateDraftAction, type DraftActionState } from "@/app/(app)/menus/lab/actions";
import { restoreMenuAction } from "@/app/(app)/menus/lifecycle-actions";
import type { IngredientOption, LabDraft, PriceBook, SheetLine, StandardUnit } from "@/server/menu-manager";
import { rankBySearch, hasQuery, STRONG_MATCH, type SearchField } from "@/lib/smart-search";
import { orStale } from "@/lib/stale-tab";
import { deletedMenuNamed, labDraftCost, menuSheet, type DeletedMenu, type LabCost } from "../../_components/prefetch";
import { Adder, appendLines, lineCost, lineFrom, materializeUnits, nextKey, qtyOf, RecipeTable, signature, type Line } from "../../_components/recipe-editor";
import { baht, confidenceHintTh, confidenceTh, newSubmitKey, thDate, unitTh } from "../../_components/manager-format";
import { ConfirmDialog, type ConfirmSpec, PhotoSlot, Sheet } from "../../_components/sheet-parts";
import { STATUS_TH, type LabMenu, type Option } from "./LabManager";

const DEFAULT_TARGET = 30;
const targetKey = (id: string) => `mise.lab.target.${id}`;
const readTarget = (id: string | null) => {
  if (!id) return DEFAULT_TARGET;
  try {
    const v = Number(window.localStorage.getItem(targetKey(id)));
    return v >= 5 && v <= 90 ? v : DEFAULT_TARGET;
  } catch {
    return DEFAULT_TARGET;
  }
};

const toLine = (l: SheetLine): Line => ({
  key: nextKey(),
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
});

export default function LabSheet(props: {
  draft: LabDraft | null;
  menus: LabMenu[];
  factDays: number;
  categories: Option[];
  branches: Option[];
  defaultBranchId: string | null;
  today: string;
  costHidden: boolean;
  canPublish: boolean;
  canWrite: boolean;
  viewerId: string;
  books: Record<string, PriceBook>;
  needBook: (branchId: string | null) => void;
  options: IngredientOption[] | null;
  standards: StandardUnit[];
  onClose: () => void;
  onToast: (msg: string) => void;
  onSaved: (recipeId: string) => void;
  onGone: () => void;
  onPublished: (menuId: string) => void;
}) {
  const { costHidden, onToast, options } = props;
  const d0 = props.draft;

  // ---- what the draft is ----
  const [savedId, setSavedId] = useState<string | null>(d0?.recipeId ?? null);
  const [kind, setKind] = useState<"new" | "edit">(d0 ? (d0.menuIsMise && !d0.hasSales ? "new" : "edit") : "new");
  const [name, setName] = useState(d0?.menuName ?? "");
  const [categoryId, setCategoryId] = useState(d0?.menuCategoryId ?? "");
  const [menuId, setMenuId] = useState<string | null>(d0?.menuId ?? null);
  const [extraMenu, setExtraMenu] = useState<LabMenu | null>(null);
  const menu = props.menus.find((m) => m.id === menuId) ?? (extraMenu?.id === menuId ? extraMenu : null);

  const firstLines = useMemo(() => (d0?.lines ?? []).map(toLine), [d0]);
  const [lines, setLines] = useState<Line[]>(firstLines);
  const [saved, setSaved] = useState({ lines: firstLines, servings: d0?.servings ?? 1, price: d0?.plannedPrice ?? null });
  const [servings, setServings] = useState(d0?.servings ?? 1);
  const [price, setPrice] = useState<string>(d0?.plannedPrice ? String(d0.plannedPrice) : "");
  const [target, setTarget] = useState(() => readTarget(d0?.recipeId ?? null));
  const [branchId, setBranchId] = useState(props.defaultBranchId);
  const book = branchId ? (props.books[branchId] ?? null) : null;
  useEffect(() => props.needBook(branchId), [branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The recipe in use, for "แก้สูตรเมนูที่ขายอยู่": its lines are where the
  // draft starts and what publishing is compared against.
  const [live, setLive] = useState<Line[] | null>(null);
  useEffect(() => {
    if (kind !== "edit" || !menuId || !branchId) return setLive(null);
    let on = true;
    void menuSheet(menuId, branchId).then((r) => {
      if (!on || !r.ok) return;
      const ls = (r.sheet.recipe?.lines ?? []).map(toLine);
      setLive(r.sheet.recipe ? ls : null);
    });
    return () => {
      on = false;
    };
  }, [kind, menuId, branchId]);

  // ---- the engine's figure for the SAVED draft ----
  const [verified, setVerified] = useState<LabCost | undefined>(undefined);
  const verify = (id: string | null, at: string | null) => {
    if (!id || !at || costHidden) return;
    setVerified(undefined);
    void labDraftCost(id, at).then((r) => r.ok && setVerified(r.cost));
  };
  useEffect(() => verify(savedId, branchId), [branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- a deleted dish by this exact name can come back (ADR 0027 Q7) ----
  const [restorable, setRestorable] = useState<DeletedMenu>(null);
  useEffect(() => {
    const n = name.trim();
    if (kind !== "new" || savedId || n === "") return setRestorable(null);
    let on = true;
    const t = setTimeout(() => void deletedMenuNamed(n).then((r) => on && setRestorable(r.ok ? r.found : null)), 400);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [name, kind, savedId]);

  // ---- numbers ----
  const priceN = Number(price) > 0 ? Number(price) : null;
  const pricesPending = !costHidden && book === null;
  const missing = lines.filter((l) => lineCost(l, book) === null).length;
  const perPlate = book === null || lines.length === 0 ? null : lines.reduce((s, l) => s + (lineCost(l, book) ?? 0), 0) / (servings || 1);
  const pct = perPlate !== null && priceN && missing === 0 ? (perPlate / priceN) * 100 : null;
  const suggested = perPlate !== null && missing === 0 && perPlate > 0 ? Math.ceil(perPlate / (target / 100)) : null;
  const liveCost = menuId && book ? (book.menus[menuId]?.costPerServing ?? null) : null;
  const avg = menu && menu.qty > 0 ? menu.net / menu.qty : null;
  const sameAsSaved = signature(lines, servings) === signature(saved.lines, saved.servings) && (priceN ?? null) === (saved.price ?? null);
  const dirty = !sameAsSaved || (!savedId && (name.trim() !== "" || menuId !== null));
  const targetReady = kind === "new" ? name.trim() !== "" || menuId !== null : menuId !== null;
  const linesReady = lines.length > 0 && lines.every((l) => qtyOf(l) > 0);
  const branchName = props.branches.find((b) => b.id === branchId)?.name ?? "";

  // ADR 0041 — who wrote it, where it is, and what THIS person may do with it.
  const [status, setStatus] = useState<LabDraft["draftStatus"]>(d0?.draftStatus ?? "DRAFT");
  const [endorsedBy, setEndorsedBy] = useState<string | null>(d0?.endorsedByName ?? null);
  const isAuthor = !d0 || d0.authorId === props.viewerId;
  const canEdit = props.canWrite || isAuthor;
  const canEndorse = props.canWrite && !!savedId && !isAuthor && status !== "ENDORSED";
  const canApplyHere = props.canWrite && !props.canPublish && !!branchId;

  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const close = () => {
    if (dirty) onToast("ปิดแล้ว · ไม่ได้บันทึกการแก้ไขในร่างนี้");
    props.onClose();
  };

  const setTargetKept = (v: number) => {
    setTarget(v);
    try {
      if (savedId) window.localStorage.setItem(targetKey(savedId), String(v));
    } catch {
      /* a per-viewer convenience; nothing is lost without it */
    }
  };

  const errorOf = (res: DraftActionState) => (res.ok ? null : (res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "บันทึกไม่ได้"));

  /** Save the draft; resolves to its id, or null when it could not. */
  const save = async (): Promise<string | null> => {
    setFormError(null);
    if (!targetReady) return setFormError(kind === "new" ? "ใส่ชื่อเมนูก่อน" : "เลือกเมนูที่จะแก้สูตรก่อน"), null;
    if (!linesReady) return setFormError(lines.length === 0 ? "ใส่วัตถุดิบอย่างน้อย 1 รายการ" : "ใส่ปริมาณของวัตถุดิบให้ครบ"), null;
    const m = await materializeUnits(lines);
    if (!m.ok) return setFormError(m.error), null;
    const fd = new FormData();
    fd.set("submit_key", newSubmitKey());
    if (menuId) fd.set("menu_id", menuId);
    else {
      fd.set("new_menu_name", name.trim());
      fd.set("menu_category_id", categoryId);
    }
    fd.set("servings", String(servings));
    fd.set("planned_price", price);
    fd.set("notes", d0?.notes ?? "");
    appendLines(fd, m.lines);
    const res = savedId ? await orStale(updateDraftAction(savedId, { ok: false }, fd)) : await orStale(createDraftAction({ ok: false }, fd));
    const err = errorOf(res);
    if (err || !res.ok) return setFormError(err), null;
    const id = res.draft.id;
    if (!savedId) {
      try {
        window.localStorage.setItem(targetKey(id), String(target));
      } catch {
        /* convenience only */
      }
    }
    setSavedId(id);
    setMenuId(res.draft.menuId);
    setLines(m.lines);
    setSaved({ lines: m.lines, servings, price: priceN });
    verify(id, branchId);
    props.onSaved(id);
    return id;
  };

  const doSave = () =>
    start(async () => {
      if (await save()) onToast("บันทึกร่างแล้ว · ยังไม่ตัดสต๊อก");
    });

  const askDiscard = () => {
    if (!savedId) return props.onClose();
    setConfirm({
      title: `ทิ้งร่าง “${menu?.name ?? name}”?`,
      lines: [],
      money: null,
      who: kind === "new" ? "สิ่งที่พิมพ์ไว้จะหายไป ชื่อเมนูที่สร้างไว้ยังอยู่ในจัดการเมนู" : "สิ่งที่พิมพ์ไว้จะหายไป สูตรที่ใช้อยู่ไม่ได้รับผลกระทบ",
      go: "ทิ้งร่าง",
      onGo: () =>
        start(async () => {
          const res = await orStale(discardDraftAction(savedId));
          if (!res.ok) return setFormError(res.error);
          onToast("ทิ้งร่างแล้ว");
          props.onGone();
        }),
    });
  };

  const diff = (): string[] => {
    const before = live ?? [];
    const ratio = (l: Line) => qtyOf(l) * l.ratio;
    const out: string[] = [];
    for (const l of lines) {
      const o = before.find((x) => (x.productId ?? x.componentMenuId) === (l.productId ?? l.componentMenuId));
      if (!o) out.push(`เพิ่ม ${l.label} ${l.qty} ${unitTh(l.unitName)}`);
      else if (Math.abs(ratio(o) - ratio(l)) > 1e-9 || o.unitName !== l.unitName) out.push(`${l.label} ${o.qty} ${unitTh(o.unitName)} → ${l.qty} ${unitTh(l.unitName)}`);
    }
    for (const o of before) if (!lines.some((l) => (l.productId ?? l.componentMenuId) === (o.productId ?? o.componentMenuId))) out.push(`เอาออก ${o.label}`);
    return out;
  };

  const askPublish = () => {
    setFormError(null);
    if (!targetReady || !linesReady) return void save();
    const replacing = live !== null;
    const title = replacing ? `ใช้สูตรใหม่ของ${menu?.name ?? name}กับทุกสาขา?` : `นำ “${menu?.name ?? name}” ไปใช้จริง?`;
    const money =
      costHidden || perPlate === null
        ? null
        : replacing && liveCost !== null
          ? `ต้นทุนต่อจาน ${baht(liveCost, 2)} → ${baht(perPlate, 2)} (${perPlate >= liveCost ? "+" : "−"}${baht(Math.abs(perPlate - liveCost), 2)})`
          : `ต้นทุนต่อจาน ${baht(perPlate, 2)}`;
    setConfirm({
      title,
      lines: replacing ? diff() : lines.map((l) => `${l.label} ${l.qty} ${unitTh(l.unitName)}`),
      money,
      who: replacing
        ? `ทุกสาขาที่ใช้สูตรกลาง · มีผลตั้งแต่ ${thDate(props.today)} · วันก่อนหน้ายังคิดด้วยสูตรเดิม · สาขาที่มีสูตรของตัวเองไม่เปลี่ยน`
        : `มีผลตั้งแต่ ${thDate(props.today)} · เมนูจะเริ่มตัดสต๊อกเมื่อมียอดขายจากไฟล์ POS`,
      go: replacing ? "ใช้กับทุกสาขา" : "นำไปใช้จริง",
      onGo: () =>
        start(async () => {
          const id = dirty || !savedId ? await save() : savedId;
          if (!id) return;
          const fd = new FormData();
          fd.set("recipe_id", id);
          // The confirmation above named the recipe that stops applying.
          fd.set("acknowledge_replace", "true");
          const res = await orStale(publishDraftAction({ ok: false }, fd));
          const err = errorOf(res);
          if (err || !res.ok) return setFormError(err);
          onToast(`นำไปใช้จริงแล้ว · ${menu?.name ?? name} ใช้สูตรนี้ตั้งแต่ ${thDate(props.today)}`);
          props.onPublished(res.draft.menuId ?? menuId ?? "");
        }),
    });
  };

  /** Save what is on screen first, so what is proposed or endorsed is what was read. */
  const savedFirst = async () => (dirty || !savedId ? await save() : savedId);

  const propose = () =>
    start(async () => {
      const id = await savedFirst();
      if (!id) return;
      const res = await orStale(submitDraftAction(id));
      if (!res.ok) return setFormError("error" in res ? res.error : "ทำรายการไม่ได้");
      setStatus("SUBMITTED");
      onToast("เสนอแล้ว · หัวหน้าจะเห็นร่างนี้ในรายการที่รอ");
      props.onSaved(id);
    });

  const endorse = () =>
    start(async () => {
      const id = await savedFirst();
      if (!id) return;
      const res = await orStale(endorseDraftAction(id));
      if (!res.ok) return setFormError("error" in res ? res.error : "ทำรายการไม่ได้");
      setStatus("ENDORSED");
      setEndorsedBy("คุณ");
      onToast("รับรองแล้ว · ชื่อของคุณอยู่บนร่างนี้");
      props.onSaved(id);
    });

  const askApplyHere = () => {
    setFormError(null);
    if (!targetReady || !linesReady || !branchId) return void save();
    setConfirm({
      title: `ใช้สูตรนี้ที่${branchName}?`,
      lines: lines.map((l) => `${l.label} ${l.qty} ${unitTh(l.unitName)}`),
      money: costHidden || perPlate === null ? null : `ต้นทุนต่อจาน ${baht(perPlate, 2)} · ${branchName}`,
      who: `เฉพาะ${branchName} · มีผลตั้งแต่ ${thDate(props.today)} · สาขานี้จะไม่ตามสูตรกลางอีกจนกว่าจะกลับไปใช้สูตรกลางที่หน้าจัดการเมนู · สาขาอื่นไม่เปลี่ยน`,
      go: `ใช้ที่${branchName}`,
      onGo: () =>
        start(async () => {
          const id = await savedFirst();
          if (!id) return;
          const res = await orStale(applyDraftToBranchAction({ recipeId: id, branchId, submitKey: newSubmitKey() }));
          if (!res.ok) return setFormError("error" in res ? res.error : "ทำรายการไม่ได้");
          onToast(`นำไปใช้จริงที่${branchName}แล้ว · ตั้งแต่ ${thDate(props.today)}`);
          props.onPublished(res.menuId ?? menuId ?? "");
        }),
    });
  };

  const restore = () =>
    start(async () => {
      if (!restorable) return;
      const res = await orStale(restoreMenuAction(restorable.id));
      if (!res.ok) return setFormError(res.error);
      // The dish exists again: this draft now edits it rather than making a second menu.
      setExtraMenu({ id: res.menuId, name: restorable.name, posCode: null, category: null, qty: 0, net: 0, hasRecipe: restorable.recipeCount > 0 });
      setMenuId(res.menuId);
      setKind("edit");
      setRestorable(null);
      onToast(`กู้คืน “${restorable.name}” แล้ว`);
    });

  return (
    <Sheet onClose={close} labelledBy="lab-title">
      <div className="flex items-start gap-3 border-b border-border bg-surface px-5 py-4">
        <PhotoSlot size={72} label="รูปเมนู" />
        <div className="min-w-0 flex-1 space-y-2">
          <p id="lab-title" className="text-xs text-muted-subtle">
            {savedId ? "ร่างสูตร" : "ร่างสูตรใหม่"}
            {d0 && ` · ร่างโดย ${isAuthor ? "คุณ" : d0.authorName}`}
            {status !== "DRAFT" && ` · ${status === "ENDORSED" && endorsedBy ? `รับรองโดย ${endorsedBy}` : STATUS_TH[status]}`}
          </p>
          {!savedId && (
            <div role="group" aria-label="ร่างนี้คือ" className="inline-flex rounded-full border border-border-strong p-0.5 text-sm">
              {(["new", "edit"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    setMenuId(null);
                    setLines([]);
                  }}
                  className={`rounded-full px-3 py-0.5 ${kind === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {k === "new" ? "เมนูใหม่" : "แก้สูตรเมนูที่ขายอยู่"}
                </button>
              ))}
            </div>
          )}
          {savedId || menuId ? (
            <div>
              <h3 className="text-lg font-semibold">{menu?.name ?? name}</h3>
              <p className="text-xs text-muted-foreground">
                {menu?.posCode && <span className="badge mr-1.5">{menu.posCode}</span>}
                {kind === "new" ? "เมนูใหม่ · ยังไม่มีการขายจนกว่าจะนำไปใช้จริง · เปลี่ยนชื่อได้ที่ จัดการเมนู" : live ? "นำไปใช้จริงแล้วจะแทนสูตรกลางเดิมตั้งแต่วันนั้น" : "เมนูนี้ยังไม่มีสูตรกลาง"}
              </p>
            </div>
          ) : kind === "new" ? (
            <div className="space-y-1.5">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อเมนูใหม่ เช่น ข้าวผัดปูไข่เค็ม" aria-label="ชื่อเมนูใหม่" className="input w-full text-base font-semibold" />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="หมวด" className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs">
                  <option value="">— หมวด (ไม่บังคับ) —</option>
                  {props.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span>สร้างเมนูให้ตอนบันทึก ยังไม่มีการขายจนกว่าจะนำไปใช้จริง</span>
              </div>
              {restorable && (
                <div className="rounded-lg border border-border bg-surface-sunk p-2 text-xs">
                  มีเมนูชื่อนี้ที่ถูกลบไปแล้ว{restorable.recipeCount > 0 ? ` (สูตร ${restorable.recipeCount} รายการ)` : ""} · กู้คืนเมนูเดิมแทนการสร้างเมนูใหม่ซ้ำ
                  {props.canPublish ? (
                    <button type="button" onClick={restore} disabled={busy} className="ml-2 rounded-full border border-border-strong px-2 py-0.5 hover:bg-muted">
                      กู้คืนเมนูเดิม
                    </button>
                  ) : (
                    <span className="block text-muted-foreground">กู้คืนได้เฉพาะเจ้าของร้าน ส่วนกลาง และผู้ดูแลทุกสาขา</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <MenuPicker
              menus={props.menus}
              onPick={(m) => {
                setMenuId(m.id);
                if (lines.length === 0 && m.hasRecipe && branchId) {
                  void menuSheet(m.id, branchId).then((r) => r.ok && r.sheet.recipe && setLines(r.sheet.recipe.lines.map(toLine)));
                }
              }}
            />
          )}
        </div>
        <button type="button" onClick={close} aria-label="ปิด" className="rounded-lg px-2 text-2xl leading-none text-muted-foreground hover:bg-muted">
          ×
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {!costHidden && (
            <Tile k="ต้นทุนต่อจาน" title={verified ? confidenceHintTh(verified.confidence) : undefined}>
              <p className="font-display text-lg font-semibold tabular-nums">{pricesPending && lines.length ? "…" : perPlate === null ? "—" : baht(perPlate, 2)}</p>
              <p className="text-[11px] text-muted-foreground">
                {lines.length === 0
                  ? "ใส่วัตถุดิบเพื่อดูต้นทุน"
                  : missing > 0
                    ? `ขาดราคา ${missing} รายการ · ${branchName}`
                    : sameAsSaved && verified
                      ? `ความมั่นใจ${confidenceTh(verified.confidence)} · ${branchName}`
                      : `ประมาณจากราคาวัตถุดิบ · ${branchName}`}
              </p>
            </Tile>
          )}
          <Tile k="ราคาที่ตั้งใจ">
            <input type="number" min="0" step="1" value={price} disabled={!canEdit} onChange={(e) => setPrice(e.target.value)} placeholder="เช่น 129" aria-label="ราคาที่ตั้งใจ" className="input mt-0.5 w-full py-0.5 font-display text-lg font-semibold tabular-nums" />
            <p className="text-[11px] text-muted-foreground">ราคาที่กำลังคิด ไม่ใช่ราคาขาย</p>
          </Tile>
          {!costHidden && (
            <>
              <Tile k="ต้นทุน % ของราคาที่ตั้งใจ">
                <p className={`font-display text-lg font-semibold tabular-nums ${pct !== null && pct > target ? "text-warn" : ""}`}>{pct === null ? "—" : `${pct.toFixed(1)}%`}</p>
                <p className="text-[11px] text-muted-foreground">{pct === null ? (perPlate === null ? "ใส่วัตถุดิบและราคา" : missing > 0 ? "ยังขาดราคาวัตถุดิบ" : "ใส่ราคาที่ตั้งใจ") : `เป้าที่ตั้งไว้ ${target}%`}</p>
              </Tile>
              <Tile k="กำไรต่อจาน">
                <p className="font-display text-lg font-semibold tabular-nums">{perPlate !== null && priceN && missing === 0 ? baht(priceN - perPlate, 2) : "—"}</p>
                <p className="text-[11px] text-muted-foreground">{avg !== null ? `ขายจริงเฉลี่ย ${baht(avg)}` : "ราคา − ต้นทุนวัตถุดิบ"}</p>
              </Tile>
            </>
          )}
        </div>

        {!costHidden && suggested !== null && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-sunk px-3 py-2 text-sm">
            ถ้าอยากให้ต้นทุนเป็น
            <input
              type="number"
              min="5"
              max="90"
              value={target}
              onChange={(e) => setTargetKept(Math.max(5, Math.min(90, Number(e.target.value) || DEFAULT_TARGET)))}
              aria-label="เป้าต้นทุน %"
              className="input w-16 py-0.5 text-right tabular-nums"
            />
            % ของราคา ควรตั้งราคา <b className="tabular-nums">{baht(suggested)}</b>
            <button type="button" onClick={() => setPrice(String(suggested))} className="rounded-full border border-border-strong bg-surface px-3 py-0.5 text-sm hover:bg-muted">
              ใช้ราคานี้
            </button>
            <span className="basis-full text-xs text-muted-foreground">ราคา = ต้นทุน ÷ เป้า % · ร้านอาหารทั่วไปตั้งเป้าที่ 28–35% · เป้านี้จำไว้ต่อร่าง</span>
          </div>
        )}

        {!costHidden && kind === "edit" && menu && live && (
          <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="font-semibold">เทียบกับสูตรที่ใช้อยู่</h4>
              <span className="text-xs text-muted-foreground">{menu.qty > 0 ? `ขายไป ${menu.qty.toLocaleString("th-TH")} จานใน ${props.factDays} วัน` : `ยังไม่มียอดขายใน ${props.factDays} วัน`}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
              <span />
              <span className="text-right text-xs text-muted-foreground">สูตรที่ใช้อยู่</span>
              <span className="text-right text-xs text-muted-foreground">ร่างนี้</span>
              <span className="text-xs text-muted-foreground">ต้นทุนต่อจาน</span>
              <span className="text-right">{liveCost === null ? "—" : baht(liveCost, 2)}</span>
              <span className="text-right">
                {perPlate === null ? "—" : baht(perPlate, 2)}
                {perPlate !== null && liveCost !== null && (
                  <span className="ml-1 text-xs text-muted-foreground">{Math.abs(perPlate - liveCost) < 0.005 ? "(เท่าเดิม)" : `(${perPlate > liveCost ? "+" : "−"}${baht(Math.abs(perPlate - liveCost), 2)})`}</span>
                )}
              </span>
              {avg !== null && (
                <>
                  <span className="text-xs text-muted-foreground">ต้นทุน % ของราคาขายจริง {baht(avg)}</span>
                  <span className="text-right">{liveCost === null ? "—" : `${((liveCost / avg) * 100).toFixed(1)}%`}</span>
                  <span className="text-right">{perPlate === null ? "—" : `${((perPlate / avg) * 100).toFixed(1)}%`}</span>
                  <span className="text-xs text-muted-foreground">ถ้าขายเท่าเดิม กำไรต่อ {props.factDays} วัน</span>
                  <span className="text-right">{liveCost === null ? "—" : baht((avg - liveCost) * menu.qty)}</span>
                  <span className="text-right">{perPlate === null ? "—" : baht((avg - perPlate) * menu.qty)}</span>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">ใช้ราคาที่ขายได้จริงเป็นหลัก ราคาที่ตั้งใจเป็นแค่ตัวเทียบ · ต้นทุนคิดที่{branchName} ณ วันนี้</p>
          </section>
        )}

        <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">สูตร</h4>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              ทำได้
              <input type="number" min="1" step="any" value={servings} disabled={!canEdit} onChange={(e) => setServings(Math.max(0.001, Number(e.target.value) || 1))} aria-label="ทำได้กี่จาน" className="input w-14 py-0.5 text-right tabular-nums" />
              จาน
              {!costHidden && props.branches.length > 1 && (
                <>
                  {" "}· ต้นทุนคิดที่
                  <select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} aria-label="สาขาที่ใช้คิดต้นทุน" className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs">
                    {props.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                        {b.id === props.defaultBranchId ? " (รับของล่าสุด)" : ""}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </span>
          </div>
          {lines.length === 0 ? (
            <div className="rounded-lg border-[1.5px] border-dashed border-border-strong bg-surface-sunk p-3 text-sm text-muted-foreground">
              <b className="text-foreground">ยังไม่มีวัตถุดิบ</b> · พิมพ์ชื่อหรือรหัสในช่องด้านล่าง ต้นทุนจะขึ้นทันที
            </div>
          ) : (
            <RecipeTable
              lines={lines}
              setLines={setLines}
              baseLines={live ?? saved.lines}
              book={book}
              options={options}
              standards={props.standards}
              editable={canEdit}
              costHidden={costHidden}
              showNotes={false}
              canDefineUnit={props.canPublish}
              onToast={onToast}
            />
          )}
          {canEdit ? (
            <Adder
              options={options}
              book={book}
              exclude={new Set([...lines.map((l) => l.productId ?? l.componentMenuId ?? ""), menuId ?? ""])}
              costHidden={costHidden}
              onPick={(o) => setLines((ls) => [...ls, lineFrom(o, props.standards)])}
            />
          ) : (
            <p className="text-xs text-muted-foreground">ร่างของ{d0?.authorName} — ดูได้อย่างเดียว แก้ได้เฉพาะคนร่างและหัวหน้า</p>
          )}
          {!costHidden && missing > 0 && !pricesPending && (
            <p className="text-xs text-warn">ยังไม่มีราคาที่{branchName}: {lines.filter((l) => lineCost(l, book) === null).map((l) => l.label).join(", ")} · ต้นทุนจริงจะสูงกว่านี้</p>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-5 py-3">
        <span className="text-xs text-muted-foreground">
          {formError ? <span className="text-bad">{formError}</span> : dirty ? "มีการแก้ที่ยังไม่บันทึก" : savedId ? "บันทึกร่างแล้ว · ยังไม่ตัดสต๊อก" : ""}
        </span>
        <span className="flex flex-wrap justify-end gap-2">
          {canEdit && (
            <>
              <button type="button" onClick={askDiscard} disabled={busy} className="rounded-full border border-border-strong px-4 py-1.5 text-sm text-bad hover:bg-bad-bg">
                ทิ้งร่าง
              </button>
              <button type="button" onClick={doSave} disabled={busy || (!dirty && !!savedId)} className="rounded-full border border-border-strong px-4 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
                {busy ? "กำลังบันทึก…" : "บันทึกร่าง"}
              </button>
            </>
          )}
          {canEndorse && (
            <button type="button" onClick={endorse} disabled={busy || !targetReady || !linesReady} className="rounded-full border border-border-strong px-4 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
              รับรอง
            </button>
          )}
          {props.canPublish ? (
            <button type="button" onClick={askPublish} disabled={busy || !targetReady || !linesReady} className="btn disabled:opacity-50">
              นำไปใช้จริง…
            </button>
          ) : canApplyHere ? (
            <button type="button" onClick={askApplyHere} disabled={busy || !targetReady || !linesReady} className="btn disabled:opacity-50">
              นำไปใช้จริงที่{branchName}…
            </button>
          ) : status === "DRAFT" ? (
            <button type="button" onClick={propose} disabled={busy || !targetReady || !linesReady} className="btn disabled:opacity-50">
              เสนอสูตรนี้
            </button>
          ) : (
            <span className="max-w-[16rem] self-center text-[11px] text-muted-foreground">
              {status === "ENDORSED" ? "รับรองแล้ว · รอผู้ดูแลทุกสาขานำไปใช้จริง" : "เสนอแล้ว · หัวหน้าจะเห็นร่างนี้ในรายการที่รอ"}
            </span>
          )}
        </span>
      </div>

      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
    </Sheet>
  );
}

function Tile({ k, title, children }: { k: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-2.5" title={title}>
      <p className="text-[11px] text-muted-subtle">{k}</p>
      {children}
    </div>
  );
}

/** Pick the dish whose recipe is being reworked — the app's smart search. */
function MenuPicker({ menus, onPick }: { menus: LabMenu[]; onPick: (m: LabMenu) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);
  const fields: SearchField<LabMenu>[] = [
    { get: (m) => m.name, kind: "name" },
    { get: (m) => m.posCode, kind: "code" },
    { get: (m) => m.category, kind: "category" },
  ];
  const ranked = hasQuery(q) ? rankBySearch(menus, q, fields) : [...menus].sort((a, b) => b.net - a.net).map((item) => ({ item, score: STRONG_MATCH }));
  return (
    <div className="relative" ref={box}>
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="ค้นหาเมนูที่ขายอยู่ ชื่อหรือรหัส"
        aria-label="เลือกเมนูที่จะแก้สูตร"
        className="input w-full"
      />
      {open && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-card">
          {ranked.length === 0 && <p className="px-2 py-1 text-xs text-muted-subtle">ไม่พบเมนู</p>}
          {ranked.map((r) => (
            <button
              key={r.item.id}
              type="button"
              onClick={() => {
                onPick(r.item);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted ${r.score < STRONG_MATCH ? "opacity-45" : ""}`}
            >
              <span>
                {r.item.name} {r.item.posCode && <small className="text-xs tabular-nums text-muted-subtle">{r.item.posCode}</small>}
              </span>
              <small className="text-xs text-muted-subtle">{r.item.hasRecipe ? "มีสูตร" : "ยังไม่มีสูตร"}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
