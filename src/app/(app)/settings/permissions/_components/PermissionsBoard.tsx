"use client";

// ADR 0038 — the board behind สิทธิ์ของร้าน (mockup ShGwn4G37nphkvnQrnf3WN).
//
// The role table is edited as a DRAFT and saved once, because a shop changes a
// role a few cells at a time and wants to see the whole of it before anyone is
// affected. A person's exception is saved on press: it is one decision about
// one person, and a save bar for it would only be a second click.
//
// The pair rule (Q2) is applied here so the screen explains it — ticking
// "รับของ" ticks "เห็นต้นทุน" with the reason, unticking cost asks first — and
// again on the server, which is the one that counts.
//
// Queue item 9 (Kong 2026-11-04): "จัดการรายคน ทำออกมาให้ชัดเจนมองเห็นง่าย เขาจะ
// ได้รู้ว่าตั้งค่ารายคนได้". A shop that reads only the role table thinks the
// only way to give one cashier the cost figures is a new role. So the tabs are
// a switch with a line each, the role tab says out loud that one person can be
// set apart, every person row carries the button, and the people screen links
// straight into a person's sheet (?tab=people&person=). On a phone the role
// table is one role at a time (answer ก): nine columns in 400px showed one.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Lock, ShieldCheck, UserCog } from "lucide-react";
import PillScroller from "@/components/ui/PillScroller";
import { orStale } from "@/lib/stale-tab";
import { ConfirmDialog, Sheet, type ConfirmSpec } from "@/app/(app)/menus/_components/sheet-parts";
import { setMemberCapabilityAction, setRoleCapabilitiesAction } from "../actions";

type Cap = { id: string; label: string; hint: string; needs: string | null };
type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  branches: string;
  exceptions: Record<string, boolean>;
  effective: string[];
  locked: string | null;
};
export type BoardData = {
  isOwner: boolean;
  actorCapabilities: string[];
  roles: { id: string; label: string; locked: boolean }[];
  groups: { label: string; capabilities: Cap[] }[];
  defaults: Record<string, string[]>;
  roleTable: Record<string, string[]>;
  locked: { label: string; why: string; roles: string[] }[];
  members: Member[];
  log: { id: string; when: string; who: string; text: string }[];
};

type Tab = "roles" | "people" | "log";
const MONEY = ["cost:view", "sales:view", "expense:view"] as const;

