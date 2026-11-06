"use client";

// ============================================================
// คิดครัว — the bill list's filters, answered in place (queue item 9)
// ============================================================
// Kong 2026-11-03 ("เอาตามแนะนำ ดีไซน์ดีๆ"): the list used to wait for a
// "กรอง" press and reload. Every choice here changes the URL at once through
// the router, inside a transition, so the old list stays up until the new
// one arrives (the FilterLink rule, mise-ui-review §5b) and nothing jumps to
// the top. The URL keeps the same names as before (`branch`, `supplier`,
// `source`, `status`, `from`, `to`), so links from other pages still land.
//
// The period is one segmented control: every month (no dates — the old
// default, kept so a supplier's "ค้างจ่าย" link still shows every month),
// this month, one month from the last twelve, or a range of days.
// ============================================================

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import SelectChip from "@/components/ui/SelectChip";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import { X } from "lucide-react";

export type ExpenseFilterValue = {
  branch: string;
  supplier: string;
  source: string;
  status: string;
  from: string;
  to: string;
};

type Option = { value: string; label: string };

export default function ExpenseFilters({
  value,
  branches,
  suppliers,
  sources,
  statuses,
  months,
  thisMonth,
  actions,
}: {
  value: ExpenseFilterValue;
  /** Only when the reader sees more than one branch. */
  branches: Option[] | null;
  suppliers: PickerProduct[];
  sources: Option[];
  statuses: Option[];
  /** The last twelve months, newest first: key YYYY-MM, label "ก.ย. 69", from/to the month's first and last day. */
  months: { key: string; label: string; from: string; to: string }[];
  thisMonth: { from: string; to: string };
  /** The page's doors at the end of the row (analysis, Excel). */
  actions: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const month = months.find((m) => m.from === value.from && m.to === value.to) ?? null;
  const isThisMonth = value.from === thisMonth.from && value.to === thisMonth.to;
  const custom = (value.from !== "" || value.to !== "") && !month;
  const [showDates, setShowDates] = useState(custom);
  const chosen = value.supplier ? suppliers.find((x) => x.id === value.supplier) ?? null : null;

  const go = (next: Partial<ExpenseFilterValue>) => {
    const v = { ...value, ...next };
    const q = new URLSearchParams();
    for (const k of ["branch", "supplier", "source", "status", "from", "to"] as const) if (v[k]) q.set(k, v[k]);
    const qs = q.toString();
    start(() => router.push(`/expenses${qs ? `?${qs}` : ""}` as Route, { scroll: false }));
  };

  const seg = (on: boolean) => `seg-item ${on ? "is-on" : ""}`;

  return (
    <div data-help="expenses-filters" className="space-y-2.5" aria-busy={pending || undefined}>
      {/* A phone: the supplier search on its own line, the chips two to a row. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {branches && (
          <SelectChip
            size="sm"
            className="w-full sm:w-36"
            value={value.branch}
            options={[{ value: "", label: "ทุกสาขา" }, ...branches]}
            onChange={(branch) => go({ branch })}
            selectProps={{ "aria-label": "สาขา" }}
          />
        )}
        {chosen ? (
          // A chosen supplier is a filter that is ON — a solid pill with its own
          // way off, the height of the chips beside it (the picker's chosen-card
          // is built for a form and stands twice as tall).
          <span className="pill is-on order-first col-span-2 h-[34px] max-w-full justify-between gap-1.5 pr-1.5 sm:order-none sm:justify-start">
            <span className="truncate">ผู้ขาย: {chosen.name}</span>
            <button type="button" aria-label="ดูทุกผู้ขาย" onClick={() => go({ supplier: "" })} className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-white/15">
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </span>
        ) : (
          <div className="order-first col-span-2 sm:order-none sm:w-64 [&>div]:mt-0 [&_input]:!h-[34px] [&_input]:rounded-[10px] [&_input]:py-0 [&_input]:text-[13px]">
            <ProductPicker
              products={suppliers}
              value=""
              onChange={(supplier) => go({ supplier })}
              thumbs={false}
              placeholder="ผู้ขายทั้งหมด — พิมพ์เพื่อค้นหา"
            />
          </div>
        )}
        <SelectChip
          size="sm"
          className="w-full sm:w-36"
          value={value.source}
          options={[{ value: "", label: "ทุกที่มา" }, ...sources]}
          onChange={(source) => go({ source })}
          selectProps={{ "aria-label": "ที่มา" }}
        />
        <SelectChip
          size="sm"
          className="w-full sm:w-36"
          value={value.status}
          options={[{ value: "", label: "ทุกสถานะการจ่าย" }, ...statuses]}
          onChange={(status) => go({ status })}
          selectProps={{ "aria-label": "การจ่ายเงิน" }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="ช่วงวันที่บิล">
          <button type="button" aria-pressed={!value.from && !value.to} className={seg(!value.from && !value.to)} onClick={() => (setShowDates(false), go({ from: "", to: "" }))}>
            ทุกเดือน
          </button>
          <button type="button" aria-pressed={isThisMonth} className={seg(isThisMonth)} onClick={() => (setShowDates(false), go(thisMonth))}>
            เดือนนี้
          </button>
          {/* One month out of twelve: a native select laid over the segment, so a
              phone opens its own wheel (the SelectChip trick). */}
          <span className={`${seg(!!month && !isThisMonth)} relative gap-1`}>
            {month && !isThisMonth ? month.label : "เลือกเดือน"}
            <svg aria-hidden viewBox="0 0 10 6" className="h-1.5 w-2.5">
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <select
              aria-label="เลือกเดือน"
              value={month && !isThisMonth ? month.key : ""}
              onChange={(e) => {
                const m = months.find((x) => x.key === e.target.value);
                if (m) (setShowDates(false), go({ from: m.from, to: m.to }));
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              <option value="" disabled>
                เลือกเดือน
              </option>
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </span>
          <button type="button" aria-pressed={custom || showDates} className={seg(custom || showDates)} onClick={() => setShowDates(true)}>
            เลือกวันที่
          </button>
        </div>

        {(showDates || custom) && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="date"
              aria-label="ตั้งแต่วันที่"
              className="input !h-[34px] w-[9.5rem] rounded-[10px] py-0 text-[13px]"
              defaultValue={value.from}
              max={value.to || undefined}
              onChange={(e) => go({ from: e.target.value })}
            />
            ถึง
            <input
              type="date"
              aria-label="ถึงวันที่"
              className="input !h-[34px] w-[9.5rem] rounded-[10px] py-0 text-[13px]"
              defaultValue={value.to}
              min={value.from || undefined}
              onChange={(e) => go({ to: e.target.value })}
            />
          </span>
        )}

        {pending && <span className="text-xs text-muted-foreground">กำลังโหลด…</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}
