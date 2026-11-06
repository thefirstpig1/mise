"use client";

// ADR 0043 Q3 — every shop on one screen: who owns it, is anyone using it,
// what package it is on, and until when it is free. A row opens who is in the
// shop; "แก้แพ็กเกจ" sets the package for that shop alone — Kong decides each
// shop's free period separately ("การให้สิทธิฟรีแต่ละคนมันไม่เท่ากัน").

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";
import { orStale } from "@/lib/stale-tab";
import { shortDate } from "@/lib/advance-labels";
import type { ShopDetail, ShopRow } from "@/server/platform";
import type { ShopAccuracy } from "@/server/deduction-accuracy";
import { readApi } from "@/lib/read-api";
import { closeShopAction, setShopPlanAction } from "../actions";
import { nameConfirmed, purgeDate } from "@/lib/platform-requests";
import Link from "next/link";
import type { Route } from "next";
import { ownersOverFreeLimit } from "@/lib/free-rule";

// Kong 2026-10-30: package names are written bare, in English. Plan code `trial` means Free.
const PLAN_LABEL: Record<string, string> = { trial: "Free", standard: "Standard" };
const ROLE_LABEL: Record<string, string> = {
  owner: "เจ้าของ",
  admin: "ผู้ดูแลร้าน",
  manager: "ผู้จัดการสาขา",
  purchaser: "จัดซื้อ",
  kitchen_staff: "พนักงานครัว",
  dept_head: "หัวหน้าแผนก",
  cashier: "แคชเชียร์",
  accountant: "บัญชี",
  viewer: "ดูอย่างเดียว",
};

const day = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const fullDate = (ymd: string) => `${shortDate(ymd)} ${Number(ymd.slice(0, 4)) + 543}`;

function freeLabel(s: ShopRow, today: string): { text: string; tone: string } {
  if (!s.freeUntil) return { text: "ยังไม่กำหนด", tone: "text-muted-subtle" };
  const left = daysBetween(today, s.freeUntil);
  if (left < 0) return { text: `หมดแล้ว ${fullDate(s.freeUntil)}`, tone: "text-bad" };
  if (left <= 30) return { text: `${fullDate(s.freeUntil)} · อีก ${left} วัน`, tone: "text-warn" };
  return { text: `${fullDate(s.freeUntil)} · อีก ${left} วัน`, tone: "" };
}

