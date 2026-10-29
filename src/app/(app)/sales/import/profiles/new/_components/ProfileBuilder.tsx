"use client";

// Sprint 4 Part 19 L5 — the profile builder (ADR 0019 Q11).
//
// This screen is the answer to "every POS formats its columns differently". The
// shop uploads one real file, sees its actual header and its actual first rows,
// and says which column is what. Mise stores the mapping AND a fingerprint of
// the header, so every later file of the same shape imports without a question —
// and a file whose header has changed is stopped rather than read one column
// across (rule P11).
//
// Two questions on this form are not conveniences, and neither has a default:
//
//   * **ตัวเลขในไฟล์รวม VAT แล้วหรือยัง**
//   * **รวม Service charge แล้วหรือยัง**
//
// Getting either wrong is a silent 7% or 10% error on every row of every file
// this profile ever reads (rule P10). HTML omits unchecked boxes entirely, so
// they are radio buttons with no preselection: an unanswered question must not
// arrive looking like "no".

import { useActionState, useEffect, useState } from "react";
import FileDrop from "@/components/ui/FileDrop";
import { suggestColumnMap } from "@/lib/sales-column-suggest";
import {
  createSalesImportProfileAction,
  inspectSalesFileAction,
  type InspectFileState,
  type ProfileActionState,
} from "@/app/(app)/sales/actions";
import {
  COLUMN_MAP_FIELDS,
  FILE_ENCODING_LABELS_TH,
  FILE_ENCODING_VALUES,
  SALES_CHANNEL_LABELS_TH,
  SALES_CHANNEL_VALUES,
  SALES_FILE_KIND_LABELS_TH,
  SALES_FILE_KIND_VALUES,
  type ColumnMapField,
} from "@/lib/validations/sales-import";
import { SALES_DATE_FORMATS } from "@/lib/sales-file";
import { useKeepForm } from "@/lib/keep-form";
import SalesImportWizard, { type ImportProfileOption } from "@/app/(app)/sales/import/_components/SalesImportWizard";

export type PosOption = { id: string; label: string };


/** Thai for each mappable field, and whether the profile cannot do without it. */
const FIELD_LABELS_TH: Record<ColumnMapField, { label: string; required?: boolean }> = {
  businessDate: { label: "วันที่ขาย" },
  soldAt: { label: "วันเวลาขาย (ถ้ามี)" },
  menuName: { label: "ชื่อเมนู" },
  menuCode: { label: "รหัสเมนู" },
  categoryName: { label: "หมวดเมนู" },
  qty: { label: "จำนวน", required: true },
  grossAmount: { label: "ยอดก่อนหักส่วนลด" },
  discountAmount: { label: "ส่วนลด" },
  netAmount: { label: "ยอดสุทธิ", required: true },
  serviceChargeAmount: { label: "Service charge" },
  vatAmount: { label: "VAT" },
  channel: { label: "ช่องทางขาย" },
  billId: { label: "เลขบิล" },
};

/** The 4-digit year in a sample date says which calendar the file uses. */
function yearHint(sample: string | undefined): string | null {
  const y = sample?.match(/(?<!\d)(\d{4})(?!\d)/)?.[1];
  if (!y) return null;
  const n = Number(y);
  if (n >= 2400 && n <= 2700) return `ตัวอย่างในไฟล์ “${sample}” — ปี ${y} เป็น พ.ศ.`;
  if (n >= 1900 && n <= 2200) return `ตัวอย่างในไฟล์ “${sample}” — ปี ${y} เป็น ค.ศ.`;
  return null;
}

