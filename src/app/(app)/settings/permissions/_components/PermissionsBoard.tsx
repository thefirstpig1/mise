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

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

export default function PermissionsBoard({ data }: { data: BoardData }) {
  const [tab, setTab] = useState<Tab>("roles");
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

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border-strong">
        {(
          [
            ["roles", "ตามบทบาท"],
            ["people", "รายคน"],
            ["log", "บันทึกการเปลี่ยน"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
              tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {id === "people" && exceptionCount > 0 && (
              <span className="ml-1.5 rounded-full bg-warn-bg px-2 text-xs text-warn">ยกเว้น {exceptionCount}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "roles" && <RolesTab data={data} capById={capById} say={say} />}
      {tab === "people" && <PeopleTab data={data} capById={capById} say={say} />}
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
}: {
  data: BoardData;
  capById: Map<string, Cap>;
  say: (m: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, string[]>>(data.roleTable);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = data.roles.filter((r) => !r.locked);
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

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm text-muted-foreground">
        {data.isOwner
          ? "ติ๊กเพื่อเปลี่ยนค่าของทั้งบทบาท ทุกคนในบทบาทนั้นได้ตาม ยกเว้นคนที่ตั้งไว้รายคน"
          : "เฉพาะเจ้าของร้านที่ปรับตารางนี้ได้ คุณดูได้อย่างเดียว ถ้าต้องการยกเว้นให้ใครคนหนึ่ง ไปที่แท็บรายคน"}
      </p>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-primary" />มีสิทธิ์</span>
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border-[1.5px] border-border-strong" />ไม่มี</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-warn" />ร้านเปลี่ยนจากค่าเริ่มต้นของคิดครัว</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-sunk">
              <th className="sticky left-0 z-10 min-w-[230px] bg-surface-sunk px-3 py-2 text-left text-xs font-medium text-muted-foreground">สิทธิ์</th>
              {data.roles.map((r) => (
                <th key={r.id} className="px-1.5 py-2 align-bottom text-xs font-medium">
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
                  <tr key={c.id} className="border-t border-border">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2">
                      <div className="font-medium">{c.label}</div>
                      {c.hint && <div className="text-xs text-muted-subtle">{c.hint}</div>}
                      {c.needs && <div className="text-xs text-warn">ต้องเห็น{c.needs === "cost:view" ? "ต้นทุน" : "ค่าใช้จ่าย"}ด้วย</div>}
                    </td>
                    {data.roles.map((r) => {
                      if (r.locked) return <td key={r.id} className="text-center text-muted-subtle">✓</td>;
                      const on = has(r.id, c.id);
                      const changed = on !== (data.defaults[r.id]?.includes(c.id) ?? false);
                      return (
                        <td key={r.id} className="py-1.5 text-center">
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
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </GroupRows>
            ))}
            <GroupRows label="ล็อกกับบทบาท ปรับไม่ได้" span={data.roles.length}>
              {data.locked.map((l) => (
                <tr key={l.label} className="border-t border-border">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2">
                    <div className="font-medium">🔒 {l.label}</div>
                    <div className="text-xs text-muted-subtle">{l.why}</div>
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
}: {
  data: BoardData;
  capById: Map<string, Cap>;
  say: (m: string) => void;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = data.members.filter((m) => !filter || m.effective.includes(filter));
  const open = data.members.find((m) => m.id === openId) ?? null;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
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
              className={`grid w-full grid-cols-1 items-center gap-2 px-4 py-2.5 text-left hover:bg-muted sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)] ${i ? "border-t border-border" : ""}`}
            >
              <span className="min-w-0">
                <span className="block font-medium">{m.name}</span>
                {m.name !== m.email && <span className="block truncate text-xs text-muted-subtle">{m.email}</span>}
              </span>
              <span className="min-w-0">
                <span className="block">{m.roleLabel}</span>
                <span className="block truncate text-xs text-muted-subtle">{m.branches}</span>
              </span>
              <span className="grid gap-1">
                <MoneyTags m={m} capById={capById} />
                {ex > 0 && <span className="text-xs text-warn">ยกเว้นรายคน {ex} ข้อ</span>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        ป้ายเขียวคือตัวเลขเงินที่คนนั้นเห็นจริง หลังรวมข้อยกเว้นแล้ว กดที่แถวเพื่อดูและปรับรายคน
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
        <div className="space-y-2 rounded-2xl border border-border bg-surface p-3 text-sm">
          <h4 className="text-xs font-medium text-muted-foreground">สิทธิ์จริงของคนนี้</h4>
          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2"><span className="text-muted-subtle">เห็นเงิน</span><MoneyTags m={m} capById={capById} /></div>
          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2"><span className="text-muted-subtle">ทำได้</span><span>{doing.map((c) => capById.get(c)?.label).join(" · ") || "ไม่มีข้อในตารางนี้"}</span></div>
          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2"><span className="text-muted-subtle">ทำไม่ได้</span><span className="text-muted-subtle">{notDoing.map((c) => capById.get(c)?.label).join(" · ") || "—"}</span></div>
        </div>
        <p className="text-xs text-muted-foreground">
          “ตามบทบาท” คือได้ตามตารางของร้าน ถ้าวันหน้าร้านเปลี่ยนตาราง คนนี้เปลี่ยนตาม ส่วน “เปิด” หรือ “ปิด”
          คือยกเว้นให้คนนี้คนเดียว และคงอยู่แม้ตารางเปลี่ยน
        </p>
        {m.locked && <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm">{m.locked}</p>}
        {error && <p className="text-sm text-bad">{error}</p>}

        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
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
    <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
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