export default function ShopsTable({ shops, today, initialQuery = "" }: { shops: ShopRow[]; today: string; initialQuery?: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ShopRow | null>(null);
  const [viewing, setViewing] = useState<ShopRow | null>(null);
  const [q, setQ] = useState(initialQuery);
  const [toast, setToast] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  // Each shop's figure is a FIFO replay, so the table paints first and the
  // column fills in after (mise-ui-review §5c). undefined = still counting.
  const [accuracy, setAccuracy] = useState<Record<string, ShopAccuracy | null> | undefined>(undefined);
  useEffect(() => {
    let on = true;
    void readApi<{ ok: true; shops: Record<string, ShopAccuracy | null> }>("/api/platform", "accuracy").then((r) => {
      if (on) setAccuracy(r.ok ? r.shops : {});
    });
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? shops.filter((x) => x.name.toLowerCase().includes(s) || x.owners.some((o) => o.toLowerCase().includes(s))) : shops;
  }, [q, shops]);

  const active7 = shops.filter((s) => s.lastActivity && daysBetween(day(s.lastActivity), today) <= 7).length;
  const endingSoon = shops.filter((s) => s.freeUntil && daysBetween(today, s.freeUntil) >= 0 && daysBetween(today, s.freeUntil) <= 30).length;
  const unset = shops.filter((s) => s.plan === "trial" && !s.freeUntil).length;
  // Kong 2026-11-02 (option ก): one Free shop per owner account — shown here, enforced from the day Standard can be bought.
  const overFree = useMemo(() => ownersOverFreeLimit(shops), [shops]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">ร้านทั้งหมด</h1>
        <p className="mt-1 text-sm text-muted-foreground">กดที่แถวเพื่อดูผู้ใช้งาน · ทุกการแก้แพ็กเกจถูกบันทึกไว้ในหน้า "บันทึกการแก้ไข"</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["ร้านทั้งหมด", shops.length, "ร้านที่สมัครแล้ว"],
          ["ใช้งานใน 7 วัน", active7, "มีบิลหรือการเคลื่อนไหวสต็อก"],
          ["ใช้ฟรีหมดใน 30 วัน", endingSoon, "ติดต่อเรื่องค่าบริการ"],
          ["ยังไม่ตั้งแพ็กเกจ", unset, "Free ยังไม่กำหนดวันหมด"],
          ["บัญชีที่มี Free เกิน 1 ร้าน", overFree.size, "ยังไม่บังคับ จนกว่า Standard ซื้อได้"],
        ].map(([k, v, s]) => (
          <div key={k as string} className="card space-y-0.5 p-4">
            <p className="text-sm text-muted-foreground">{k}</p>
            <p className="text-2xl font-semibold tabular-nums">{v}</p>
            <p className="text-xs text-muted-subtle">{s}</p>
          </div>
        ))}
      </div>

      <input className="input w-full max-w-sm" placeholder="ค้นหาชื่อร้านหรืออีเมลเจ้าของ" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="overflow-x-auto rounded-[18px] border border-border/70 bg-surface shadow-card">
        <table className="data-table w-full min-w-[920px]">
          <thead>
            <tr>
              <th>ร้าน</th>
              <th>เจ้าของ</th>
              <th className="text-right">สาขา · คน</th>
              <th>ใช้งานล่าสุด</th>
              <th title="ระบบตัดตามสูตร เทียบกับที่ใช้จริงตามการนับครั้งล่าสุดที่เทียบได้">ตัดสต็อกเทียบการนับ</th>
              <th>แพ็กเกจ</th>
              <th>ใช้ฟรีถึง</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const free = freeLabel(s, today);
              return (
                <tr key={s.id} onClick={() => setViewing(s)} className="cursor-pointer hover:bg-muted/50">
                  <td>
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-subtle">สมัคร {fullDate(day(s.createdAt))}</span>
                  </td>
                  <td className="text-sm">
                    {s.owners.join(", ") || "—"}
                    {s.plan === "trial" &&
                      s.owners.map((o) => overFree.get(o.toLowerCase())).find(Boolean) && (
                        <span className="block text-xs text-warn">
                          บัญชีนี้มี Free {Math.max(...s.owners.map((o) => overFree.get(o.toLowerCase())?.length ?? 0))} ร้าน
                        </span>
                      )}
                  </td>
                  <td className="text-right tabular-nums">
                    {s.branches} · {s.members}
                  </td>
                  <td className="text-sm">{s.lastActivity ? `${shortDate(day(s.lastActivity))} (${daysBetween(day(s.lastActivity), today) === 0 ? "วันนี้" : `${daysBetween(day(s.lastActivity), today)} วันก่อน`})` : "ยังไม่ได้ใช้"}</td>
                  <td className="text-sm">
                    <AccuracyCell a={accuracy === undefined ? undefined : accuracy[s.id] ?? null} />
                  </td>
                  <td>
                    <span className={s.plan === "standard" ? "chip chip-good" : "chip"}>{PLAN_LABEL[s.plan] ?? s.plan}</span>
                    {s.planNote && <span className="block max-w-[14rem] truncate text-xs text-muted-subtle" title={s.planNote}>{s.planNote}</span>}
                  </td>
                  <td className={`text-sm ${free.tone}`}>{free.text}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-secondary btn-sm relative z-10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(s);
                      }}
                    >
                      แก้แพ็กเกจ
                    </button>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  ไม่พบร้าน
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <PlanDialog
          shop={editing}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            setEditing(null);
            setToast(m);
            startRefresh(() => router.refresh());
          }}
        />
      )}
      {viewing && (
        <ShopDialog
          shop={viewing}
          today={today}
          onClose={() => setViewing(null)}
          onClosed={(m) => {
            setViewing(null);
            setToast(m);
            startRefresh(() => router.refresh());
          }}
        />
      )}
      {toast && (
        <Portal>
          <div role="status" className="fixed inset-x-0 bottom-6 z-[70] mx-auto w-fit max-w-[90vw] animate-pop-in rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg">
            {toast}
          </div>
        </Portal>
      )}
    </div>
  );
}

