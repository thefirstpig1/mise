"use client";

// ADR 0045 — หน้าควบคุม › ภาพรวม (mockup Q7BabbD2jHMDtdqEYxLmUR §1). What Kong
// has to DO comes first; every figure underneath opens the shops behind it.
// Olive for figures, clay for the one thing a card points at, dashed outlines
// for what is not collected yet — never a 0 that only means "not measured".

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Activity, CalendarClock, CheckCircle2, Flag, ListChecks, Scale, Sparkles, Store, UserRound, Users, Rocket, MonitorSmartphone, Package, LogIn } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Stat from "@/components/ui/Stat";
import IconTile from "@/components/ui/IconTile";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";
import type { Bar, PlatformOverview, ShopRef, Todo } from "@/lib/platform-overview";

const TODO_ICON: Record<string, LucideIcon> = { reports: Flag, legal: Scale, "stuck-sales": Rocket, "free-limit": Package };
const n = (v: number) => v.toLocaleString("th-TH");
/** The tile behind a to-do's icon takes the item's tone. */
const TILE: Record<Todo["tone"], string> = {
  bad: "bg-bad-bg ring-bad-border [&_svg]:text-bad",
  warn: "bg-warn-bg ring-warn-border [&_svg]:text-warn",
  plain: "",
};
const asOf = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });

type Drill = { title: string; shops: ShopRef[] } | null;

