"use client";

// Sprint 1 Part 5, Step 7.2 — shared create + edit form (CORE).
// Driven by React 19 useActionState against the "use server" actions.
// Input `name=` attributes are snake_case to match rawFromFormData in
// src/app/suppliers/actions.ts; fieldErrors keys are camelCase schema names.

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupplierActionState } from "@/app/suppliers/actions";
import { SUPPLIER_FIELD_LABELS_TH } from "@/lib/validations/supplier";
import type { SupplierView } from "./supplier-view";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

function TextField({
  name,
  label,
  type = "text",
  step,
  defaultValue,
  error,
  required,
}: {
  name: string;
  label: string;
  type?: string;
  step?: string;
  defaultValue?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        className={inputClass}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default function SupplierForm({
  action,
  initial,
  submitLabel,
}: {
  action: (
    prev: SupplierActionState,
    fd: FormData
  ) => Promise<SupplierActionState>;
  initial?: SupplierView;
  submitLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as SupplierActionState
  );

  // On success the action returns ok:true → leave the form for the list (Q7).
  useEffect(() => {
    if (state.ok) router.push("/suppliers");
  }, [state, router]);

  // Mirror the two tax checkboxes into state so the matching rate field can be
  // shown only when relevant (progressive disclosure, Q4). The inputs stay
  // uncontrolled — onChange just tracks visibility; superRefine enforces
  // "rate required when toggle on" server-side.
  const [isVatRegistered, setIsVatRegistered] = useState(
    initial?.isVatRegistered ?? false
  );
  const [subjectToWht, setSubjectToWht] = useState(
    initial?.defaultSubjectToWht ?? false
  );

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const L = SUPPLIER_FIELD_LABELS_TH;
  const err = (key: string) => fieldErrors?.[key];

  return (
    <form action={formAction} className="space-y-6">
      {formError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {formError}
        </div>
      )}

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h3 className="font-medium">ข้อมูลพื้นฐาน</h3>
        <TextField
          name="code"
          label={L.code}
          defaultValue={initial?.code ?? ""}
          error={err("code")}
        />
        <TextField
          name="name_full"
          label={L.nameFull}
          required
          defaultValue={initial?.nameFull ?? ""}
          error={err("nameFull")}
        />
        <TextField
          name="name_short"
          label={L.nameShort}
          defaultValue={initial?.nameShort ?? ""}
          error={err("nameShort")}
        />
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={initial?.isActive ?? true}
          />
          <span className="text-sm font-medium">{L.isActive}</span>
        </label>
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h3 className="font-medium">ข้อมูลติดต่อ</h3>
        <TextField
          name="contact_name"
          label={L.contactName}
          defaultValue={initial?.contactName ?? ""}
          error={err("contactName")}
        />
        <TextField
          name="contact_phone"
          label={L.contactPhone}
          defaultValue={initial?.contactPhone ?? ""}
          error={err("contactPhone")}
        />
        <TextField
          name="contact_email"
          label={L.contactEmail}
          type="email"
          defaultValue={initial?.contactEmail ?? ""}
          error={err("contactEmail")}
        />
        <TextField
          name="line_id"
          label={L.lineId}
          defaultValue={initial?.lineId ?? ""}
          error={err("lineId")}
        />
        <div>
          <label htmlFor="address" className="mb-1 block text-sm font-medium">
            {L.address}
          </label>
          <textarea
            id="address"
            name="address"
            rows={2}
            defaultValue={initial?.address ?? ""}
            className={inputClass}
          />
          {err("address") && (
            <p className="mt-1 text-sm text-red-600">{err("address")}</p>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h3 className="font-medium">ภาษี</h3>
        <TextField
          name="tax_id"
          label={L.taxId}
          defaultValue={initial?.taxId ?? ""}
          error={err("taxId")}
        />
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="is_vat_registered"
            defaultChecked={isVatRegistered}
            onChange={(e) => setIsVatRegistered(e.target.checked)}
          />
          <span className="text-sm font-medium">{L.isVatRegistered}</span>
        </label>
        {isVatRegistered && (
          <TextField
            name="default_vat_rate_percent"
            label={L.defaultVatRatePercent}
            type="number"
            step="0.01"
            defaultValue={initial?.defaultVatRatePercent ?? ""}
            error={err("defaultVatRatePercent")}
          />
        )}
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="default_subject_to_wht"
            defaultChecked={subjectToWht}
            onChange={(e) => setSubjectToWht(e.target.checked)}
          />
          <span className="text-sm font-medium">{L.defaultSubjectToWht}</span>
        </label>
        {subjectToWht && (
          <TextField
            name="default_wht_rate_percent"
            label={L.defaultWhtRatePercent}
            type="number"
            step="0.01"
            defaultValue={initial?.defaultWhtRatePercent ?? ""}
            error={err("defaultWhtRatePercent")}
          />
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h3 className="font-medium">อื่นๆ</h3>
        <TextField
          name="payment_terms"
          label={L.paymentTerms}
          defaultValue={initial?.paymentTerms ?? ""}
          error={err("paymentTerms")}
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-6 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก..." : submitLabel}
        </button>
        <a
          href="/suppliers"
          className="rounded-lg border border-border px-6 py-2 text-sm hover:bg-muted/40"
        >
          ยกเลิก
        </a>
      </div>
    </form>
  );
}
