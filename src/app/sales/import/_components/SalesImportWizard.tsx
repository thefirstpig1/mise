"use client";

// Sprint 4 Part 19 L5 — the import screen (ADR 0019 Q5, Q8, Section D.4).
//
// Two steps, and the second one is the point of the whole Part: nothing is
// written until a person has read what would happen.
//
//   1. Pick a file shape, pick a file, press ตรวจไฟล์. Nothing is written except
//      the record of the attempt.
//   2. Read what would happen — which days get replaced and what they currently
//      hold, which dishes are new, which categories are new — then confirm.
//
// **The file is held in this component and posted twice.** There is no object
// storage yet, so the preview cannot keep the bytes it parsed between two
// requests (L3c). The `<input type="file">` keeps the File, and the confirm step
// builds its own FormData from the same one. If the user swaps the file between
// steps, the second parse produces different counts and the server refuses —
// which is why the acknowledged counts travel with the confirm.
//
// The rejection list is the other half. A shop is the only party who can fix a
// file, and "import failed" tells them nothing, so every row error is shown with
// its Excel row number and the column that went wrong.

import { useRef, useState, useTransition } from "react";
import {
  commitSalesImportAction,
  previewSalesImportAction,
  type SalesImportCommitState,
  type SalesImportPreviewState,
} from "@/app/sales/actions";
import type { ImportPreviewView } from "@/app/sales/_components/sales-view";

export type ImportProfileOption = {
  id: string;
  name: string;
  branchName: string;
  posName: string;
  fileKindLabel: string;
  encodingLabel: string;
};

const secondaryButtonClass =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50";

/** A UUID minted in the browser, because the batch id is the submit key. */
function newBatchId(): string {
  return crypto.randomUUID();
}

