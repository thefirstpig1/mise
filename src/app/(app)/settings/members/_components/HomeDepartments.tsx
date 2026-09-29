"use client";

// Part 38 (ADR 0036 Q3) — each person's home department: where the things they
// add to the purchase request go unless they choose otherwise. A label, not a
// permission. Shown only when the shop has departments switched on.

import { useState } from "react";
import { orStale } from "@/lib/stale-tab";
import { setHomeDepartmentAction } from "../actions";

type Row = { membershipId: string; name: string; departmentId: string | null };

export default function HomeDepartments({ rows, departments }: { rows: Row[]; departments: { id: string; name: string }[] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.membershipId, r.departmentId ?? ""]))
  );
  const [status, setStatus] = useState<Record<string, string>>({});

  const change = async (membershipId: string, departmentId: string) => {
    setValues((v) => ({ ...v, [membershipId]: departmentId }));
    setStatus((s) => ({ ...s, [membershipId]: "กำลังบันทึก…" }));
    const r = await orStale(setHomeDepartmentAction({ membershipId, departmentId: departmentId || null }));
    setStatus((s) => ({ ...s, [membershipId]: r.ok ? "บันทึกแล้ว" : r.formError }));
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-base font-semibold">แผนกหลักของแต่ละคน</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        ของที่คนนี้เพิ่มเข้าใบขอซื้อจะเป็นของแผนกนี้โดยอัตโนมัติ (เปลี่ยนรายการเองได้) · ไม่ได้เพิ่มหรือลดสิทธิ์ใด ๆ
      </p>
      <ul className="mt-3 divide-y divide-border">
        {rows.map((r) => (
          <li key={r.membershipId} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
            <span>{r.name}</span>
            <span className="flex items-center gap-2">
              <select value={values[r.membershipId]} onChange={(e) => change(r.membershipId, e.target.value)} className="input w-48">
                <option value="">— ไม่ระบุ (แผนกหลักของร้าน) —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {status[r.membershipId] && <span className="text-xs text-muted-foreground">{status[r.membershipId]}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