export default function ProfileBuilder({ posOptions, shopVatRegistered }: { posOptions: PosOption[]; shopVatRegistered: boolean }) {
  const [inspectState, inspectAction, inspecting] = useActionState<InspectFileState | null, FormData>(
    inspectSalesFileAction,
    null
  );
  const [saveState, saveAction, saving] = useActionState<ProfileActionState | null, FormData>(
    createSalesImportProfileAction,
    null
  );
  // What was submitted, so a saved profile can import the sample straight away.
  const [submitted, setSubmitted] = useState<Omit<ImportProfileOption, "id"> | null>(null);
  const saveActionKeep = useKeepForm((fd) => {
    const [branchName, ...pos] = (posOptions.find((p) => p.id === fd.get("posIntegrationId"))?.label ?? "").split(" · ");
    const kind = String(fd.get("fileKind") ?? "") as (typeof SALES_FILE_KIND_VALUES)[number];
    setSubmitted({
      name: String(fd.get("name") ?? ""),
      branchName,
      posName: pos.join(" · "),
      fileKindLabel: SALES_FILE_KIND_LABELS_TH[kind] ?? "",
      encodingLabel: FILE_ENCODING_LABELS_TH[String(fd.get("encoding")) as (typeof FILE_ENCODING_VALUES)[number]] ?? "",
    });
    saveAction(fd);
  }, saveState);
  // The sample file lives in state: FileDrop's own input carries no name (Thai picker, Kong 2026-10-25).
  const [sample, setSample] = useState<File | null>(null);
  const inspectKeep = useKeepForm((fd) => {
    if (sample) fd.set("file", sample);
    inspectAction(fd);
  }, inspectState);
  const [columnMap, setColumnMap] = useState<Partial<Record<ColumnMapField, number>>>({});

  const header = inspectState?.ok ? inspectState.header : null;

  // A freshly read header starts from a careful guess (exact names only —
  // src/lib/sales-column-suggest.ts). Each guessed field says so until the
  // person touches it; a header that did not decode guesses nothing.
  const [guessed, setGuessed] = useState<Set<ColumnMapField>>(new Set());
  const [garbled, setGarbled] = useState(false);
  useEffect(() => {
    if (!header) return;
    const s = suggestColumnMap(header);
    setColumnMap(s.map);
    setGuessed(new Set(Object.keys(s.map) as ColumnMapField[]));
    setGarbled(s.garbled);
  }, [header]);

  const setField = (field: ColumnMapField, value: string) => {
    setGuessed((g) => {
      if (!g.has(field)) return g;
      const next = new Set(g);
      next.delete(field);
      return next;
    });
    setColumnMap((prev) => {
      const next = { ...prev };
      if (value === "") delete next[field];
      else next[field] = Number(value);
      return next;
    });
  };

  // A row is a bill when the file names its bills or times; otherwise it is a
  // day's summary. A starting point the person can change, not an answer.
  const inferredKind: (typeof SALES_FILE_KIND_VALUES)[number] =
    columnMap.billId !== undefined || columnMap.soldAt !== undefined ? "BILL_DETAIL" : "DAILY_SUMMARY";
  const [kindChosen, setKindChosen] = useState<string | null>(null);
  const dateSample =
    inspectState?.ok && columnMap.businessDate !== undefined ? inspectState.sampleRows[0]?.[columnMap.businessDate] : undefined;

  if (saveState?.ok) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-primary bg-primary/5 p-6 text-sm">
          <p className="font-medium">บันทึกรูปแบบไฟล์แล้ว</p>
          <p className="mt-2 text-muted-foreground">
            ครั้งต่อไปอัปไฟล์หน้าตาเดิม ระบบจะอ่านได้เองโดยไม่ถามอะไรอีก
            {sample && submitted ? " · ไฟล์ที่อัปไว้ด้านบนนำเข้าต่อได้เลยข้างล่าง ไม่ต้องเลือกไฟล์ใหม่" : ""}
          </p>
          {!(sample && submitted) && (
            <a href="/sales/import" className="btn mt-4">
              ไปหน้านำเข้ายอดขาย
            </a>
          )}
        </div>
        {sample && submitted && (
          <SalesImportWizard profiles={[{ id: saveState.profileId, ...submitted }]} initialFile={sample} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---------- 1. read a real file ---------- */}
      <form
        {...inspectKeep}
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 className="text-sm font-medium">1. อัปไฟล์ตัวอย่างจาก POS</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          ใช้ไฟล์จริงหนึ่งไฟล์ ระบบจะอ่านหัวตารางกับข้อมูลตัวอย่างมาให้จับคู่ — ไม่มีการบันทึกอะไร
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="text-sm">
            <p className="mb-1">ไฟล์</p>
            <FileDrop accept=".csv,text/csv,text/plain" fileName={sample?.name ?? null} hint="ไฟล์ .csv จากหลังบ้าน POS" onFile={setSample} />
          </div>
          <label className="block text-sm">
            การเข้ารหัสไฟล์
            <select name="encoding" defaultValue="UTF8" className={"input w-full mt-1"}>
              {FILE_ENCODING_VALUES.map((e) => (
                <option key={e} value={e}>
                  {FILE_ENCODING_LABELS_TH[e]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">
              ถ้าตัวอย่างข้างล่างเป็นภาษาไทยอ่านไม่ออก ให้ลองเปลี่ยนเป็น TIS-620
            </span>
          </label>
        </div>

        <button type="submit" disabled={inspecting} className={"btn mt-4"}>
          {inspecting ? "กำลังอ่าน…" : "อ่านหัวตาราง"}
        </button>
        {inspectState?.ok === false && (
          <p className="mt-2 text-sm text-bad">{inspectState.formError}</p>
        )}
      </form>

      {/* ---------- 2. map it ---------- */}
      {inspectState?.ok && header && (
        <form {...saveActionKeep} className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">2. จับคู่คอลัมน์</h2>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {header.map((h, i) => (
                    <th key={i} className="px-2 py-1 text-left font-medium">
                      {i + 1}. {h || "(ไม่มีชื่อ)"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                {inspectState.sampleRows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border/50">
                    {header.map((_, ci) => (
                      <td key={ci} className="whitespace-nowrap px-2 py-1">
                        {row[ci] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {garbled ? (
            <p className="mt-4 rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn">
              หัวตารางยังอ่านไม่ออก (ตัวอักษรเพี้ยน) ระบบจึงไม่เดาคอลัมน์ให้ — ลองเปลี่ยนการเข้ารหัสไฟล์เป็น TIS-620 แล้วกด “อ่านหัวตาราง” อีกครั้ง
            </p>
          ) : guessed.size > 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              ระบบเลือกให้ {guessed.size} ช่องจากชื่อหัวตารางที่ตรงกันพอดี — ตรวจกับตัวอย่างข้างบนก่อนบันทึก ช่องที่ชื่อกำกวมระบบไม่เดา
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {COLUMN_MAP_FIELDS.map((field) => (
              <label key={field} className="block text-sm">
                {FIELD_LABELS_TH[field].label}
                {FIELD_LABELS_TH[field].required && <span className="text-bad"> *</span>}
                <select
                  value={columnMap[field] ?? ""}
                  onChange={(e) => setField(field, e.target.value)}
                  className={"input w-full mt-1"}
                >
                  <option value="">— ไม่มีในไฟล์ —</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {h || "(ไม่มีชื่อ)"}
                    </option>
                  ))}
                </select>
                {guessed.has(field) && <span className="mt-1 block text-xs text-muted-foreground">ระบบเลือกให้ — ตรวจอีกครั้ง</span>}
              </label>
            ))}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            คอลัมน์ที่ “ไม่มีในไฟล์” จะถูกอ่านเป็น 0 — ต่างจากคอลัมน์ที่มีอยู่แต่เว้นว่าง
            ซึ่งระบบจะหยุดถาม ไม่เดาว่าเป็น 0
          </p>

          {/* ---------- 3. what the file means ---------- */}
          <h2 className="mt-6 text-sm font-medium">3. ไฟล์นี้หมายความว่าอะไร</h2>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              เครื่อง POS / สาขา
              <select name="posIntegrationId" className={"input w-full mt-1"}>
                {posOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              ชื่อรูปแบบไฟล์
              <input name="name" className={"input w-full mt-1"} placeholder="เช่น สรุปรายวัน FoodStory" />
            </label>

            <label className="block text-sm">
              หนึ่งแถวคืออะไร
              <select
                name="fileKind"
                value={kindChosen ?? inferredKind}
                onChange={(e) => setKindChosen(e.target.value)}
                className={"input w-full mt-1"}
              >
                {SALES_FILE_KIND_VALUES.map((k) => (
                  <option key={k} value={k}>
                    {SALES_FILE_KIND_LABELS_TH[k]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              รูปแบบวันที่ในไฟล์
              <select name="dateFormat" className={"input w-full mt-1"}>
                {SALES_DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              ช่องทางขายของไฟล์นี้
              <select name="defaultChannel" defaultValue="" className={"input w-full mt-1"}>
                <option value="">— ไม่ระบุ —</option>
                {SALES_CHANNEL_VALUES.map((c) => (
                  <option key={c} value={c}>
                    {SALES_CHANNEL_LABELS_TH[c]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">
                ใช้เมื่อทั้งไฟล์เป็นช่องทางเดียว เช่น ไฟล์ที่โหลดจาก Grab
              </span>
            </label>
          </div>

          {/* The three questions with no default (rule P10 / P13). */}
          <fieldset className="mt-4 rounded-lg border border-warn/50 bg-warn/5 p-3">
            <legend className="px-1 text-xs font-medium">
              สามข้อนี้ต้องตอบ — ตอบผิดแล้วตัวเลขจะเพี้ยนทุกแถวโดยไม่มีอะไรฟ้อง
            </legend>

            <RadioRow
              name="isBuddhistYear"
              question="ปีในไฟล์เป็นแบบไหน"
              yes="พ.ศ. (2568)"
              no="ค.ศ. (2025)"
              hint={yearHint(dateSample)}
            />
            <RadioRow
              name="amountsIncludeVat"
              question="ตัวเลขเงินในไฟล์ รวม VAT แล้วหรือยัง"
              yes="รวมแล้ว"
              no="ยังไม่รวม"
              hint={shopVatRegistered ? null : "ร้านยังไม่ได้จด VAT — ถ้า POS ไม่ได้บวก VAT ลงในราคา ให้ตอบ “ยังไม่รวม”"}
            />
            <RadioRow
              name="amountsIncludeServiceCharge"
              question="ตัวเลขเงินในไฟล์ รวม Service charge แล้วหรือยัง"
              yes="รวมแล้ว"
              no="ยังไม่รวม"
            />
          </fieldset>

          <input type="hidden" name="encoding" value={inspectState.suggestedEncoding} />
          <input type="hidden" name="headerSignature" value={inspectState.headerSignature} />
          <input type="hidden" name="columnMap" value={JSON.stringify(columnMap)} />

          {saveState?.ok === false && (
            <div className="mt-4 space-y-1 text-sm text-bad">
              {saveState.formError && <p>{saveState.formError}</p>}
              {saveState.fieldErrors &&
                Object.entries(saveState.fieldErrors).map(([k, v]) => <p key={k}>{v}</p>)}
            </div>
          )}

          <button type="submit" disabled={saving} className={"btn mt-4"}>
            {saving ? "กำลังบันทึก…" : "บันทึกรูปแบบไฟล์"}
          </button>
        </form>
      )}
    </div>
  );
}

/** A question with no preselected answer — "not answered" must not read as "no". */
function RadioRow({
  name,
  question,
  yes,
  no,
  hint = null,
}: {
  name: string;
  question: string;
  yes: string;
  no: string;
  /** Evidence to answer by — shown, never preselected (rule P10). */
  hint?: string | null;
}) {
  return (
    <div className="mt-3 text-sm">
      <p>{question}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-1 flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" name={name} value="true" /> {yes}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name={name} value="false" /> {no}
        </label>
      </div>
    </div>
  );
}
