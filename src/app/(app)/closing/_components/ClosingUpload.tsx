"use client";

// ปิดร้าน · ขั้นที่ 5 — upload the day's POS file (Kong 2026-10-25, mockup
// PHz9opV1HU4cggwmy1kVtS). After the till total is saved on purpose: the keyed
// figure is what catches a file exported for only part of the day (ADR 0020),
// and a file that lands first would lock that figure to itself.
//
// Reuses the import's own preview → commit actions, so this is the same import
// with the same checks — only picked for the branch and said in plain words.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import FileDrop from "@/components/ui/FileDrop";
import { commitSalesImportAction, previewSalesImportAction, type SalesImportCommitState, type SalesImportPreviewState } from "@/app/(app)/sales/actions";

const newBatchId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

export default function ClosingUpload({
  profiles,
  businessDate,
  pulseSaved,
  pulseLocked,
}: {
  profiles: { id: string; label: string }[];
  businessDate: string;
  /** The till total for this day is saved (or a file already locked it). */
  pulseSaved: boolean;
  pulseLocked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState(newBatchId);
  const [preview, setPreview] = useState<SalesImportPreviewState | null>(null);
  const [result, setResult] = useState<SalesImportCommitState | null>(null);

  if (profiles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        สาขานี้ยังไม่ได้ตั้งรูปแบบไฟล์ POS —{" "}
        <a href="/sales/import/profiles/new" className="text-primary underline">
          ตั้งค่ารูปแบบไฟล์
        </a>{" "}
        (ครั้งเดียว)
      </p>
    );
  }

  const choose = (f: File) => {
    setFile(f);
    setResult(null);
    const fd = new FormData();
    fd.set("file", f);
    fd.set("batchId", batchId);
    fd.set("profileId", profileId);
    start(async () => setPreview(await orStale(previewSalesImportAction(null, fd))));
  };

  const p = preview?.ok ? preview.preview : null;
  const coversToday = p ? p.coveredFrom <= businessDate && businessDate <= p.coveredTo : false;
  const warnToday = p?.pulseWarnings.find((w) => w.businessDate === businessDate) ?? null;

  const commit = () => {
    if (!file || !p) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("batchId", p.batchId);
    fd.set("acknowledgedReplacedDays", String(p.acknowledgedReplacedDays));
    fd.set("acknowledgedNewMenus", String(p.acknowledgedNewMenus));
    fd.set("acknowledgedNewCategories", String(p.acknowledgedNewCategories));
    start(async () => {
      const r = await orStale(commitSalesImportAction(null, fd));
      setResult(r);
      if (r.ok) {
        setPreview(null);
        setFile(null);
        setBatchId(newBatchId());
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      {profiles.length > 1 && (
        <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="input w-full text-sm" aria-label="รูปแบบไฟล์">
          {profiles.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      )}
      <FileDrop
        accept=".csv,.txt"
        disabled={!pulseSaved || pending}
        fileName={file?.name ?? null}
        hint={pulseSaved ? `ไฟล์จากหลังบ้าน POS · ${profiles.find((x) => x.id === profileId)?.label ?? ""}` : "บันทึกยอดรวมจาก POS ก่อน แล้วอัปโหลดไฟล์ได้"}
        onFile={choose}
      />
      {pending && <p className="text-xs text-muted-subtle">กำลังตรวจไฟล์…</p>}
      {preview && !preview.ok && (
        <p className="rounded-xl border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {preview.formError ?? Object.values(preview.fieldErrors ?? {})[0] ?? "ไฟล์นี้นำเข้าไม่ได้"}
        </p>
      )}
      {p && (
        <div className="space-y-2 rounded-2xl border border-border bg-surface p-3 text-sm">
          <p>
            ไฟล์ครอบ <b>{p.coveredLabel}</b> · {p.rowCount.toLocaleString("th-TH")} แถว
            {p.replacedDays.length > 0 && ` · เข้าแทนข้อมูลเดิม ${p.replacedDays.length} วัน`}
            {p.newMenus.length > 0 && ` · เมนูใหม่ ${p.newMenus.length} รายการ (รอผู้จัดการตรวจ)`}
          </p>
          {!coversToday && <p className="text-warn">ไฟล์นี้ไม่มีวันที่ของใบนี้ — ตรวจว่าเลือกช่วงวันที่ตอน export ถูกไหม</p>}
          {warnToday ? (
            <div className="rounded-lg bg-bad-bg p-2.5 text-bad">
              <b>⚠ {warnToday.warning}</b>
              <span className="block text-xs">มักแปลว่า export มาไม่ครบทั้งวัน — export ใหม่แล้วอัปโหลดทับได้เลย (หรือกดนำเข้าต่อถ้ามั่นใจ)</span>
            </div>
          ) : (
            coversToday && pulseSaved && !pulseLocked && <p className="rounded-lg bg-good-bg p-2.5 text-good">✓ ยอดในไฟล์ตรงกับยอดที่คีย์</p>
          )}
          {p.consistencyWarning && <p className="text-xs text-warn">{p.consistencyWarning}</p>}
          <button type="button" onClick={commit} disabled={pending} className="btn w-full">
            {pending ? "กำลังนำเข้า…" : "นำเข้าไฟล์นี้"}
          </button>
        </div>
      )}
      {result?.ok && (
        <p className="rounded-xl bg-good-bg p-3 text-sm text-good">
          ✓ นำเข้าแล้ว {result.rowsWritten.toLocaleString("th-TH")} แถว
          {result.autoPost && result.autoPost.postedFull + result.autoPost.postedPartial > 0 && " · ตัดสต๊อกตามสูตรให้แล้ว"}
          {result.autoPost && result.autoPost.postedPartial > 0 && ` (${result.autoPost.skippedMenus} เมนูยังไม่มีสูตร)`}
        </p>
      )}
      {result && !result.ok && <p className="rounded-xl border border-bad-border bg-bad-bg p-3 text-sm text-bad">{result.formError ?? "นำเข้าไม่สำเร็จ"}</p>}
      <p className="text-xs text-muted-subtle">ยังไม่ได้ export ก็ข้ามได้ — หัวหน้าเห็นว่าวันไหนไฟล์ยังไม่เข้า</p>
    </div>
  );
}