const baht = (v: string) =>
  Number(v).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SalesImportWizard({
  profiles,
}: {
  profiles: ImportProfileOption[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [batchId, setBatchId] = useState(newBatchId);
  const [previewState, setPreviewState] = useState<SalesImportPreviewState | null>(null);
  const [commitState, setCommitState] = useState<SalesImportCommitState | null>(null);
  const [pending, startTransition] = useTransition();

  const preview: ImportPreviewView | null =
    previewState?.ok === true ? previewState.preview : null;

  const runPreview = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setPreviewState({ ok: false, fieldErrors: { file: "ยังไม่ได้เลือกไฟล์" } });
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("batchId", batchId);
    fd.set("profileId", profileId);
    setCommitState(null);
    startTransition(async () => {
      setPreviewState(await previewSalesImportAction(null, fd));
    });
  };

  const runCommit = () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !preview) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("batchId", preview.batchId);
    fd.set("acknowledgedReplacedDays", String(preview.acknowledgedReplacedDays));
    fd.set("acknowledgedNewMenus", String(preview.acknowledgedNewMenus));
    fd.set("acknowledgedNewCategories", String(preview.acknowledgedNewCategories));
    startTransition(async () => {
      const result = await commitSalesImportAction(null, fd);
      setCommitState(result);
      if (result.ok) {
        // A committed batch id can never be reused, and the file has been
        // consumed — start clean rather than leaving a screen that looks armed.
        setPreviewState(null);
        setBatchId(newBatchId());
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  if (profiles.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm">
        <p className="font-medium">ยังไม่ได้ตั้งค่ารูปแบบไฟล์</p>
        <p className="mt-2 text-muted-foreground">
          ก่อนนำเข้ายอดขายครั้งแรก ต้องบอกระบบก่อนว่าไฟล์จาก POS ของคุณ
          คอลัมน์ไหนคืออะไร ทำครั้งเดียว ครั้งต่อไประบบจำได้เอง
        </p>
        <a href="/sales/import/profiles/new" className={"btn mt-4 inline-block"}>
          ตั้งค่ารูปแบบไฟล์
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {commitState?.ok && (
        <div className="rounded-lg border border-primary bg-primary/5 p-4 text-sm">
          <p className="font-medium">นำเข้าเรียบร้อย</p>
          <p className="mt-1 text-muted-foreground">
            บันทึก {commitState.rowsWritten.toLocaleString("th-TH")} รายการ ·
            เพิ่มวันใหม่ {commitState.daysAdded} วัน ·
            แทนที่วันเดิม {commitState.daysReplaced} วัน
            {commitState.stubMenusCreated > 0 && (
              <>
                {" · "}
                <a href="/menus?stubs=true" className="text-primary underline">
                  เมนูรอตรวจใหม่ {commitState.stubMenusCreated} รายการ
                </a>
              </>
            )}
          </p>

          {/*
            Part 22 (rule N6). A re-import takes back the stock those days had
            already consumed, inside the same transaction — the ledger is never
            knowingly wrong. Saying so is not optional: a week of stock quietly
            returning is the most expensive kind of invisible.
          */}
          {commitState.consumptionRunsVoided > 0 && (
            <p className="mt-2 rounded border border-warn-border bg-warn-bg p-2 text-xs text-warn">
              {commitState.consumptionRunsVoided} วันเคยตัดสต๊อกตามสูตรไว้แล้ว —
              ระบบยกเลิกการตัดของวันเหล่านั้นให้แล้ว เพราะยอดขายเดิมถูกแทนที่ ·
              วัตถุดิบกลับเข้าสต๊อกตามมูลค่าเดิมที่มันออกไป
            </p>
          )}

          <p className="mt-2 text-xs">
            ยอดขายที่นำเข้ายัง<strong>ไม่ทำให้สต๊อกลดลง</strong> จนกว่าจะกดตัด —{" "}
            <a href="/consumption" className="text-primary underline">
              ไปตัดสต๊อกตามสูตร
            </a>
          </p>
        </div>
      )}

      {/* ---------- step 1 ---------- */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">1. เลือกไฟล์</h2>

        <label className="mt-4 block text-sm">
          รูปแบบไฟล์
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className={"input w-full mt-1"}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.branchName} · {p.name} ({p.fileKindLabel})
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block text-sm">
          ไฟล์จาก POS
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className={"input w-full mt-1"}
            onChange={() => {
              setPreviewState(null);
              setCommitState(null);
            }}
          />
        </label>
        {previewState?.ok === false && previewState.fieldErrors?.file && (
          <p className="mt-1 text-xs text-bad">{previewState.fieldErrors.file}</p>
        )}

        <button type="button" onClick={runPreview} disabled={pending} className={"btn mt-4"}>
          {pending ? "กำลังตรวจ…" : "ตรวจไฟล์"}
        </button>
      </section>

      {/* ---------- rejection ---------- */}
      {previewState?.ok === false && (previewState.formError || previewState.rowErrors) && (
        <section className="rounded-lg border border-bad-border bg-bad-bg p-4">
          <p className="text-sm font-medium">{previewState.formError ?? "ไฟล์นี้ยังนำเข้าไม่ได้"}</p>
          {previewState.rowErrors && previewState.rowErrors.length > 0 && (
            <>
              <ul className="mt-3 space-y-1 text-xs">
                {previewState.rowErrors.map((e, i) => (
                  <li key={`${e.rowNumber}-${i}`}>
                    <span className="font-medium">{e.locationLabel}</span>
                    <span className="text-muted-foreground"> — {e.message}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                ระบบไม่นำเข้าไฟล์แบบครึ่ง ๆ กลาง ๆ — แก้ให้ครบแล้วอัปโหลดใหม่
                เพราะยอดขายที่หายไปครึ่งวันจะไม่มีอะไรบนหน้าจอดูผิดเลย
              </p>
            </>
          )}
        </section>
      )}

      {/* ---------- step 2 ---------- */}
      {preview && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">2. ตรวจก่อนบันทึก</h2>

          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">ช่วงวันที่</dt>
              <dd className="font-medium">{preview.coveredLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">จำนวนรายการ</dt>
              <dd className="font-medium">{preview.rowCount.toLocaleString("th-TH")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">ยอดขายรวม</dt>
              <dd className="font-medium">฿{baht(preview.totalNet)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">วันใหม่</dt>
              <dd className="font-medium">{preview.newDayCount}</dd>
            </div>
          </dl>

          {preview.blankRowNotice && (
            <p className="mt-3 text-xs text-muted-foreground">{preview.blankRowNotice}</p>
          )}

          {preview.consistencyWarning && (
            <div className="mt-4 rounded-lg border border-warn/50 bg-warn/5 p-3 text-xs">
              {preview.consistencyWarning}
            </div>
          )}

          {preview.pulseWarnings.length > 0 && (
            <div className="mt-4 rounded-lg border border-bad/60 bg-bad/5 p-3">
              <p className="text-sm font-medium">
                ไฟล์นี้ไม่ตรงกับยอดที่คีย์ไว้ตอนปิดร้าน {preview.pulseWarnings.length} วัน
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {preview.pulseWarnings.map((w) => (
                  <li key={w.businessDate}>{w.warning}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                นำเข้าต่อได้ ระบบไม่บล็อก — แต่นี่เป็นจุดเดียวที่จับได้ว่าไฟล์
                export มาไม่ครบทั้งวัน เพราะไฟล์แบบนั้นทุกแถวถูกต้องหมด
                ไม่มีอะไรในไฟล์บอกว่ามันขาด
              </p>
            </div>
          )}

          {preview.retiredSelling.length > 0 && (
            // ADR 0027 Q3. WARNS, never blocks — the sale is real: sales_line
            // will be written and Part 22 will deduct stock from it, exactly
            // as Q2 requires. The only thing wrong is the flag, and it is
            // wrong in the POS rather than here.
            <div className="mt-4 rounded-lg border border-warn/50 bg-warn/5 p-3">
              <p className="text-sm font-medium">
                ไฟล์นี้มียอดขายของเมนูที่ทำเครื่องหมายเลิกขายไว้{" "}
                {preview.retiredSelling.length} รายการ
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {preview.retiredSelling.map((m) => (
                  <li key={m.menuId}>{m.label}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                นำเข้าต่อได้ ระบบไม่บล็อก — ยอดขายเข้าตามปกติและตัดสต๊อกตามปกติ
                ถ้าเลิกขายจริงแล้ว ต้องเอาออกจาก POS ด้วย ถ้ายังขายอยู่
                ให้กด “กลับมาขาย” ที่หน้าเมนู
              </p>
            </div>
          )}

          {preview.replacedDays.length > 0 && (
            <div className="mt-4 rounded-lg border border-warn/50 bg-warn/5 p-3">
              <p className="text-sm font-medium">
                จะแทนที่ข้อมูลเดิม {preview.replacedDays.length} วัน
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {preview.replacedDays.map((d) => (
                  <li key={d.businessDate}>{d.warning}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                ข้อมูลเดิมไม่ได้ถูกลบ แต่จะถูกทำเครื่องหมายว่าถูกแทนที่ และไม่นับในยอดขายอีก
              </p>
            </div>
          )}

          {preview.newMenus.length > 0 && (
            <div className="mt-4 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">
                พบเมนูใหม่ {preview.newMenus.length} รายการ — จะถูกสร้างเป็น “เมนูรอตรวจ”
              </p>
              <ul className="mt-2 space-y-2 text-xs">
                {preview.newMenus.slice(0, 20).map((m) => (
                  <li key={m.key}>
                    <span className="font-medium">{m.label}</span>
                    {m.suggestions.length > 0 && (
                      <span className="text-muted-foreground">
                        {" "}
                        — ใกล้เคียงกับ{" "}
                        {m.suggestions
                          .slice(0, 3)
                          .map((s) => `${s.name} (${s.badge})`)
                          .join(" · ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {preview.newMenus.length > 20 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  และอีก {preview.newMenus.length - 20} รายการ
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                ยอดขายจะถูกบันทึกครบทันที แล้วค่อยไปจับคู่เมนูทีหลังที่หน้า “เมนู”
              </p>
            </div>
          )}

          {preview.newCategories.length > 0 && (
            <div className="mt-4 rounded-lg border border-border p-3 text-xs">
              <span className="font-medium">หมวดเมนูใหม่ {preview.newCategories.length} หมวด: </span>
              {preview.newCategories.join(" · ")}
            </div>
          )}

          {commitState?.ok === false && commitState.formError && (
            <p className="mt-4 text-sm text-bad">{commitState.formError}</p>
          )}

          <div className="mt-4 flex gap-2">
            <button type="button" onClick={runCommit} disabled={pending} className="btn">
              {pending ? "กำลังบันทึก…" : "ยืนยันนำเข้า"}
            </button>
            <button
              type="button"
              onClick={() => setPreviewState(null)}
              disabled={pending}
              className={secondaryButtonClass}
            >
              ยกเลิก
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