export default function PermissionsBoard({ data, initialTab, initialPerson }: { data: BoardData; initialTab?: Tab; initialPerson?: string | null }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? (initialPerson ? "people" : "roles"));
  // ?tab= follows the switch, so a link or a refresh lands on the same tab.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (tab === "roles") url.searchParams.delete("tab");
      else url.searchParams.set("tab", tab);
      url.searchParams.delete("person");
      window.history.replaceState(null, "", url);
    } catch {
      /* the address bar is a convenience */
    }
  }, [tab]);
  const [toast, setToast] = useState<string | null>(null);
  const say = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 4000);
  };
  const capById = useMemo(
    () => new Map(data.groups.flatMap((g) => g.capabilities).map((c) => [c.id, c])),
    [data.groups]
  );
  const exceptionCount = data.members.reduce((n, m) => n + Object.keys(m.exceptions).length, 0);
  const peopleSetApart = data.members.filter((m) => Object.keys(m.exceptions).length > 0).length;

  return (
    <div className="space-y-4">
      {/* A switch with a line under each choice, so "รายคน" says what it is for. */}
      <PillScroller className="-mx-1 px-1">
        <div role="tablist" aria-label="ตั้งสิทธิ์แบบไหน" className="seg flex-none flex-nowrap">
          {(
            [
              ["roles", ShieldCheck, "ตามบทบาท", "ทั้งบทบาททีเดียว"],
              ["people", UserCog, "รายคน", peopleSetApart > 0 ? `ตั้งแยกไว้ ${peopleSetApart} คน` : "ให้บางคนต่างจากบทบาท"],
              ["log", History, "บันทึกการเปลี่ยน", "ใครเปลี่ยนอะไรเมื่อไหร่"],
            ] as const
          ).map(([id, Icon, label, sub]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-current={tab === id ? "true" : undefined}
              onClick={() => setTab(id)}
              className={`seg-item !h-auto gap-2 !py-1.5 text-left ${tab === id ? "is-on" : ""}`}
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span className="grid leading-tight">
                <span className="whitespace-nowrap font-semibold">{label}</span>
                <span className={`whitespace-nowrap text-[11px] ${tab === id ? "opacity-80" : "text-muted-subtle"}`}>{sub}</span>
              </span>
            </button>
          ))}
        </div>
      </PillScroller>

      {tab === "roles" && (
        <RolesTab data={data} capById={capById} say={say} toPeople={() => setTab("people")} exceptionCount={exceptionCount} peopleSetApart={peopleSetApart} />
      )}
      {tab === "people" && <PeopleTab data={data} capById={capById} say={say} initialPerson={initialPerson ?? null} />}
      {tab === "log" && <LogTab data={data} />}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[80] max-w-[calc(100%-2rem)] -translate-x-1/2 animate-pop-in rounded-xl bg-foreground px-4 py-2.5 text-sm text-background shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// ตามบทบาท
// ------------------------------------------------------------

function RolesTab({
  data,
  capById,
  say,
  toPeople,
  exceptionCount,
  peopleSetApart,
}: {
  data: BoardData;
  capById: Map<string, Cap>;
  say: (m: string) => void;
  toPeople: () => void;
  exceptionCount: number;
  peopleSetApart: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, string[]>>(data.roleTable);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = data.roles.filter((r) => !r.locked);
  // The phone shows one role at a time; it opens on the first the shop can change.
  const [phoneRole, setPhoneRole] = useState(editable[0]?.id ?? data.roles[0]?.id);
  const roleLabel = (r: string) => data.roles.find((x) => x.id === r)?.label ?? r;
  const dependents = (need: string) => [...capById.values()].filter((c) => c.needs === need).map((c) => c.id);

  const has = (r: string, c: string) => draft[r]?.includes(c) ?? false;
  const changedRoles = editable.filter(
    (r) => [...capById.keys()].some((c) => has(r.id, c) !== (data.roleTable[r.id]?.includes(c) ?? false))
  );
  const changedCells = editable.reduce(
    (n, r) => n + [...capById.keys()].filter((c) => has(r.id, c) !== (data.roleTable[r.id]?.includes(c) ?? false)).length,
    0
  );
  const affected = data.members.filter((m) => changedRoles.some((r) => r.id === m.role)).length;

  const put = (r: string, add: string[], remove: string[]) =>
    setDraft((d) => ({ ...d, [r]: [...new Set([...(d[r] ?? []).filter((c) => !remove.includes(c)), ...add])] }));

  function toggle(r: string, c: string) {
    if (has(r, c)) {
      const deps = dependents(c).filter((d) => has(r, d));
      if (deps.length) {
        setConfirm({
          title: `ปิด “${capById.get(c)?.label}” ของ${roleLabel(r)}`,
          lines: deps.map((d) => `ปิด “${capById.get(d)?.label}” ไปด้วย เพราะหน้านั้นแสดงราคา`),
          money: null,
          who: "บันทึกเมื่อกด “บันทึก” ด้านล่าง",
          go: `ปิดทั้ง ${deps.length + 1} ข้อ`,
          onGo: () => put(r, [], [c, ...deps]),
        });
        return;
      }
      put(r, [], [c]);
    } else {
      const need = capById.get(c)?.needs;
      if (need && !has(r, need)) {
        put(r, [c, need], []);
        say(`เปิด “${capById.get(need)?.label}” ให้${roleLabel(r)}ด้วย เพราะ${capById.get(c)?.label}แสดงราคา`);
      } else put(r, [c], []);
    }
  }

  function save() {
    setError(null);
    start(async () => {
      for (const r of changedRoles) {
        const res = await orStale(setRoleCapabilitiesAction({ role: r.id, capabilities: draft[r.id] ?? [] }));
        if (!res.ok) {
          setError(res.formError);
          return;
        }
      }
      say("บันทึกแล้ว · ทุกคนในบทบาทนั้นได้สิทธิ์ใหม่ตั้งแต่หน้าถัดไปที่เปิด");
      router.refresh();
    });
  }

  function reset(r: string) {
    const diff = [...capById.keys()].filter(
      (c) => (data.roleTable[r]?.includes(c) ?? false) !== (data.defaults[r]?.includes(c) ?? false)
    );
    setConfirm({
      title: `กลับ${roleLabel(r)}เป็นค่าเริ่มต้นของคิดครัว`,
      lines: diff.map((c) => `${capById.get(c)?.label} → ${data.defaults[r]?.includes(c) ? "มีสิทธิ์" : "ไม่มี"}`),
      money: null,
      who: `มีผลกับทุกคนในบทบาท${roleLabel(r)} ยกเว้นคนที่ตั้งไว้รายคน`,
      go: "กลับเป็นค่าเริ่มต้น",
      onGo: () =>
        start(async () => {
          const res = await orStale(setRoleCapabilitiesAction({ role: r, capabilities: [], reset: true }));
          if (!res.ok) return setError(res.formError);
          setDraft((d) => ({ ...d, [r]: data.defaults[r] ?? [] }));
          say(`${roleLabel(r)}กลับเป็นค่าเริ่มต้นแล้ว`);
          router.refresh();
        }),
    });
  }

  const differsFromDefault = (r: string) =>
    [...capById.keys()].some((c) => (data.roleTable[r]?.includes(c) ?? false) !== (data.defaults[r]?.includes(c) ?? false));

  /** One role × one permission — the same box in the table and in the phone list. A render
   * function, not a component: defined in here, a component would remount on every press. */
  const tick = (r: BoardData["roles"][number], c: Cap) => {
    const on = has(r.id, c.id);
    const changed = on !== (data.defaults[r.id]?.includes(c.id) ?? false);
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={`${c.label} · ${r.label}`}
        disabled={!data.isOwner || pending}
        onClick={() => toggle(r.id, c.id)}
        className={`relative inline-grid h-8 w-8 place-items-center rounded-lg border-[1.5px] text-sm font-bold transition-colors disabled:cursor-not-allowed ${
          on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"
        } ${!data.isOwner ? "opacity-60" : ""}`}
      >
        {on && "✓"}
        {changed && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-warn" />}
      </button>
    );
  };

  return (
    <div className="space-y-3 rounded-[18px] border border-border/70 bg-surface shadow-card p-4">
      <p className="text-sm text-muted-foreground">
        {data.isOwner
          ? "ติ๊กเพื่อเปลี่ยนค่าของทั้งบทบาท ทุกคนในบทบาทนั้นได้ตาม ยกเว้นคนที่ตั้งไว้รายคน"
          : "เฉพาะเจ้าของร้านที่ปรับตารางนี้ได้ คุณดูได้อย่างเดียว ถ้าต้องการยกเว้นให้ใครคนหนึ่ง ไปที่แท็บรายคน"}
      </p>
      {/* Kong 2026-11-04: say, on the tab people read first, that one person can be set apart. */}
      <div className="note flex flex-wrap items-center gap-x-4 gap-y-2">
        <UserCog aria-hidden className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.8} />
        <p className="min-w-0 flex-[1_1_320px]">
          <b className="font-semibold text-foreground">บางคนต้องได้มากหรือน้อยกว่าบทบาทของเขา?</b> ตั้งสิทธิ์รายคนได้ เช่น
          ให้แคชเชียร์คนหนึ่งเห็นต้นทุน โดยไม่ต้องสร้างบทบาทใหม่ และคนอื่นในบทบาทเดียวกันไม่เปลี่ยน
          {exceptionCount > 0 && ` · ตอนนี้ตั้งแยกไว้ ${exceptionCount} ข้อ กับ ${peopleSetApart} คน`}
        </p>
        <button type="button" onClick={toPeople} className="btn-secondary btn-sm shrink-0 gap-1.5">
          ตั้งสิทธิ์รายคน
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-primary" />มีสิทธิ์</span>
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border-[1.5px] border-border-strong" />ไม่มี</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-warn" />ร้านเปลี่ยนจากค่าเริ่มต้นของคิดครัว</span>
      </div>

      {/* Phone (answer ก): pick a role, then its permissions as a list — the
          same draft, the same toggles, the same save bar as the table. */}
      <div className="space-y-3 sm:hidden">
        <PillScroller className="-mx-1 px-1">
          {data.roles.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-current={phoneRole === r.id ? "true" : undefined}
              onClick={() => setPhoneRole(r.id)}
              className={`pill shrink-0 gap-1.5 ${phoneRole === r.id ? "is-on" : ""}`}
            >
              {r.label}
              {changedRoles.some((x) => x.id === r.id) && <span className="h-2 w-2 rounded-full bg-warn" aria-label="แก้แล้วยังไม่บันทึก" />}
            </button>
          ))}
        </PillScroller>
        {(() => {
          const r = data.roles.find((x) => x.id === phoneRole) ?? data.roles[0];
          if (!r) return null;
          return (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {r.locked
                    ? r.id === "owner"
                      ? `${r.label} · มีทุกสิทธิ์เสมอ ปรับไม่ได้`
                      : `${r.label} · เท่าเจ้าของร้าน ปรับไม่ได้`
                    : `${r.label} · ${differsFromDefault(r.id) ? "ร้านปรับจากค่าเริ่มต้นแล้ว" : "ค่าเริ่มต้นของคิดครัว"}`}
                </span>
                {!r.locked && data.isOwner && differsFromDefault(r.id) && (
                  <button type="button" disabled={pending} onClick={() => reset(r.id)} className="rounded-full px-2 py-0.5 hover:bg-muted">
                    กลับเป็นค่าเริ่มต้น
                  </button>
                )}
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                {data.groups.map((g) => (
                  <div key={g.label}>
                    <div className="border-t border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground first:border-t-0">{g.label}</div>
                    {g.capabilities.map((c) => (
                      <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-3 py-2.5">
                        <CapLabel c={c} />
                        {r.locked ? (
                          <span className="grid h-8 w-8 place-items-center text-muted-subtle">✓</span>
                        ) : (
                          tick(r, c)
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                <div className="border-t border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">ล็อกกับบทบาท ปรับไม่ได้</div>
                {data.locked.map((l) => (
                  <div key={l.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-3 py-2.5">
                    <LockedLabel l={l} />
                    <span className="grid h-8 w-8 place-items-center text-muted-subtle">{l.roles.includes(r.id) ? "✓" : "—"}</span>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      <div className="data-table hidden sm:block">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-sunk">
              <th className="sticky left-0 z-10 min-w-[230px] bg-surface-sunk px-3 py-2 text-left text-xs font-medium text-muted-foreground">สิทธิ์</th>
              {data.roles.map((r) => (
                <th key={r.id} className="px-1.5 py-2 align-bottom text-xs">
                  <div className="grid justify-items-center gap-0.5">
                    <span className="whitespace-nowrap">{r.label}</span>
                    {r.locked ? (
                      <span className="whitespace-nowrap text-[11px] font-normal text-muted-subtle">{r.id === "owner" ? "ทุกอย่างเสมอ" : "เท่าเจ้าของ"}</span>
                    ) : (
                      data.isOwner && (
                        <button
                          type="button"
                          disabled={!differsFromDefault(r.id) || pending}
                          onClick={() => reset(r.id)}
                          className="whitespace-nowrap rounded-full px-2 text-[11px] font-normal text-muted-foreground hover:bg-muted disabled:opacity-40"
                        >
                          ค่าเริ่มต้น
                        </button>
                      )
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => (
              <GroupRows key={g.label} label={g.label} span={data.roles.length}>
                {g.capabilities.map((c) => (
                  <tr key={c.id}>
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2">
                      <CapLabel c={c} />
                    </td>
                    {data.roles.map((r) =>
                      r.locked ? (
                        <td key={r.id} className="text-center text-muted-subtle">✓</td>
                      ) : (
                        <td key={r.id} className="py-1.5 text-center">
                          {tick(r, c)}
                        </td>
                      )
                    )}
                  </tr>
                ))}
              </GroupRows>
            ))}
            <GroupRows label="ล็อกกับบทบาท ปรับไม่ได้" span={data.roles.length}>
              {data.locked.map((l) => (
                <tr key={l.label}>
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2">
                    <LockedLabel l={l} />
                  </td>
                  {data.roles.map((r) => (
                    <td key={r.id} className="text-center text-muted-subtle">{l.roles.includes(r.id) ? "✓" : "—"}</td>
                  ))}
                </tr>
              ))}
            </GroupRows>
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {changedCells > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground shadow-xl">
          <span>
            เปลี่ยน {changedCells} ข้อ · มีผลกับ {affected} คน ทันทีที่เขาเปิดหน้าถัดไป
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setDraft(data.roleTable)} disabled={pending} className="rounded-lg px-3 py-1.5 hover:bg-primary-deep">
              ยกเลิก
            </button>
            <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-primary-foreground px-4 py-1.5 font-medium text-primary">
              {pending ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </span>
        </div>
      )}

      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function CapLabel({ c }: { c: Cap }) {
  return (
    <div className="min-w-0">
      <div className="font-medium">{c.label}</div>
      {c.hint && <div className="text-xs text-muted-subtle">{c.hint}</div>}
      {c.needs && <div className="text-xs text-warn">ต้องเห็น{c.needs === "cost:view" ? "ต้นทุน" : "ค่าใช้จ่าย"}ด้วย</div>}
    </div>
  );
}

/** A permission tied to its role. A line icon, not the 🔒 emoji every device drew its own way. */
function LockedLabel({ l }: { l: BoardData["locked"][number] }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <Lock aria-label="ล็อก" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted-subtle" strokeWidth={1.8} />
      <div className="min-w-0">
        <div className="font-medium">{l.label}</div>
        <div className="text-xs text-muted-subtle">{l.why}</div>
      </div>
    </div>
  );
}

function GroupRows({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-border bg-muted">
        <td className="sticky left-0 z-10 bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">{label}</td>
        <td colSpan={span} />
      </tr>
      {children}
    </>
  );
}

// ------------------------------------------------------------
// รายคน
// ------------------------------------------------------------

function MoneyTags({ m, capById }: { m: Member; capById: Map<string, Cap> }) {
  return (
    <span className="flex flex-wrap gap-1">
      {MONEY.map((c) => {
        const on = m.effective.includes(c);
        return (
          <span
            key={c}
            className={`whitespace-nowrap rounded-full px-2 text-xs ${on ? "bg-good-bg text-good" : "bg-muted text-muted-subtle line-through"}`}
          >
            {capById.get(c)?.label.replace(/^เห็น/, "")}
          </span>
        );
      })}
    </span>
  );
}

function PeopleTab({
  data,
  capById,
  say,
  initialPerson,
}: {
  data: BoardData;
  capById: Map<string, Cap>;
  say: (m: string) => void;
  /** From the people screen: open this person's sheet straight away. */
  initialPerson: string | null;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialPerson && data.members.some((m) => m.id === initialPerson) ? initialPerson : null);
  const shown = data.members.filter((m) => !filter || m.effective.includes(filter));
  const open = data.members.find((m) => m.id === openId) ?? null;

  return (
    <div className="space-y-3 rounded-[18px] border border-border/70 bg-surface shadow-card p-4">
      <p className="text-sm text-muted-foreground">
        แต่ละคนได้สิทธิ์ตามบทบาทของเขา · กด <b className="font-semibold text-foreground">ตั้งสิทธิ์รายคน</b> เพื่อเปิดหรือปิดบางข้อให้คนนั้นคนเดียว
        คนอื่นในบทบาทเดียวกันไม่เปลี่ยน
      </p>
      <div className="flex flex-wrap gap-2">
        {MONEY.map((c) => {
          const n = data.members.filter((m) => m.effective.includes(c)).length;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={filter === c}
              onClick={() => setFilter((f) => (f === c ? null : c))}
              className={`rounded-full border px-3 py-1 text-sm ${filter === c ? "border-warn bg-warn-bg" : "border-border hover:bg-muted"}`}
            >
              {capById.get(c)?.label} <b className="text-warn">{n}</b> คน
            </button>
          );
        })}
        {filter && (
          <button type="button" onClick={() => setFilter(null)} className="rounded-full border border-border px-3 py-1 text-sm hover:bg-muted">
            ดูทุกคน
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        {shown.map((m, i) => {
          const ex = Object.keys(m.exceptions).length;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setOpenId(m.id)}
              className={`group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] ${i ? "border-t border-border" : ""}`}
            >
              <span className="min-w-0">
                <span className="block font-medium">{m.name}</span>
                {m.name !== m.email && <span className="block truncate text-xs text-muted-subtle">{m.email}</span>}
              </span>
              <span className="min-w-0">
                <span className="block">{m.roleLabel}</span>
                <span className="block truncate text-xs text-muted-subtle">{m.branches}</span>
              </span>
              <span className="col-span-2 grid gap-1 sm:col-span-1">
                <MoneyTags m={m} capById={capById} />
                <span>
                  {m.role === "owner" ? (
                    <span className="chip">ทุกสิทธิ์เสมอ</span>
                  ) : ex > 0 ? (
                    <span className="chip chip-warn">ตั้งรายคนไว้ {ex} ข้อ</span>
                  ) : (
                    <span className="chip">ตามบทบาท</span>
                  )}
                </span>
              </span>
              {/* Kong 2026-11-04: the press is shown, not only the row. */}
              <span className="col-start-2 row-start-1 inline-flex h-9 items-center gap-1.5 self-center whitespace-nowrap rounded-[10px] border border-border-strong bg-surface px-3 text-[13px] font-semibold transition-colors group-hover:border-primary sm:col-start-auto sm:row-start-auto">
                <UserCog aria-hidden className="h-4 w-4" strokeWidth={1.8} />
                {m.locked ? "ดูสิทธิ์" : "ตั้งสิทธิ์รายคน"}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        ป้ายเขียวคือตัวเลขเงินที่คนนั้นเห็นจริง หลังรวมที่ตั้งรายคนแล้ว · เจ้าของร้านมีทุกสิทธิ์เสมอ และแก้สิทธิ์ของตัวเองไม่ได้
      </p>

      {open && <PersonSheet m={open} data={data} capById={capById} say={say} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function PersonSheet({
  m,
  data,
  capById,
  say,
  onClose,
}: {
  m: Member;
  data: BoardData;
  capById: Map<string, Cap>;
  say: (msg: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const actorHas = (c: string) => data.actorCapabilities.includes(c);
  const roleHas = (c: string) => data.roleTable[m.role]?.includes(c) ?? false;
  const doing = m.effective.filter((c) => !MONEY.includes(c as never));
  const notDoing = [...capById.keys()].filter((c) => !MONEY.includes(c as never) && !m.effective.includes(c));

  function press(cap: string, state: "inherit" | "grant" | "revoke") {
    setError(null);
    start(async () => {
      const res = await orStale(setMemberCapabilityAction({ membershipId: m.id, capability: cap, state }));
      if (!res.ok) return setError(res.formError);
      const need = capById.get(cap)?.needs;
      if (state === "grant" && need && !m.effective.includes(need)) {
        say(`เปิด “${capById.get(need)?.label}” ให้ด้วย เพราะ${capById.get(cap)?.label}แสดงราคา`);
      } else say("บันทึกแล้ว · มีผลทันทีที่คนนั้นเปิดหน้าถัดไป");
      router.refresh();
    });
  }

  return (
    <Sheet onClose={onClose} labelledBy="person-title">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-xs text-muted-subtle">{m.roleLabel} · {m.branches}</p>
          <h3 id="person-title" className="text-lg font-semibold">{m.name}</h3>
          {m.name !== m.email && <p className="text-xs text-muted-subtle">{m.email}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="ปิด" className="grid h-9 w-9 place-items-center rounded-full text-2xl leading-none text-muted-foreground hover:bg-muted">
          ×
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="space-y-2 rounded-[18px] border border-border/70 bg-surface shadow-card p-3 text-sm">
          <h4 className="text-xs font-medium text-muted-foreground">สิทธิ์จริงของคนนี้</h4>
          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2"><span className="text-muted-subtle">เห็นเงิน</span><MoneyTags m={m} capById={capById} /></div>
          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2"><span className="text-muted-subtle">ทำได้</span><span>{doing.map((c) => capById.get(c)?.label).join(" · ") || "ไม่มีข้อในตารางนี้"}</span></div>
          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2"><span className="text-muted-subtle">ทำไม่ได้</span><span className="text-muted-subtle">{notDoing.map((c) => capById.get(c)?.label).join(" · ") || "—"}</span></div>
        </div>
        <p className="note">
          <b className="font-semibold text-foreground">ตั้งสิทธิ์ให้{m.name}คนเดียว</b> — “ตามบทบาท” คือได้ตามตารางของ{m.roleLabel}
          ถ้าวันหน้าร้านเปลี่ยนตาราง คนนี้เปลี่ยนตาม ส่วน “เปิด” หรือ “ปิด” คือยกเว้นให้คนนี้คนเดียว และคงอยู่แม้ตารางเปลี่ยน ·
          กดแล้วบันทึกทันที
        </p>
        {m.locked && <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm">{m.locked}</p>}
        {error && <p className="text-sm text-bad">{error}</p>}

        <div className="overflow-hidden rounded-[18px] border border-border/70 bg-surface shadow-card">
          {data.groups.map((g) => (
            <div key={g.label}>
              <div className="bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">{g.label}</div>
              {g.capabilities.map((c) => {
                const ex = m.exceptions[c.id];
                const st = ex === undefined ? "inherit" : ex ? "grant" : "revoke";
                const blockGrant = !actorHas(c.id) || (c.needs !== null && !m.effective.includes(c.needs) && !actorHas(c.needs));
                const dis = m.locked !== null || pending;
                const line =
                  st === "inherit" ? `ตาม${m.roleLabel}: ${roleHas(c.id) ? "มีสิทธิ์" : "ไม่มี"}` : st === "grant" ? "เปิดให้คนนี้" : "ปิดสำหรับคนนี้";
                return (
                  <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm">{c.label}</div>
                      <div className={`text-xs ${blockGrant && !roleHas(c.id) && st !== "grant" ? "text-warn" : "text-muted-subtle"}`}>
                        {blockGrant && !roleHas(c.id) && st !== "grant" ? "คุณไม่มีสิทธิ์นี้เอง จึงให้คนอื่นไม่ได้" : line}
                        {c.needs && ` · ต้องเห็น${c.needs === "cost:view" ? "ต้นทุน" : "ค่าใช้จ่าย"}ด้วย`}
                      </div>
                    </div>
                    <div role="group" aria-label={c.label} className="inline-flex overflow-hidden rounded-lg border border-border bg-surface-sunk text-xs">
                      <TriButton on={st === "inherit"} tone="inherit" disabled={dis || st === "inherit"} onClick={() => press(c.id, "inherit")}>
                        ตามบทบาท {roleHas(c.id) ? "✓" : "—"}
                      </TriButton>
                      <TriButton on={st === "grant"} tone="grant" disabled={dis || st === "grant" || roleHas(c.id) || blockGrant} onClick={() => press(c.id, "grant")}>
                        เปิด
                      </TriButton>
                      <TriButton on={st === "revoke"} tone="revoke" disabled={dis || st === "revoke" || !roleHas(c.id)} onClick={() => press(c.id, "revoke")}>
                        ปิด
                      </TriButton>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function TriButton({
  on,
  tone,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  tone: "inherit" | "grant" | "revoke";
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const active = { inherit: "bg-surface font-semibold text-foreground", grant: "bg-good-bg font-semibold text-good", revoke: "bg-bad-bg font-semibold text-bad" }[tone];
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`whitespace-nowrap border-l border-border px-2.5 py-1.5 first:border-l-0 ${on ? active : "text-muted-foreground hover:bg-muted"} ${!on && disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------
// บันทึกการเปลี่ยน
// ------------------------------------------------------------

function LogTab({ data }: { data: BoardData }) {
  return (
    <div className="space-y-3 rounded-[18px] border border-border/70 bg-surface shadow-card p-4">
      <p className="text-sm text-muted-foreground">ทุกการเปลี่ยนสิทธิ์ ทั้งของบทบาทและรายคน เก็บไว้ตลอด ลบไม่ได้</p>
      {data.log.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted-foreground">
          ยังไม่มีการเปลี่ยนสิทธิ์ ร้านใช้ค่าเริ่มต้นของคิดครัวอยู่ทั้งหมด
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {data.log.map((l, i) => (
            <div key={l.id} className={`grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3 ${i ? "border-t border-border" : ""}`}>
              <time className="text-xs tabular-nums text-muted-subtle">{l.when}</time>
              <span>
                <b className="font-medium">{l.who}</b> {l.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