function AccuracyCell({ a }: { a: ShopAccuracy | null | undefined }) {
  if (a === undefined) return <span className="text-xs text-muted-subtle">กำลังคำนวณ…</span>;
  if (a === null) return <span className="text-xs text-muted-subtle">ยังไม่มีการนับที่เทียบได้</span>;
  return (
    <span title={`ใบนับ ${fullDate(a.date)} · ${a.branchName} · ต่างไม่เกิน 2%: ${a.near} จาก ${a.measured} รายการ`}>
      <b className="font-display font-semibold tabular-nums">{a.gapPct === null ? "—" : `${a.gapPct.toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`}</b>
      <span className="block text-xs text-muted-subtle">
        {a.near}/{a.measured} รายการ · {shortDate(a.date)}
      </span>
    </span>
  );
}

function Frame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useTopLayer(onClose);
  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 animate-fade-in bg-black/25" onMouseDown={onClose} aria-hidden />
        <div role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[90dvh] w-full max-w-lg animate-pop-in space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <h2 className="flex-1 text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="icon-btn text-xl leading-none" aria-label="ปิด">
              ×
            </button>
          </div>
          {children}
        </div>
      </div>
    </Portal>
  );
}

function addMonths(ymd: string, months: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function PlanDialog({ shop, today, onClose, onSaved }: { shop: ShopRow; today: string; onClose: () => void; onSaved: (m: string) => void }) {
  const [plan, setPlan] = useState<"trial" | "standard">(shop.plan === "standard" ? "standard" : "trial");
  const [freeUntil, setFreeUntil] = useState<string | null>(shop.freeUntil);
  const [note, setNote] = useState(shop.planNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await orStale(setShopPlanAction({ tenantId: shop.id, plan, freeUntil, note: note.trim() || null }));
    setBusy(false);
    if (!res.ok) return setError(res.formError);
    onSaved(`บันทึกแพ็กเกจของ ${shop.name} แล้ว`);
  };

  return (
    <Frame title={`แพ็กเกจ · ${shop.name}`} onClose={onClose}>
      <div className="space-y-1">
        <p className="text-sm font-semibold">แพ็กเกจ</p>
        <div className="seg" role="group" aria-label="แพ็กเกจ">
          {(["trial", "standard"] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPlan(p)} className={`seg-item ${plan === p ? "is-on" : ""}`}>
              {PLAN_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold">ใช้ฟรีถึง (รวมวันนั้น)</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            [1, "+1 เดือน"],
            [3, "+3 เดือน"],
            [6, "+6 เดือน"],
            [12, "+1 ปี"],
          ].map(([m, label]) => (
            <button key={label as string} type="button" className="pill" onClick={() => setFreeUntil(addMonths(today, m as number))}>
              {label}
            </button>
          ))}
          <button type="button" className={`pill ${freeUntil === null ? "is-on" : ""}`} onClick={() => setFreeUntil(null)}>
            ไม่กำหนด
          </button>
        </div>
        <input type="date" className="input w-full" value={freeUntil ?? ""} onChange={(e) => setFreeUntil(e.target.value || null)} />
        <p className="text-xs text-muted-foreground">
          {freeUntil ? `ร้านจะเห็นว่า "ใช้ฟรีถึง ${fullDate(freeUntil)}" · อีก ${daysBetween(today, freeUntil)} วัน` : "ร้านจะเห็นว่ายังไม่มีค่าบริการ"} · เลยกำหนดแล้วระบบยังใช้งานได้ตามปกติ
        </p>
      </div>

      <label className="block space-y-1">
        <span className="block text-sm font-semibold">หมายเหตุ (ร้านเห็นข้อความนี้ในหน้าตั้งค่า)</span>
        <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ร้านแรก ใช้ฟรี 1 ปี" maxLength={300} />
      </label>

      {error && <p className="rounded-xl border border-bad-border bg-bad-bg p-3 text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          กลับ
        </button>
        <button type="button" className="btn" disabled={busy} onClick={save}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </Frame>
  );
}

function ShopDialog({ shop, today, onClose, onClosed }: { shop: ShopRow; today: string; onClose: () => void; onClosed: (m: string) => void }) {
  const [detail, setDetail] = useState<ShopDetail | null>(null);
  const [failed, setFailed] = useState(false);
  // ADR 0045 part B — closing, inside the popup, with the shop's name typed.
  const [closing, setClosing] = useState(false);
  const [typed, setTyped] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = async () => {
    setBusy(true);
    setCloseError(null);
    const res = await orStale(closeShopAction({ tenantId: shop.id, confirmName: typed }));
    setBusy(false);
    if (!res.ok) return setCloseError(res.formError);
    onClosed(`ปิดร้าน ${shop.name} แล้ว · ลบถาวรได้ตั้งแต่ ${fullDate(purgeDate(today))}`);
  };
  useEffect(() => {
    let on = true;
    void fetch(`/api/platform?what=shop&id=${shop.id}`, { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((r: { ok: boolean; shop?: ShopDetail }) => on && (r.ok && r.shop ? setDetail(r.shop) : setFailed(true)))
      .catch(() => on && setFailed(true));
    return () => {
      on = false;
    };
  }, [shop.id]);

  return (
    <Frame title={shop.name} onClose={onClose}>
      {!detail ? (
        failed ? <p className="text-sm text-bad">โหลดไม่สำเร็จ</p> : <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-subtle">สาขา {detail.branches.length}</p>
            <p className="text-sm">{detail.branches.map((b) => `${b.name} (${b.code})`).join(" · ") || "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-subtle">ผู้ใช้งาน {detail.members.length}</p>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {detail.members.map((m) => (
                <li key={m.email} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.name ?? m.email.split("@")[0]}</span>
                    <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="chip">{ROLE_LABEL[m.role] ?? m.role}</span>
                    {!m.active && <span className="chip chip-bad">ปิดแล้ว</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">อ่านอย่างเดียว · เจ้าของร้านเพิ่มหรือลบผู้ใช้งานได้เองที่ ตั้งค่า › ผู้ใช้งาน</p>

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Link href={`/platform/requests?shop=${shop.id}&kind=export` as Route} className="btn-secondary btn-sm">
              บันทึกคำขอของร้านนี้
            </Link>
            <a href={`/api/platform/export?id=${shop.id}`} className="btn-secondary btn-sm">
              ส่งออกข้อมูลร้าน
            </a>
            {shop.owners[0] && (
              <Link href={`/platform/users?q=${encodeURIComponent(shop.owners[0])}` as Route} className="btn-secondary btn-sm">
                เปลี่ยนอีเมลเจ้าของ
              </Link>
            )}
            <button type="button" className="btn-danger btn-sm" onClick={() => setClosing(true)} disabled={closing}>
              ปิดและลบร้าน
            </button>
          </div>
          {closing && (
            <div className="space-y-2 rounded-xl border border-bad-border bg-bad-bg p-3 text-sm">
              <b className="text-bad">ปิดและลบร้าน “{shop.name}”</b>
              <p>
                คนในร้าน {detail.members.filter((m) => m.active).length} คนเข้าไม่ได้ทันที · ข้อมูลถูกลบถาวรได้ตั้งแต่ {fullDate(purgeDate(today))} เมื่อกดลบ ·
                ก่อนวันนั้นยกเลิกการปิดได้ที่ส่วน “ร้านที่ปิดรอลบ”
              </p>
              <label className="block space-y-1">
                <span className="block text-xs font-semibold">พิมพ์ชื่อร้านเพื่อยืนยัน</span>
                <input className="input w-full bg-surface" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={shop.name} />
              </label>
              {closeError && <p className="text-bad">{closeError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setClosing(false)}>
                  ยกเลิก
                </button>
                <button type="button" className="btn-danger-solid btn-sm" disabled={busy || !nameConfirmed(typed, shop.name)} onClick={close}>
                  {busy ? "กำลังปิด…" : "ปิดร้านนี้"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Frame>
  );
}