export default function OverviewView({ overview: o, todos, roleLabels }: { overview: PlatformOverview; todos: Todo[]; roleLabels: Record<string, string> }) {
  const [drill, setDrill] = useState<Drill>(null);
  const open = (title: string, shops: ShopRef[]) => setDrill({ title, shops });

  return (
    <div className="space-y-5">
      <div>
        <p className="font-display text-xs font-semibold tracking-[0.12em] text-gold-ink">หน้าควบคุมระบบ</p>
        <h1 className="page-title">ภาพรวม</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ข้อมูล ณ {asOf(o.asOf)} · นับจากสิ่งที่ร้านบันทึกจริง
          {o.excluded.length > 0 && (
            <>
              {" "}
              ·{" "}
              <button type="button" className="link" onClick={() => open("ร้านของแอดมินที่ไม่นับรวม", o.excluded)}>
                ไม่นับร้านของแอดมิน {n(o.excluded.length)} ร้าน
              </button>
            </>
          )}
        </p>
      </div>

      <TodoBox todos={todos} onShops={open} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={Users} label="ผู้ใช้งาน" value={n(o.users.total)} sub={`เป็นเจ้าของร้าน ${n(o.users.owners)} คน`} />
        <Stat
          icon={Store}
          label="ร้าน"
          value={n(o.shops)}
          sub={`${n(o.branches.total)} สาขา · หลายสาขา ${n(o.branches.multiBranchShops.length)} ร้าน`}
          onClick={() => open("ร้านที่มีหลายสาขา", o.branches.multiBranchShops)}
        />
        <Stat
          icon={Activity}
          label="มีการบันทึกใน 7 วัน"
          value={`${n(o.recorded.d7.length)} ร้าน`}
          sub={`30 วัน: ${n(o.recorded.d30.length)} ร้าน · ไม่นับการเปิดดูอย่างเดียว`}
          onClick={() => open("ร้านที่มีการบันทึกใน 7 วัน", o.recorded.d7)}
        />
        <Stat
          icon={Sparkles}
          label="สมัครใหม่ 30 วัน"
          value={`${n(o.signups.last30.length)} ร้าน`}
          sub={`30 วันก่อนหน้า ${n(o.signups.prev30)} ร้าน`}
          onClick={() => open("ร้านที่สมัครใน 30 วัน", o.signups.last30)}
        />
        <Stat icon={UserRound} label="อยู่หลายร้าน" value={`${n(o.users.multiShop)} คน`} sub="เช่น บัญชีที่ทำให้หลายร้าน" className="col-span-2 lg:col-span-1" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card icon={Users} title="ตำแหน่งในร้าน" note="นับเป็นคน · ทุกร้าน">
          <Bars bars={o.roles.map((b) => ({ ...b, label: roleLabels[b.key] ?? b.key }))} onPick={open} />
          <p className="mt-2 text-xs text-muted-subtle">
            ตั้งสิทธิ์รายคนไว้ {n(o.peopleWithOwnPermissions)} คน · พนักงานที่ไม่มีบัญชี (รายชื่อมื้อพนักงาน) {n(o.staffWithoutAccount)} คน
          </p>
        </Card>
        <Card icon={MonitorSmartphone} title="POS ที่ร้านใช้" note="นับเป็นสาขา · สีส้ม = ใช้มากที่สุด">
          <Bars bars={o.pos} onPick={open} accentMax />
          <p className="mt-2 text-xs text-muted-subtle">กดยี่ห้อเพื่อดูว่าเป็นร้านไหน</p>
        </Card>
      </div>

      <Card icon={Rocket} title="ร้านตั้งค่าไปถึงไหน" note={`ขั้นเดียวกับการ์ดเริ่มต้นใช้งานของร้าน · ${n(o.shops)} ร้าน · สีส้ม = ขั้นที่ร้านหลุดมากที่สุด`}>
        <div className="space-y-1.5">
          {o.funnel.map((s, i) => {
            const pct = s.of ? Math.round((s.n / s.of) * 100) : 0;
            const drop = s.key === o.biggestDrop;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => open(`${s.label} · ทำแล้ว`, s.shops)}
                className="grid w-full grid-cols-[1.1rem_minmax(0,6.5rem)_minmax(0,1fr)_4.6rem] items-center gap-2 sm:grid-cols-[1.4rem_minmax(0,9.5rem)_minmax(0,1fr)_5.5rem] sm:gap-2.5 rounded-lg px-1 py-0.5 text-left text-sm hover:bg-muted/60"
              >
                <span className="font-display text-xs font-semibold text-muted-subtle">{i + 1}</span>
                <span className="min-w-0">
                  {s.label}
                  {s.note && <span className="block text-[11px] leading-tight text-muted-subtle">{s.note}</span>}
                </span>
                <span className="h-3.5 overflow-hidden rounded-md bg-muted">
                  <i
                    className="block h-full origin-left animate-grow-x rounded-md"
                    style={{ width: `${pct}%`, background: drop ? "linear-gradient(90deg,#E8A76F,#C0692B)" : "linear-gradient(90deg,#AEB784,#5E6B14)", animationDelay: `${i * 40}ms` }}
                  />
                </span>
                <span className="text-right tabular-nums">
                  <b className="font-display">{n(s.n)}</b>
                  <small className="ml-1 text-muted-subtle">{s.of ? `${pct}%` : "—"}</small>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card icon={Activity} title="ฟีเจอร์ที่ร้านใช้" note="30 วัน · นับเป็นร้าน">
          <Bars bars={[...o.features].sort((a, b) => b.n - a.n)} onPick={open} />
          <p className="mt-2 text-xs text-muted-subtle">
            วิธีคิดต้นทุน: นับสต็อก {n(o.methods.periodic)} ร้าน · สูตรอาหาร {n(o.methods.recipe)} ร้าน
          </p>
        </Card>
        <Card icon={Package} title="แพ็กเกจ" note="ตอนนี้">
          <Bars bars={o.plans} onPick={open} />
          <p className="mt-2 text-xs text-muted-subtle">
            <button type="button" className="link" onClick={() => open("ใช้ฟรีหมดใน 30 วัน", o.freeEndingSoon)}>
              ใช้ฟรีหมดใน 30 วัน {n(o.freeEndingSoon.length)} ร้าน
            </button>{" "}
            ·{" "}
            <button type="button" className="link" onClick={() => open("Free ที่ยังไม่ได้ตั้งวันหมด", o.freeUnset)}>
              ยังไม่ได้ตั้งวันหมด {n(o.freeUnset.length)} ร้าน
            </button>
          </p>
          <Weekly weeks={o.signups.weekly} />
        </Card>
        <Card icon={LogIn} title="การเข้าใช้งาน" note="เฉลี่ยต่อคน · 4 สัปดาห์ล่าสุด">
          {o.usage && o.usage.roles.length > 0 ? (
            <>
              <div className="space-y-1.5">
                {o.usage.roles.map((r, i) => (
                  <div key={r.key} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_4.2rem] items-center gap-2.5 px-1 py-0.5 text-sm">
                    <span className="truncate">
                      {roleLabels[r.key] ?? r.key} <small className="text-muted-subtle">· {n(r.people)} คน</small>
                    </span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <i
                        className="block h-full origin-left animate-grow-x rounded-full"
                        style={{ width: `${Math.min(100, (r.perWeek / 7) * 100)}%`, background: "linear-gradient(90deg,#AEB784,#5E6B14)", animationDelay: `${i * 35}ms` }}
                      />
                    </span>
                    <span className="text-right font-display font-semibold tabular-nums">{r.perWeek.toLocaleString("th-TH", { maximumFractionDigits: 1 })} วัน</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-subtle">วันต่อสัปดาห์ที่เปิดแอป · เริ่มเก็บ {asOf(`${o.usage.since}T05:00:00Z`).split(" ").slice(0, 3).join(" ")}</p>
            </>
          ) : (
            <Waiting title="เข้ากี่วันต่อสัปดาห์" body="แยกตามบทบาท · ขึ้นเมื่อมีคนเปิดแอปหลังเริ่มเก็บ" />
          )}
          <div className="mt-4 border-t border-border/70 pt-3">
            {o.answers.shopType.length + o.answers.province.length + o.answers.heardFrom.length > 0 ? (
              <div className="space-y-3">
                {o.answers.shopType.length > 0 && <Answer title="ประเภทร้าน" bars={o.answers.shopType} onPick={open} />}
                {o.answers.heardFrom.length > 0 && <Answer title="รู้จักคิดครัวจากไหน" bars={o.answers.heardFrom} onPick={open} />}
                {o.answers.province.length > 0 && <Answer title="จังหวัด" bars={o.answers.province.slice(0, 5)} onPick={open} />}
                <button type="button" className="link text-xs" onClick={() => open("ร้านที่ยังไม่ได้ตอบ", o.answers.unanswered)}>
                  ยังไม่ได้ตอบ {n(o.answers.unanswered.length)} ร้าน
                </button>
              </div>
            ) : (
              <Waiting title="ประเภทร้าน · จังหวัด · รู้จักจากไหน" body="จากคำถาม 3 ข้อในการ์ดเริ่มต้นใช้งาน (ไม่บังคับตอบ)" />
            )}
          </div>
        </Card>
      </div>

      {drill && <ShopList title={drill.title} shops={drill.shops} onClose={() => setDrill(null)} />}
    </div>
  );
}

function TodoBox({ todos, onShops }: { todos: Todo[]; onShops: (title: string, shops: ShopRef[]) => void }) {
  if (todos.length === 0)
    return (
      <div className="flex items-center gap-3 rounded-[18px] border border-good-border bg-good-bg/60 px-4 py-3 text-sm">
        <CheckCircle2 className="h-5 w-5 text-good" aria-hidden />
        <span>
          <b className="font-display">ไม่มีอะไรค้าง</b> · เมื่อมีเรื่องที่ต้องทำ เช่น ร้านใกล้หมดช่วงใช้ฟรี หรือมีเรื่องแจ้งเข้ามา จะขึ้นที่นี่
        </span>
      </div>
    );
  return (
    <section className="rounded-[18px] border border-warn-border bg-gradient-to-b from-warn-bg to-surface to-70% px-4 py-3.5" aria-label="ต้องทำ">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <IconTile icon={ListChecks} className={TILE.warn} />
          ต้องทำ {todos.length} เรื่อง
        </h2>
        <small className="text-xs text-muted-foreground">เรื่องที่มีกำหนดขึ้นก่อน · ทำเสร็จแล้วรายการหายเอง</small>
      </div>
      <ul>
        {todos.map((t) => {
          const Icon = t.key.startsWith("free-") ? CalendarClock : (TODO_ICON[t.key] ?? Flag);
          return (
            <li key={t.key} className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 border-t border-warn-border/50 py-2.5 first:border-t-0 sm:grid-cols-[30px_minmax(0,1fr)_auto]">
              <IconTile icon={Icon} className={TILE[t.tone]} />
              <div className="min-w-0">
                <b className="font-display text-sm font-semibold">{t.title}</b>
                <p className="text-xs text-muted-foreground">{t.detail}</p>
              </div>
              <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
                {t.chip && <span className={`chip ${t.tone === "bad" ? "chip-bad" : t.tone === "warn" ? "chip-warn" : ""}`}>{t.chip}</span>}
                {t.shops && t.shops.length > 1 && (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => onShops(t.title, t.shops!)}>
                    ดูรายชื่อ
                  </button>
                )}
                <Link href={(t.shops?.length === 1 ? `${t.href}?q=${encodeURIComponent(t.shops[0].name)}` : t.href) as Route} className="btn btn-sm">
                  {t.cta}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Card({ icon, title, note, children }: { icon: LucideIcon; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-[18px] border border-border/70 bg-surface p-4 shadow-card">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15.5px] font-semibold">
          <IconTile icon={icon} />
          {title}
        </h2>
        {note && <small className="text-xs text-muted-subtle">{note}</small>}
      </div>
      {children}
    </section>
  );
}

function Bars({ bars, onPick, accentMax = false }: { bars: Bar[]; onPick: (title: string, shops: ShopRef[]) => void; accentMax?: boolean }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  const top = accentMax ? bars.reduce((a, b) => (b.n > a.n ? b : a), bars[0]) : null;
  return (
    <div className="space-y-1.5">
      {bars.map((b, i) => (
        <button
          key={b.key}
          type="button"
          disabled={b.shops.length === 0}
          onClick={() => onPick(b.label, b.shops)}
          className="grid w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.6rem] items-center gap-2.5 rounded-lg px-1 py-0.5 text-left text-sm enabled:hover:bg-muted/60 disabled:cursor-default"
        >
          <span className="truncate">{b.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted">
            <i
              className="block h-full origin-left animate-grow-x rounded-full"
              style={{
                width: `${(b.n / max) * 100}%`,
                background: top && b === top && b.n > 0 ? "linear-gradient(90deg,#E8A76F,#C0692B)" : "linear-gradient(90deg,#AEB784,#5E6B14)",
                animationDelay: `${i * 35}ms`,
              }}
            />
          </span>
          <span className="text-right font-display font-semibold tabular-nums">{n(b.n)}</span>
        </button>
      ))}
    </div>
  );
}

function Answer({ title, bars, onPick }: { title: string; bars: Bar[]; onPick: (title: string, shops: ShopRef[]) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">{title}</p>
      <Bars bars={bars} onPick={onPick} />
    </div>
  );
}

function Weekly({ weeks }: { weeks: { weekStart: string; n: number }[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.n));
  const last = weeks[weeks.length - 1];
  return (
    <div className="mt-4">
      <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
        <IconTile icon={Sparkles} />
        สมัครใหม่รายสัปดาห์ <small className="font-normal text-muted-subtle">12 สัปดาห์</small>
      </p>
      <div className="flex h-14 items-end gap-1" role="img" aria-label={`สมัครใหม่ 12 สัปดาห์ สัปดาห์นี้ ${last?.n ?? 0} ร้าน`}>
        {weeks.map((w, i) => (
          <i
            key={w.weekStart}
            title={`สัปดาห์เริ่ม ${w.weekStart}: ${w.n} ร้าน`}
            className="block flex-1 origin-bottom animate-grow-y rounded-t"
            style={{
              height: `${Math.max(4, (w.n / max) * 100)}%`,
              background: i === weeks.length - 1 ? "linear-gradient(180deg,#C0692B,#E8A76F)" : w.n ? "linear-gradient(180deg,#5E6B14,#AEB784)" : "#F3EFDF",
              animationDelay: `${i * 30}ms`,
            }}
          />
        ))}
      </div>
      <p className="mt-1 flex justify-between text-[11px] text-muted-subtle">
        <span>12 สัปดาห์ก่อน</span>
        <span>สัปดาห์นี้ {n(last?.n ?? 0)}</span>
      </p>
    </div>
  );
}

function Waiting({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-2 grid gap-1 rounded-[14px] border-[1.5px] border-dashed border-border-strong bg-background px-3.5 py-3 text-sm text-muted-foreground" data-waiting>
      <b className="font-display font-semibold text-foreground">{title}</b>
      <span className="text-xs">{body}</span>
      <span className="mt-1 grid gap-1.5" aria-hidden>
        <i className="block h-2.5 w-4/5 rounded-full border-[1.5px] border-dashed border-border-strong" />
        <i className="block h-2.5 w-1/2 rounded-full border-[1.5px] border-dashed border-border-strong" />
      </span>
    </div>
  );
}

function ShopList({ title, shops, onClose }: { title: string; shops: ShopRef[]; onClose: () => void }) {
  useTopLayer(onClose);
  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 animate-fade-in bg-black/25" onMouseDown={onClose} aria-hidden />
        <div role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[85dvh] w-full max-w-md animate-pop-in space-y-3 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <h2 className="flex-1 text-lg font-semibold">
              {title} <span className="text-sm font-normal text-muted-foreground">· {n(shops.length)} ร้าน</span>
            </h2>
            <button type="button" onClick={onClose} className="icon-btn text-xl leading-none" aria-label="ปิด">
              ×
            </button>
          </div>
          {shops.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีร้านในกลุ่มนี้</p>
          ) : (
            <ul className="divide-y divide-border/70 text-sm">
              {shops.map((s) => (
                <li key={s.id}>
                  <Link href={`/platform/shops?q=${encodeURIComponent(s.name)}` as Route} className="block rounded-lg px-1 py-2 hover:bg-muted/60">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Portal>
  );
}
