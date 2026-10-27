"use client";

// ============================================================
// Mise — VAT, withholding and payment method as chips (expense review 2026-10-27)
// ============================================================
// A bill has very few real answers here — ไม่มี VAT / 7% รวมแล้ว / 7% บวกเพิ่ม,
// and withholding at 1 / 2 / 3 / 5 % — so a typed number box and a checkbox
// asked more of the person than the paper in their hand does. Shared by the
// bill form and the recurring form so both say it the same way.
//
// Each group posts the SAME field names the old inputs did (the actions are
// untouched), and a stored value outside the chips (an old bill typed at 10%,
// a method typed as "พร้อมเพย์") is shown as its own chosen chip rather than
// silently dropped.
// ============================================================

import { PAYMENT_METHODS } from "@/lib/expense-labels";

const chipCls = (on: boolean, disabled?: boolean) =>
  `inline-flex h-10 items-center whitespace-nowrap rounded-full border px-4 text-sm transition-colors ${
    on
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border-strong bg-surface hover:border-primary-line"
  } ${disabled ? "cursor-default opacity-60" : ""}`;

export function Chips<T extends string>({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="mt-1 flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={chipCls(o.value === value, disabled)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const STANDARD_VAT = "7";
const sameRate = (a: string, b: string) => Number(a) === Number(b);

/** "" = no VAT. Posts vat_rate_percent + is_price_vat_inclusive like the old inputs. */
export function VatChips({
  rate,
  inclusive,
  onChange,
  disabled,
}: {
  rate: string;
  inclusive: boolean;
  onChange: (rate: string, inclusive: boolean) => void;
  disabled?: boolean;
}) {
  const hasRate = rate.trim() !== "" && Number(rate) > 0;
  const odd = hasRate && !sameRate(rate, STANDARD_VAT) ? rate : null;
  const shown = odd ?? STANDARD_VAT;
  const key = !hasRate ? "none" : inclusive ? "incl" : "excl";
  const options = [
    { value: "none", label: "ไม่มี VAT" },
    { value: "incl", label: `${shown}% รวมในราคาแล้ว` },
    { value: "excl", label: `${shown}% บวกเพิ่ม` },
  ];
  return (
    <>
      <Chips
        label="VAT"
        options={options}
        value={key}
        disabled={disabled}
        onChange={(v) =>
          v === "none" ? onChange("", inclusive) : onChange(shown, v === "incl")
        }
      />
      <input type="hidden" name="vat_rate_percent" value={hasRate ? rate : ""} />
      {/* The action reads "on" as inclusive and absence as exclusive. */}
      {inclusive && <input type="hidden" name="is_price_vat_inclusive" value="on" />}
    </>
  );
}

const WHT_RATES = ["1", "2", "3", "5"];

/** "" = not withheld. Posts subject_to_wht + wht_rate_percent. */
export function WhtChips({
  rate,
  onChange,
  disabled,
}: {
  rate: string;
  onChange: (rate: string) => void;
  disabled?: boolean;
}) {
  const on = rate.trim() !== "" && Number(rate) > 0;
  const rates = on && !WHT_RATES.some((r) => sameRate(r, rate)) ? [...WHT_RATES, rate] : WHT_RATES;
  const value = on ? (rates.find((r) => sameRate(r, rate)) ?? rate) : "none";
  return (
    <>
      <Chips
        label="หักภาษี ณ ที่จ่าย"
        options={[{ value: "none", label: "ไม่หัก" }, ...rates.map((r) => ({ value: r, label: `${Number(r)}%` }))]}
        value={value}
        disabled={disabled}
        onChange={(v) => onChange(v === "none" ? "" : v)}
      />
      {on && <input type="hidden" name="subject_to_wht" value="on" />}
      <input type="hidden" name="wht_rate_percent" value={on ? rate : ""} />
    </>
  );
}

/** เงินสด / โอน / บัตร. Posts payment_method; "" = not said. */
export function MethodChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = (PAYMENT_METHODS as readonly string[]).includes(value);
  const options = [
    ...PAYMENT_METHODS.map((m) => ({ value: m as string, label: m as string })),
    ...(value && !known ? [{ value, label: value }] : []),
  ];
  return (
    <>
      <Chips
        label="จ่ายด้วย"
        options={options}
        value={value}
        // Pressing the chosen one again un-chooses it — a method is optional.
        onChange={(v) => onChange(v === value ? "" : v)}
      />
      <input type="hidden" name="payment_method" value={value} />
    </>
  );
}
