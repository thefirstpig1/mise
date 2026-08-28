"use client";

// Sprint 5 Part 26 L5 — recording a staff meal (ADR 0028).
//
// ONE form with two shapes, chosen by a toggle rather than by two routes,
// because a shop does both in the same five minutes: สมชาย ordered a กะเพรา,
// and the kitchen made a pot. The toggle is what the schema calls `menuId` being
// set or null (Q1) — there is no third state and no setting behind it.
//
// The form STAYS OPEN after a success and keeps branch, date and mode, because
// staff eat in a group and someone records four meals in a row. `submit_key`
// therefore ROTATES on every success: without that, meal #2 would read as a
// replay of meal #1 and silently write nothing — the worst possible failure for
// a record of stock leaving.
//
// Nothing here blocks. The quota, the ceiling and the double-deduction warning
// are all shown and all passable, because the food is already eaten by the time
// anybody is looking at this screen.

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { StaffMealActionState } from "@/app/staff-meals/actions";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import { STAFF_MEAL_PRICE_SOURCE_LABELS_TH } from "@/lib/validations/staff-meal";

export type StaffMealBranchOption = { id: string; name: string };
export type StaffMealMemberOption = { id: string; name: string };
export type StaffMealMenuOption = { id: string; name: string };
export type StaffMealProductOption = {
  id: string;
  name: string;
  units: { id: string; unitName: string; isBase: boolean }[];
};

/** One hand-typed pot line, in the browser only. */
type PotLine = { key: string; productId: string; qty: string; unitId: string };

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelClass = "block text-sm font-medium";
const errorClass = "mt-1 text-xs text-red-600";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const emptyLine = (): PotLine => ({
  key: newId(),
  productId: "",
  qty: "",
  unitId: "",
});

