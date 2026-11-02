"use client";

// ============================================================
// Mise — the shop name at the top of the sidebar is the switcher (Kong 2026-11-02)
// ============================================================
// "กดขึ้นมาแล้วให้เลือกแบรนด์ตัวเองได้ สมมติมี 12 แบรนด์ จะกดสลับไปทีละตัวก็
// จะบ้าเกินไป" — approved mockup NS7QcU1kJf67Ds3gFHFcqE (round 2): a popover
// under the name on a computer, a sheet from the bottom on a phone, always a
// search box, the shop in use first with ✓, one press to switch. Opening
// another shop (another brand) lives here too, owners only, worded so nobody
// mistakes it for adding a branch.
//
// The list is read when the switcher opens (GET /api/shops), never on page
// load. Switching posts the same action as the เลือกร้าน page.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";
import { readApi } from "@/lib/read-api";
import { chooseShopAction } from "@/app/choose-shop/actions";
import type { ShopChoice } from "@/app/api/shops/route";

/** The badge letter skips Thai leading vowels (เ แ โ ใ ไ): โรตี shows ร, not โ. */
const initial = (name: string) => (name.match(/[ก-ฮA-Za-z0-9]/) ?? [name.charAt(0)])[0];

function Badge({ name, on }: { name: string; on: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg font-display text-[13px] font-semibold ${
        on ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary ring-1 ring-border-strong"
      }`}
    >
      {initial(name)}
    </span>
  );
}

function Row({ shop }: { shop: ShopChoice }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-muted disabled:opacity-60"
    >
      <Badge name={shop.name} on={false} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[14px] font-medium">{shop.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{pending ? "กำลังเปิด…" : `${shop.role} · ${shop.reach}`}</span>
      </span>
    </button>
  );
}

function Panel({ canOpenShop, onClose, sheet }: { canOpenShop: boolean; onClose: () => void; sheet: boolean }) {
  useTopLayer(onClose);
  const [shops, setShops] = useState<ShopChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let on = true;
    void readApi<{ ok: true; shops: ShopChoice[] }>("/api/shops", "list").then((r) => {
      if (!on) return;
      if (r.ok) setShops(r.shops);
      else setError(r.formError);
    });
    // A phone would throw its keyboard over the list; a computer types at once.
    if (!sheet) input.current?.focus();
    return () => {
      on = false;
    };
  }, [sheet]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (shops ?? []).filter((s) => t === "" || s.name.toLowerCase().includes(t));
  }, [shops, q]);

  return (
    <div className="grid gap-2">
      <label className="flex items-center gap-2 rounded-xl border border-border-strong bg-background px-3 py-2">
        <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-subtle" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="พิมพ์ชื่อร้าน"
          aria-label="ค้นหาชื่อร้าน"
          className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-subtle"
        />
      </label>
      <p className="eyebrow px-1 text-[11px]">ร้านของคุณ{shops ? ` · ${shops.length}` : ""}</p>
      <div className={`grid gap-0.5 overflow-y-auto ${sheet ? "max-h-[46vh]" : "max-h-[264px]"}`}>
        {error ? (
          <p className="px-2 py-1.5 text-sm text-bad">{error}</p>
        ) : shops === null ? (
          <p className="px-2 py-1.5 text-sm text-muted-subtle">กำลังโหลด…</p>
        ) : shown.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-subtle">ไม่พบร้านชื่อนี้</p>
        ) : (
          shown.map((s) =>
            s.current ? (
              <button
                key={s.id}
                type="button"
                onClick={onClose}
                aria-current="true"
                className="flex w-full items-center gap-2.5 rounded-xl bg-primary-soft px-2 py-1.5 text-left"
              >
                <Badge name={s.name} on />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[14px] font-semibold">{s.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.role} · {s.reach}
                  </span>
                </span>
                <Check aria-label="ใช้อยู่" className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />
              </button>
            ) : (
              <form key={s.id} action={chooseShopAction}>
                <input type="hidden" name="tenant_id" value={s.id} />
                <Row shop={s} />
              </form>
            )
          )
        )}
      </div>
      {canOpenShop ? (
        <>
          <a href="/signup" className="grid gap-0.5 rounded-xl border-[1.5px] border-dashed border-border-strong px-3 py-2 text-primary hover:bg-primary-soft">
            <span className="font-display text-[14px] font-semibold">+ เปิดร้านใหม่</span>
            <span className="text-xs text-muted-foreground">ร้านอีกชื่อหนึ่ง เช่น อีกแบรนด์ · ข้อมูลแยกกันทั้งหมด</span>
          </a>
          <p className="px-1 text-xs text-muted-subtle">สาขาใหม่ของร้านนี้ เพิ่มที่ ตั้งค่า › สาขาทั้งหมด</p>
        </>
      ) : null}
    </div>
  );
}

export default function ShopSwitcher({
  shopName,
  reach,
  canSwitch,
  canOpenShop,
  compact = false,
}: {
  shopName: string;
  /** What this person sees of the shop: "ทุกสาขา" or "1 สาขา". */
  reach: string;
  /** Belongs to more than one shop. */
  canSwitch: boolean;
  /** An owner may open another shop on the same account. */
  canOpenShop: boolean;
  /** The phone's top bar: one line, no badge. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState<null | { sheet: boolean; left: number; top: number }>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Nothing to switch to and nothing to open: the name is just a name.
  if (!canSwitch && !canOpenShop) {
    return compact ? (
      <span className="truncate text-sm font-medium">{shopName}</span>
    ) : (
      <div className="flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5">
        <Badge name={shopName} on />
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-display text-[15px] font-semibold">{shopName}</span>
          <span className="block truncate text-xs text-muted-foreground">{reach}</span>
        </span>
      </div>
    );
  }

  const show = () => {
    const sheet = !window.matchMedia("(min-width: 1024px)").matches;
    const r = trigger.current?.getBoundingClientRect();
    setOpen({ sheet, left: r ? r.left : 12, top: r ? r.bottom + 6 : 80 });
  };
  const close = () => setOpen(null);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close() : show())}
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        title="สลับร้าน"
        className={
          compact
            ? "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-muted"
            : `flex w-full min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                open ? "border-primary bg-primary-soft" : "border-border-strong bg-muted/40 hover:border-primary hover:bg-primary-soft"
              }`
        }
      >
        {compact ? null : <Badge name={shopName} on />}
        <span className="min-w-0 flex-1 leading-tight">
          <span className={`block truncate ${compact ? "text-sm font-medium" : "font-display text-[15px] font-semibold"}`}>{shopName}</span>
          {compact ? null : <span className="block truncate text-xs text-muted-foreground">{reach}</span>}
        </span>
        <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 text-muted-subtle" />
      </button>

      {open ? (
        <Portal>
          {open.sheet ? (
            <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="สลับร้าน">
              <button type="button" aria-label="ปิด" className="absolute inset-0 bg-foreground/35 animate-fade-in" onClick={close} />
              <div className="absolute inset-x-0 bottom-0 rounded-t-[22px] bg-surface px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-2 shadow-xl animate-pop-in">
                <div aria-hidden className="mx-auto mb-2 mt-0.5 h-1 w-10 rounded-full bg-border-strong" />
                <Panel canOpenShop={canOpenShop} onClose={close} sheet />
              </div>
            </div>
          ) : (
            <div className="fixed inset-0 z-[60]" role="dialog" aria-label="สลับร้าน">
              <button type="button" aria-label="ปิด" tabIndex={-1} className="absolute inset-0 cursor-default" onClick={close} />
              <div
                className="absolute w-[300px] rounded-2xl border border-border-strong bg-surface p-2.5 shadow-[0_24px_50px_-20px_rgb(35_36_12/0.55)] animate-pop-in"
                style={{ left: open.left, top: open.top }}
              >
                <Panel canOpenShop={canOpenShop} onClose={close} sheet={false} />
              </div>
            </div>
          )}
        </Portal>
      ) : null}
    </>
  );
}