export default function StaffMealEntryForm({
  action,
  branches,
  members,
  menus,
  products,
  todayBangkok,
  defaultBranchId,
  /** The shop's ceiling on a dish's selling price, or null when it sets none. */
  maxMenuPrice,
  /** Live zero-price sales on the chosen day — the double-deduction warning. */
  zeroPriceTags,
}: {
  action: (
    prev: StaffMealActionState,
    fd: FormData
  ) => Promise<StaffMealActionState>;
  branches: StaffMealBranchOption[];
  members: StaffMealMemberOption[];
  menus: StaffMealMenuOption[];
  products: StaffMealProductOption[];
  todayBangkok: string;
  defaultBranchId: string;
  maxMenuPrice: string | null;
  zeroPriceTags: { discountReason: string | null; lines: number }[];
}) {
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as StaffMealActionState);

  const [submitKey, setSubmitKey] = useState(newId);
  const [mode, setMode] = useState<"MENU" | "POT">("MENU");
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [businessDate, setBusinessDate] = useState(todayBangkok);
  const [staffMemberId, setStaffMemberId] = useState("");
  const [menuId, setMenuId] = useState("");
  const [servings, setServings] = useState("1");
  const [lines, setLines] = useState<PotLine[]>([emptyLine()]);

  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Rotate the key and clear only what changes between two meals in a row.
  // Branch, date and mode stay: the next person in the queue is at the same
  // branch on the same day.
  useEffect(() => {
    if (!state.ok) return;
    setSubmitKey(newId());
    setStaffMemberId("");
    setMenuId("");
    setServings("1");
    setLines([emptyLine()]);
    if (notesRef.current) notesRef.current.value = "";
  }, [state]);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const err = (key: string) => fieldErrors?.[key];

  const minBackdate = useMemo(() => {
    const d = new Date(`${todayBangkok}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - MAX_BACKDATE_DAYS);
    return d.toISOString().slice(0, 10);
  }, [todayBangkok]);

  const setLine = (key: string, patch: Partial<PotLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const productOf = (id: string) => products.find((p) => p.id === id);

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-border bg-card p-4">
      <input type="hidden" name="submit_key" value={submitKey} />

      {/* --- the double-deduction warning (Q6): shown, never blocking --- */}
      {zeroPriceTags.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">
            วันที่เลือกมียอดขายราคา ฿0 อยู่{" "}
            {zeroPriceTags.reduce((n, t) => n + t.lines, 0)} รายการ
          </p>
          <ul className="mt-1 list-inside list-disc">
            {zeroPriceTags.map((t) => (
              <li key={t.discountReason ?? "__none__"}>
                {t.discountReason ?? "ไม่ได้ระบุเหตุผลส่วนลด"} × {t.lines}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            ถ้ารายการเหล่านั้นคือมื้อพนักงานอยู่แล้ว POS ตัดสต๊อกให้ไปแล้ว —
            บันทึกซ้ำที่นี่จะตัดสองรอบ ระบบไม่ห้าม เพราะระบบแยกไม่ได้ว่าอันไหนคืออะไร
          </p>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              name="acknowledge_duplicate_risk"
              value="true"
            />
            <span>ตรวจแล้ว ไม่ซ้ำ</span>
          </label>
        </div>
      )}

      {/* --- which shape --- */}
      <div className="flex gap-2">
        {(
          [
            ["MENU", "สั่งจากเมนู"],
            ["POT", "ทำกินเองจากของในร้าน"],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              mode === value
                ? "border-primary bg-primary/10 font-medium"
                : "border-border text-muted-foreground"
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="sm-branch">
            สาขา
          </label>
          <select
            id="sm-branch"
            name="branch_id"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className={inputClass}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {err("branchId") && <p className={errorClass}>{err("branchId")}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="sm-date">
            วันที่
          </label>
          <input
            id="sm-date"
            name="business_date"
            type="date"
            value={businessDate}
            min={minBackdate}
            max={todayBangkok}
            onChange={(e) => setBusinessDate(e.target.value)}
            className={inputClass}
          />
          {err("businessDate") && (
            <p className={errorClass}>{err("businessDate")}</p>
          )}
        </div>
      </div>

      {mode === "MENU" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="sm-member">
                ใครกิน
              </label>
              <select
                id="sm-member"
                name="staff_member_id"
                value={staffMemberId}
                onChange={(e) => setStaffMemberId(e.target.value)}
                className={inputClass}
              >
                <option value="">— เลือกพนักงาน —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              {err("staffMemberId") && (
                <p className={errorClass}>{err("staffMemberId")}</p>
              )}
              {members.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  ยังไม่มีรายชื่อพนักงาน —{" "}
                  <a className="underline" href="/staff-meals/people">
                    เพิ่มที่นี่
                  </a>
                </p>
              )}
            </div>

            <div>
              <label className={labelClass} htmlFor="sm-servings">
                จำนวนที่
              </label>
              <input
                id="sm-servings"
                name="servings"
                type="number"
                step="0.001"
                min="0.001"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                className={inputClass}
              />
              {err("servings") && <p className={errorClass}>{err("servings")}</p>}
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="sm-menu">
              เมนู
            </label>
            <select
              id="sm-menu"
              name="menu_id"
              value={menuId}
              onChange={(e) => setMenuId(e.target.value)}
              className={inputClass}
            >
              <option value="">— เลือกเมนู —</option>
              {menus.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {err("menuId") && <p className={errorClass}>{err("menuId")}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              ระบบจะตัดวัตถุดิบตาม<strong>สูตรของวันที่เลือก</strong> และบันทึก
              <strong>ราคาขาย</strong>ของจานนี้ไว้สำหรับดูโควตา — ราคาขาย
              <strong>ไม่ใช่</strong>ต้นทุน สต๊อกตัดตามราคาวัตถุดิบเสมอ
            </p>
          </div>
        </>
      ) : (
        <>
          {/* A pot has no single eater. The field is offered, not required —
              sometimes one person really did take 2 kg of pork home to cook. */}
          <div>
            <label className={labelClass} htmlFor="sm-member-pot">
              ใครกิน <span className="text-muted-foreground">(ไม่ระบุก็ได้ ถ้ากินกันหลายคน)</span>
            </label>
            <select
              id="sm-member-pot"
              name="staff_member_id"
              value={staffMemberId}
              onChange={(e) => setStaffMemberId(e.target.value)}
              className={inputClass}
            >
              <option value="">— กินกันหลายคน —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className={labelClass}>วัตถุดิบที่ใช้</p>
            <div className="mt-2 space-y-2">
              {lines.map((l) => {
                const p = productOf(l.productId);
                return (
                  <div key={l.key} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                    <select
                      name="item_product_id"
                      value={l.productId}
                      onChange={(e) => {
                        const next = productOf(e.target.value);
                        const base =
                          next?.units.find((u) => u.isBase) ?? next?.units[0];
                        setLine(l.key, {
                          productId: e.target.value,
                          unitId: base?.id ?? "",
                        });
                      }}
                      className={inputClass}
                    >
                      <option value="">— เลือกวัตถุดิบ —</option>
                      {products.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.name}
                        </option>
                      ))}
                    </select>
                    <input
                      name="item_input_qty"
                      type="number"
                      step="0.001"
                      min="0"
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      placeholder="จำนวน"
                      className={inputClass}
                    />
                    <select
                      name="item_input_unit_id"
                      value={l.unitId}
                      onChange={(e) => setLine(l.key, { unitId: e.target.value })}
                      className={inputClass}
                    >
                      {(p?.units ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.unitName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setLines((ls) =>
                          ls.length === 1
                            ? [emptyLine()]
                            : ls.filter((x) => x.key !== l.key)
                        )
                      }
                      className="rounded-lg border border-border px-2 text-sm text-muted-foreground hover:text-foreground"
                      aria-label="ลบแถว"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, emptyLine()])}
              className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              + เพิ่มวัตถุดิบ
            </button>
            {err("items") && <p className={errorClass}>{err("items")}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              แบบนี้ไม่มีราคาขายให้บันทึก จึงไม่นับเข้าโควตารายคน
            </p>
          </div>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="sm-recorded-by">
            คนบันทึก/คนเสิร์ฟ <span className="text-muted-foreground">(ถ้าไม่ใช่เจ้าของบัญชี)</span>
          </label>
          <input
            id="sm-recorded-by"
            name="recorded_by_name"
            type="text"
            maxLength={100}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="sm-notes">
            หมายเหตุ
          </label>
          <textarea
            id="sm-notes"
            ref={notesRef}
            name="notes"
            rows={1}
            maxLength={500}
            className={inputClass}
          />
        </div>
      </div>

      {maxMenuPrice !== null && mode === "MENU" && (
        <p className="text-xs text-muted-foreground">
          ร้านตั้งเพดานราคาเมนูมื้อพนักงานไว้ที่ ฿{maxMenuPrice} (ราคาไม่รวม VAT) —
          เกินได้ ระบบจะติดป้ายไว้ให้เห็นในรายการ ไม่ห้ามบันทึก
        </p>
      )}

      {formError && <p className="text-sm text-red-600">{formError}</p>}

      {state.ok && (
        <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          {state.replayed
            ? "รายการนี้บันทึกไว้แล้ว ไม่ได้ตัดสต๊อกซ้ำ"
            : `บันทึกแล้ว — ตัดวัตถุดิบ ${state.itemCount} รายการ`}
          {state.unitPrice !== null && (
            <>
              {" · "}
              มูลค่าตามราคาขาย ฿{state.unitPrice}/ที่ (
              {STAFF_MEAL_PRICE_SOURCE_LABELS_TH[state.priceSource]})
            </>
          )}
          {state.priceSource === "NONE" && mode === "MENU" && (
            <>
              {" · "}
              เมนูนี้ยังไม่เคยขายและไม่มีราคาที่ตั้งใจ จึงยังคิดโควตาให้ไม่ได้
            </>
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending ? "กำลังบันทึก…" : "บันทึกมื้อพนักงาน"}
      </button>
    </form>
  );
}
