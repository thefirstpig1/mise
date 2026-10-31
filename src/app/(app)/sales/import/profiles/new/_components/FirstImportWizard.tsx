"use client";

// ============================================================
// Mise — the first sales import, one question per page (Kong 2026-11-01)
// ============================================================
// Kong tried the old screen: "เลือก pos dropdown แล้วมันเลือกแล้วเลือกเลย แล้ว
// มีอะไรไม่รู้ พวก @ หรือ ผัดกะเพรา เข้ามาได้ยังไงก็ไม่รู้". The POS form saved
// the moment a brand was picked, the file showed up as a raw table nobody had
// introduced, and thirteen dropdowns asked about it. Mockup
// 225p68BDqKAZTpd9MqDeph, clicked through by Kong:
//
//   1 ยี่ห้อ POS          cards, per branch — a branch may run another brand
//   2 ไฟล์ตัวอย่าง        CSV or Excel; read at once, nothing saved
//   3 คอลัมน์ไหนคืออะไร   the file's own rows, every column labelled with
//                          what the system will read it as ("@" = ราคาต่อ
//                          หน่วย · ไม่ใช้); four questions, the rest folded
//   4 ตัวเลขในไฟล์        the date asked as what it READS as; VAT and
//                          service charge, with no answer preselected (P10)
//   5 ตรวจแล้วบันทึก      the real parser's read-back, day by day, then ONE
//                          save of the POS and the format together
//
// ‹ ย้อนกลับ works on every page until the save. After it, the existing
// import screen takes the same file straight to its preview and confirm, so
// the replace-a-day and new-menu acknowledgements still guard the commit.
// The arithmetic (date readings) lives in src/lib/sales-setup.ts; the parse
// and the save in src/server/sales-setup.ts.
// ============================================================

import { useMemo, useState, useTransition, type ReactNode } from "react";
import FileDrop from "@/components/ui/FileDrop";
import { orStale } from "@/lib/stale-tab";
import { suggestColumnMap } from "@/lib/sales-column-suggest";
import { readDateCandidates, tellingSample, thaiDateLabel } from "@/lib/sales-setup";
import { FILE_ENCODING_LABELS_TH, type ColumnMapField, type PosTypeValue } from "@/lib/validations/sales-import";
import {
  inspectSalesFileAction,
  setupSalesFileAction,
  trialReadSalesFileAction,
  type InspectFileState,
  type TrialReadState,
} from "@/app/(app)/sales/actions";
import SalesImportWizard from "@/app/(app)/sales/import/_components/SalesImportWizard";

export type WizardBranch = {
  id: string;
  name: string;
  /** "05:00" — when the branch's sales day turns over. */
  cutoff: string;
  pos: { id: string; name: string; formats: number }[];
};

const BRANDS: { type: PosTypeValue; label: string; note?: string }[] = [
  { type: "FOODSTORY", label: "FoodStory" },
  { type: "WONGNAI", label: "Wongnai POS" },
  { type: "OCHA", label: "Ocha" },
  { type: "STOREHUB", label: "StoreHub" },
  { type: "LOYVERSE", label: "Loyverse" },
  { type: "CUSTOM", label: "อื่น ๆ", note: "ยี่ห้ออื่น หรือไม่แน่ใจ" },
];
const brandName = (t: PosTypeValue) => (t === "CUSTOM" ? "POS" : BRANDS.find((b) => b.type === t)!.label);

const PAGES = ["ยี่ห้อ POS", "ไฟล์ตัวอย่าง", "คอลัมน์ไหนคืออะไร", "ตัวเลขในไฟล์", "ตรวจแล้วบันทึก"];

/** The four the file cannot do without. The date is its own slot — it becomes a day or a time on page 4. */
type Ask = "date" | "menuName" | "qty" | "netAmount";
const ASKS: { key: Ask; q: string; short: string }[] = [
  { key: "date", q: "วันที่ขายอยู่คอลัมน์ไหน", short: "วันที่ขาย" },
  { key: "menuName", q: "ชื่อเมนูอยู่คอลัมน์ไหน", short: "ชื่อเมนู" },
  { key: "qty", q: "จำนวนที่ขายอยู่คอลัมน์ไหน", short: "จำนวน" },
  { key: "netAmount", q: "ยอดเงินของแถวนั้น หลังหักส่วนลด อยู่คอลัมน์ไหน", short: "ยอดเงิน" },
];
type Extra = Exclude<ColumnMapField, "businessDate" | "soldAt" | "menuName" | "qty" | "netAmount">;
const EXTRAS: { key: Extra; label: string; why: string }[] = [
  { key: "menuCode", label: "รหัสเมนู", why: "ใช้จับคู่เมนูแม้ชื่อในเครื่องเปลี่ยน" },
  { key: "billId", label: "เลขบิล", why: "บอกว่าไฟล์เป็นรายบิล" },
  { key: "discountAmount", label: "ส่วนลด", why: "ใช้ดูว่าเมนูไหนลดบ่อย" },
  { key: "grossAmount", label: "ยอดก่อนส่วนลด", why: "ใช้ตรวจว่าตัวเลขแต่ละแถวลงตัว" },
  { key: "categoryName", label: "หมวดเมนู", why: "จัดเมนูเป็นหมวดให้เอง" },
  { key: "channel", label: "ช่องทางขาย", why: "แยกยอดหน้าร้าน กลับบ้าน เดลิเวอรี" },
  { key: "vatAmount", label: "VAT", why: "ใช้หัก VAT ออกจากยอดขาย" },
  { key: "serviceChargeAmount", label: "Service charge", why: "ใช้หัก service charge ออกจากยอดขาย" },
];

/** "@", "ราคา", "price" — a per-unit price column. The row's own amount is what counts. */
const isUnitPrice = (h: string) => /^\s*@\s*$|ราคา|price/i.test(h);

type Inspected = Extract<InspectFileState, { ok: true }>;

export default function FirstImportWizard({
  branches,
  initialBranchId,
  shopVatRegistered,
}: {
  branches: WizardBranch[];
  initialBranchId: string | null;
  shopVatRegistered: boolean;
}) {
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const [branchId, setBranchId] = useState<string | null>(initialBranchId ?? (branches.length === 1 ? branches[0].id : null));
  const branch = branches.find((b) => b.id === branchId) ?? null;
  const [pos, setPos] = useState<{ kind: "existing"; id: string; name: string } | { kind: "new"; type: PosTypeValue } | null>(null);
  const posLabel = pos === null ? "" : pos.kind === "existing" ? pos.name : brandName(pos.type);
  /** No format for this branch yet: its first import. */
  const first = !branch || branch.pos.every((p) => p.formats === 0);

  const [file, setFile] = useState<File | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const [asks, setAsks] = useState<Partial<Record<Ask, number>>>({});
  const [extras, setExtras] = useState<Partial<Record<Extra, number>>>({});
  const [guessed, setGuessed] = useState<Set<string>>(new Set());

  const [dateChoice, setDateChoice] = useState<number | null>(null);
  const [dateWrong, setDateWrong] = useState(false);
  const [vat, setVat] = useState<boolean | null>(null);
  const [sc, setSc] = useState<boolean | null>(null);

  const [trial, setTrial] = useState<TrialReadState | null>(null);
  const [saved, setSaved] = useState<{ profileId: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const header = inspected?.header ?? [];
  const rows = inspected?.sampleRows ?? [];
  const firstRow = rows[0] ?? [];

  // ---- the date column, read every way the system can ----
  const dateValues = useMemo(() => (asks.date === undefined ? [] : rows.map((r) => r[asks.date!] ?? "")), [asks.date, rows]);
  const candidates = useMemo(() => readDateCandidates(dateValues), [dateValues]);
  const telling = tellingSample(candidates);
  // Asked, never assumed: even a single reading waits for "ถูก".
  const reading = dateWrong || dateChoice === null ? null : candidates[dateChoice] ?? null;

  // ---- what gets saved ----
  const columnMap = useMemo(() => {
    const m: Partial<Record<ColumnMapField, number>> = { ...extras };
    if (asks.menuName !== undefined) m.menuName = asks.menuName;
    if (asks.qty !== undefined) m.qty = asks.qty;
    if (asks.netAmount !== undefined) m.netAmount = asks.netAmount;
    if (asks.date !== undefined) {
      // A column that carries times is a moment of sale: the branch's cut-off
      // decides its day. One without is the day the POS already settled (P14).
      if (reading?.hasTime) m.soldAt = asks.date;
      else m.businessDate = asks.date;
    }
    if (vat === false) delete m.vatAmount;
    if (sc === false) delete m.serviceChargeAmount;
    return m;
  }, [asks, extras, reading, vat, sc]);
  const fileKind = columnMap.billId !== undefined || columnMap.soldAt !== undefined ? "BILL_DETAIL" : "DAILY_SUMMARY";

  const draftForm = () => {
    const fd = new FormData();
    fd.set("file", file!);
    fd.set("branchId", branchId!);
    fd.set("fileKind", fileKind);
    fd.set("encoding", inspected!.suggestedEncoding);
    fd.set("dateFormat", reading!.format);
    fd.set("isBuddhistYear", String(reading!.isBuddhistYear));
    fd.set("columnMap", JSON.stringify(columnMap));
    fd.set("amountsIncludeVat", String(vat));
    fd.set("amountsIncludeServiceCharge", String(sc));
    fd.set("defaultChannel", "");
    return fd;
  };

  // ---- reading the file ----
  const inspect = (f: File, encoding?: "UTF8" | "TIS620") => {
    const fd = new FormData();
    fd.set("file", f);
    if (encoding) fd.set("encoding", encoding);
    setInspectError(null);
    start(async () => {
      const r = await orStale(inspectSalesFileAction(null, fd));
      if (!r.ok) {
        setInspected(null);
        setInspectError(r.formError ?? "อ่านไฟล์ไม่ได้");
        return;
      }
      setInspected(r);
      // A fresh header starts from the careful guess (exact names only).
      const s = suggestColumnMap(r.header);
      const date = s.map.businessDate ?? s.map.soldAt;
      setAsks({ date, menuName: s.map.menuName, qty: s.map.qty, netAmount: s.map.netAmount });
      const ex: Partial<Record<Extra, number>> = {};
      for (const e of EXTRAS) if (s.map[e.key] !== undefined) ex[e.key] = s.map[e.key];
      setExtras(ex);
      setGuessed(new Set([...(date !== undefined ? ["date"] : []), ...Object.keys(s.map).filter((k) => k !== "businessDate" && k !== "soldAt")]));
      setDateChoice(null);
      setDateWrong(false);
    });
  };

  const pickFile = (f: File) => {
    setFile(f);
    setInspected(null);
    setTrial(null);
    setVat(null);
    setSc(null);
    inspect(f);
  };

  /** One column answers one question: choosing it for another moves it. */
  const assign = (key: Ask | Extra, col: number | undefined, isAsk: boolean) => {
    setGuessed((g) => {
      const n = new Set(g);
      n.delete(key);
      return n;
    });
    setMsg("");
    const nextAsks = { ...asks };
    const nextExtras = { ...extras };
    if (col !== undefined) {
      for (const k of Object.keys(nextAsks) as Ask[]) if (nextAsks[k] === col) delete nextAsks[k];
      for (const k of Object.keys(nextExtras) as Extra[]) if (nextExtras[k] === col) delete nextExtras[k];
    }
    if (isAsk) nextAsks[key as Ask] = col;
    else if (col === undefined) delete nextExtras[key as Extra];
    else nextExtras[key as Extra] = col;
    setAsks(nextAsks);
    setExtras(nextExtras);
    if (key === "date") {
      setDateChoice(null);
      setDateWrong(false);
    }
  };

  // ---- moving between pages ----
  const problem = (): string => {
    if (step === 0) {
      if (!branch) return "เลือกสาขาก่อน";
      if (!pos) return "เลือกยี่ห้อ POS ก่อน";
    }
    if (step === 1 && !inspected) return pending ? "กำลังอ่านไฟล์…" : "อัปไฟล์ก่อน";
    if (step === 2) {
      const miss = ASKS.filter((a) => asks[a.key] === undefined).map((a) => a.short);
      if (miss.length) return `ยังไม่ได้เลือก: ${miss.join(" · ")}`;
    }
    if (step === 3) {
      if (!reading) return candidates.length === 0 || dateWrong ? "วันที่ยังอ่านไม่ได้ — กดย้อนกลับไปเลือกคอลัมน์วันที่ใหม่" : "ตอบเรื่องวันที่ก่อน";
      if (vat === null || sc === null) return "ตอบให้ครบทุกข้อ";
      if (vat && extras.vatAmount === undefined) return "เลือกคอลัมน์ VAT";
      if (sc && extras.serviceChargeAmount === undefined) return "เลือกคอลัมน์ service charge";
    }
    return "";
  };

  const next = () => {
    const p = problem();
    if (p) return setMsg(p);
    setMsg("");
    if (step === 3) {
      setTrial(null);
      setStep(4);
      const fd = draftForm();
      start(async () => setTrial(await orStale(trialReadSalesFileAction(fd))));
      return;
    }
    if (step === 4) {
      if (trial?.ok !== true || !trial.trial.ok) return;
      const fd = draftForm();
      if (pos!.kind === "existing") fd.set("posIntegrationId", pos!.id);
      else {
        fd.set("posType", pos!.type);
        fd.set("posName", brandName(pos!.type));
      }
      setSaveError(null);
      start(async () => {
        const r = await orStale(setupSalesFileAction(fd));
        if (r.ok) setSaved({ profileId: r.profileId });
        else setSaveError(r.formError ?? Object.values(r.fieldErrors ?? {})[0] ?? "บันทึกไม่ได้");
      });
      return;
    }
    setStep(step + 1);
  };
  const back = () => {
    setMsg("");
    setSaveError(null);
    if (step === 3) setDateWrong(false);
    if (step > 0) setStep(step - 1);
  };

  if (saved && file && branch) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-good-border bg-good-bg px-4 py-3 text-sm text-good">
          <p className="font-display font-semibold">✓ บันทึกรูปแบบไฟล์ของ {posLabel} · {branch.name} แล้ว</p>
          <p className="mt-0.5 text-foreground">ขั้นสุดท้าย: ตรวจยอดขายที่จะเข้าระบบ แล้วกด “ยืนยันนำเข้า” · ครั้งต่อไปอัปไฟล์หน้าตาเดิมได้เลย ระบบไม่ถามอีก</p>
        </div>
        <SalesImportWizard
          profiles={[
            {
              id: saved.profileId,
              name: `${posLabel} · ${fileKind === "BILL_DETAIL" ? "ไฟล์รายบิล" : "ไฟล์สรุปรายวัน"}`,
              branchName: branch.name,
              posName: posLabel,
              fileKindLabel: fileKind === "BILL_DETAIL" ? "รายบิล" : "สรุปรายวัน",
              encodingLabel: inspected?.excel ? "Excel" : FILE_ENCODING_LABELS_TH[inspected?.suggestedEncoding ?? "UTF8"],
            },
          ]}
          initialFile={file}
          autoPreview
        />
      </div>
    );
  }

  const canBack = step > 0 && !pending;
  const nextLabel = step === 4 ? (pending ? "กำลังบันทึก…" : "บันทึก แล้วไปขั้นนำเข้า ›") : "ถัดไป ›";

  return (
    <div className="overflow-hidden rounded-[22px] border border-border-strong bg-background shadow-[0_18px_40px_-28px_rgb(35_36_12/0.5)]">
      {/* ---- where am I ---- */}
      <div className="grid gap-2 border-b border-border bg-surface px-4 py-3 sm:px-5">
        <p className="font-display text-[13px] font-semibold text-gold-ink">
          {first ? "นำเข้ายอดขายครั้งแรก" : "ตั้งรูปแบบไฟล์ใหม่"} · หน้า {step + 1} จาก {PAGES.length}
        </p>
        <ol className="grid grid-cols-5 gap-1.5">
          {PAGES.map((name, i) => (
            <li key={name} aria-current={i === step ? "step" : undefined} className={`grid min-w-0 gap-1 text-[11.5px] ${i < step ? "text-good" : i === step ? "font-semibold text-foreground" : "text-muted-subtle"}`}>
              <span aria-hidden className={`h-[5px] rounded-full ${i < step ? "bg-good" : i === step ? "bg-primary" : "bg-border"}`} />
              <span className="hidden truncate sm:block">{name}</span>
            </li>
          ))}
        </ol>
        <p className="text-[12px] text-muted-foreground sm:hidden">{PAGES[step]}</p>
      </div>

      {/* ---- the page ---- */}
      <div className="grid min-h-[360px] content-start gap-4 px-4 py-5 sm:px-5">
        {step === 0 && (
          <>
            {branches.length > 1 && (
              <div className="grid gap-2">
                <H>สาขาไหน</H>
                <div className="flex flex-wrap gap-2">
                  {branches.map((b) => (
                    <Card key={b.id} on={b.id === branchId} onClick={() => (setBranchId(b.id), setPos(null), setMsg(""))}>
                      <b className="font-display font-semibold">{b.name}</b>
                      <small className="text-muted-foreground">{b.pos.length ? b.pos.map((p) => p.name).join(" · ") : "ยังไม่ได้ตั้ง POS"}</small>
                    </Card>
                  ))}
                </div>
              </div>
            )}
            {branch && (
              <>
                <div className="grid gap-1">
                  <H>{branch.name} ใช้ POS ยี่ห้อไหน</H>
                  <Sub>ไม่ต้องกรอกรหัสผ่าน คิดครัวไม่ได้เชื่อมกับ POS · ใช้ไฟล์ที่ร้านดาวน์โหลดจากหลังบ้าน POS เอง</Sub>
                </div>
                {branch.pos.length > 0 && (
                  <div className="grid gap-2">
                    <Label>POS ที่ตั้งไว้แล้วของสาขานี้ · เลือกเพื่อเพิ่มรูปแบบไฟล์ใหม่</Label>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                      {branch.pos.map((p) => (
                        <Card key={p.id} on={pos?.kind === "existing" && pos.id === p.id} onClick={() => (setPos({ kind: "existing", id: p.id, name: p.name }), setMsg(""))}>
                          <b className="font-display font-semibold">{p.name}</b>
                          <small className="text-muted-foreground">มีรูปแบบไฟล์ {p.formats} แบบ</small>
                        </Card>
                      ))}
                    </div>
                    <Label>หรือยี่ห้ออื่น</Label>
                  </div>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                  {BRANDS.map((b) => (
                    <Card key={b.type} on={pos?.kind === "new" && pos.type === b.type} onClick={() => (setPos({ kind: "new", type: b.type }), setMsg(""))}>
                      <b className="font-display font-semibold">{b.label}</b>
                      {b.note && <small className="text-muted-foreground">{b.note}</small>}
                    </Card>
                  ))}
                </div>
                {branches.length > 1 && <Note title="สาขาอื่นใช้ POS คนละยี่ห้อ?">ตั้งทีละสาขา แต่ละสาขามี POS และรูปแบบไฟล์ของตัวเอง</Note>}
              </>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <div className="grid gap-1">
              <H>อัปไฟล์ยอดขายจาก {posLabel} หนึ่งไฟล์</H>
              <Sub>ใช้ไฟล์จริงจากหลังบ้าน POS (รายบิลหรือสรุปรายวันก็ได้) · หน้านี้ยังไม่บันทึกอะไร</Sub>
            </div>
            <FileDrop accept=".csv,.xlsx,text/csv" fileName={file?.name ?? null} hint="ไฟล์ .csv หรือ Excel (.xlsx)" onFile={pickFile} disabled={pending} />
            {pending && <p className="text-sm text-muted-foreground">กำลังอ่านไฟล์…</p>}
            {inspectError && <p className="rounded-xl border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">{inspectError}</p>}
            {inspected && !pending && (
              <Note title="อ่านไฟล์ได้แล้ว">
                {inspected.excel ? "ไฟล์ Excel" : "ไฟล์ CSV"} · หัวตาราง {inspected.header.length} คอลัมน์ · ข้อมูล {inspected.rowCount.toLocaleString("th-TH")} แถว
                {!inspected.excel && (
                  <span className="block">
                    ภาษาไทยในตารางหน้าถัดไปอ่านไม่ออก?{" "}
                    <button
                      type="button"
                      className="font-semibold text-primary underline"
                      onClick={() => file && inspect(file, inspected.suggestedEncoding === "UTF8" ? "TIS620" : "UTF8")}
                    >
                      ลองอ่านแบบ {inspected.suggestedEncoding === "UTF8" ? "TIS-620" : "UTF-8"}
                    </button>
                  </span>
                )}
              </Note>
            )}
          </>
        )}

        {step === 2 && inspected && (
          <>
            <div className="grid gap-1">
              <H>บอกระบบว่าคอลัมน์ไหนคืออะไร</H>
              <Sub>ทำครั้งเดียว ครั้งต่อไปไฟล์หน้าตาเดิมระบบจำได้เอง</Sub>
            </div>
            <Note title={`ตารางข้างล่างคือ ${Math.min(4, rows.length)} แถวแรกในไฟล์ของคุณ`}>
              {asks.menuName !== undefined && firstRow[asks.menuName] ? `“${firstRow[asks.menuName]}” คือเมนูที่ขายในแถวแรก · ` : ""}
              {header.some(isUnitPrice) ? `“${header.find(isUnitPrice)}” คือราคาต่อหน่วย ระบบไม่ต้องใช้ เพราะมียอดเงินของแถวอยู่แล้ว · ` : ""}
              ป้ายใต้หัวคอลัมน์บอกว่าระบบจะอ่านคอลัมน์นั้นเป็นอะไร
            </Note>
            <SampleTable header={header} rows={rows.slice(0, 4)} roleOf={(i) => roleOf(i, asks, extras, header)} />
            <div className="grid gap-3">
              {ASKS.map((a) => (
                <div key={a.key} className={`grid gap-2 rounded-2xl border bg-surface px-3 py-2.5 ${asks[a.key] === undefined ? "border-bad-border" : "border-border"}`}>
                  <p className="flex flex-wrap items-center gap-2 font-display text-sm font-semibold">
                    {a.q}
                    {asks[a.key] === undefined ? (
                      <em className="font-sans text-xs font-semibold not-italic text-bad">ยังไม่ได้เลือก</em>
                    ) : guessed.has(a.key) ? (
                      <em className="font-sans text-xs font-semibold not-italic text-good">ระบบเลือกให้ · ตรวจอีกครั้ง</em>
                    ) : null}
                  </p>
                  <ColumnChips header={header} sample={firstRow} chosen={asks[a.key]} onPick={(i) => assign(a.key, i, true)} />
                </div>
              ))}
            </div>
            <details className="rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm">
              <summary className="cursor-pointer font-display font-semibold text-primary">
                ข้อมูลเสริม ถ้ามีในไฟล์ (ไม่บังคับ){Object.keys(extras).length > 0 ? ` · เลือกไว้ ${Object.keys(extras).length} ช่อง` : ""}
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {EXTRAS.map((x) => (
                  <label key={x.key} className="grid gap-1">
                    <span className="font-semibold">
                      {x.label}
                      {guessed.has(x.key) && extras[x.key] !== undefined && <span className="ml-1.5 text-xs font-normal text-good">ระบบเลือกให้</span>}
                    </span>
                    <select
                      value={extras[x.key] ?? ""}
                      onChange={(e) => assign(x.key, e.target.value === "" ? undefined : Number(e.target.value), false)}
                      className="input w-full"
                    >
                      <option value="">— ไม่มีในไฟล์ —</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `คอลัมน์ ${i + 1}`} · เช่น {firstRow[i] || "—"}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">{x.why}</span>
                  </label>
                ))}
              </div>
            </details>
          </>
        )}

        {step === 3 && inspected && (
          <>
            <div className="grid gap-1">
              <H>ตัวเลขในไฟล์หมายความว่าอะไร</H>
              <Sub>ข้อเหล่านี้ระบบไม่เดาให้ เพราะตอบผิดแล้วตัวเลขเพี้ยนทุกแถว</Sub>
            </div>

            <Question title={candidates.length > 1 ? `วันที่ในไฟล์อ่านได้ ${candidates.length} แบบ แถวที่ ${telling + 1} หมายถึงวันไหน` : "วันที่ขาย"}>
              {candidates.length === 0 || dateWrong ? (
                <div className="grid gap-2">
                  <p className="text-sm text-bad">
                    {dateWrong
                      ? "ถ้าวันที่ไม่ถูก คอลัมน์นี้อาจไม่ใช่วันที่ขาย"
                      : `ระบบอ่านวันที่ในคอลัมน์ “${header[asks.date!] || `คอลัมน์ ${asks.date! + 1}`}” ไม่ได้ · แถวแรกเขียนว่า “${dateValues[0] ?? ""}”`}
                  </p>
                  <button type="button" onClick={() => (setStep(2), setMsg(""), setDateWrong(false))} className="btn-secondary btn-sm w-fit">
                    ‹ กลับไปเลือกคอลัมน์วันที่
                  </button>
                </div>
              ) : candidates.length === 1 ? (
                <>
                  <p className="text-sm">
                    ระบบอ่านวันที่แถวแรกได้ว่า{" "}
                    <b className="font-display">{thaiDateLabel(candidates[0].days[0].day, candidates[0].isBuddhistYear, candidates[0].days[0].minutes)}</b> ถูกไหม
                  </p>
                  <Evidence>
                    ในไฟล์เขียน “{candidates[0].days[0].raw}” · ปี {candidates[0].isBuddhistYear ? "พ.ศ." : "ค.ศ."}
                  </Evidence>
                  <YesNo
                    value={dateChoice === 0 ? true : null}
                    yes="ถูก"
                    no="ไม่ถูก"
                    onChange={(v) => {
                      setMsg("");
                      if (v) setDateChoice(0);
                      else setDateWrong(true);
                    }}
                  />
                </>
              ) : (
                <>
                  <Evidence>ในไฟล์เขียน “{candidates[0].days[telling].raw}” · อ่านได้ทั้งแบบวันขึ้นก่อนและเดือนขึ้นก่อน</Evidence>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {candidates.map((c, i) => (
                      <Card key={c.format} on={dateChoice === i} onClick={() => (setDateChoice(i), setMsg(""))}>
                        <b className="font-display font-semibold">{thaiDateLabel(c.days[telling].day, c.isBuddhistYear, c.days[telling].minutes)}</b>
                        <small className="text-muted-foreground">{c.format.startsWith("MM") ? "เดือนขึ้นก่อน" : c.format.startsWith("y") ? "ปีขึ้นก่อน" : "วันขึ้นก่อน"}</small>
                      </Card>
                    ))}
                  </div>
                </>
              )}
              {reading?.hasTime && (
                <Evidence>
                  คอลัมน์นี้มีเวลาขาย · บิลหลังเที่ยงคืนถึง {branch?.cutoff} นับเป็นยอดของวันก่อนหน้า ตามที่ตั้งไว้ที่สาขา
                </Evidence>
              )}
            </Question>

            <Question title="ยอดเงินในไฟล์ รวม VAT แล้วหรือยัง">
              {asks.netAmount !== undefined && (
                <Evidence>
                  แถวแรก: {asks.menuName !== undefined ? firstRow[asks.menuName] : ""}
                  {asks.qty !== undefined ? ` × ${firstRow[asks.qty]}` : ""} = ฿{firstRow[asks.netAmount]}
                  {!shopVatRegistered ? " · ร้านยังไม่ได้จด VAT ถ้า POS ไม่ได้บวก VAT ในราคา ตอบ “ยังไม่รวม”" : ""}
                </Evidence>
              )}
              <YesNo value={vat} yes="รวมแล้ว" no="ยังไม่รวม" onChange={(v) => (setVat(v), setMsg(""))} />
              {vat && (
                <NeedColumn
                  label="VAT อยู่คอลัมน์ไหน"
                  why="ยอดขายในคิดครัวไม่รวม VAT ระบบจึงหัก VAT ของแต่ละแถวออก · ถ้าไฟล์ไม่มีคอลัมน์ VAT ให้ดาวน์โหลดรายงานแบบที่มี VAT จาก POS"
                  header={header}
                  sample={firstRow}
                  chosen={extras.vatAmount}
                  onPick={(i) => assign("vatAmount", i, false)}
                />
              )}
            </Question>

            <Question title="ยอดเงินในไฟล์ รวม service charge แล้วหรือยัง">
              <Evidence>ร้านไม่เก็บ service charge ตอบ “ยังไม่รวม” ได้เลย</Evidence>
              <YesNo value={sc} yes="รวมแล้ว" no="ยังไม่รวม" onChange={(v) => (setSc(v), setMsg(""))} />
              {sc && (
                <NeedColumn
                  label="Service charge อยู่คอลัมน์ไหน"
                  why="ระบบหัก service charge ของแต่ละแถวออกจากยอดขาย"
                  header={header}
                  sample={firstRow}
                  chosen={extras.serviceChargeAmount}
                  onPick={(i) => assign("serviceChargeAmount", i, false)}
                />
              )}
            </Question>
          </>
        )}

        {step === 4 && (
          <>
            <div className="grid gap-1">
              <H>ตรวจว่าระบบอ่านถูก แล้วกดบันทึก</H>
              <Sub>นี่คือสิ่งที่ระบบอ่านได้จากไฟล์ · ยอดเงินคือยอดขายหลังหักส่วนลด ไม่รวม VAT และ service charge · ถ้าไม่ตรง กดย้อนกลับไปแก้ได้</Sub>
            </div>
            {trial === null ? (
              <p className="text-sm text-muted-foreground">กำลังอ่านไฟล์ด้วยคำตอบของคุณ…</p>
            ) : !trial.ok ? (
              <p className="rounded-xl border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
                {trial.formError ?? Object.values(trial.fieldErrors ?? {})[0] ?? "อ่านไม่ได้"}
              </p>
            ) : !trial.trial.ok ? (
              <div className="grid gap-2 rounded-2xl border border-bad-border bg-bad-bg px-3 py-2.5 text-sm">
                <p className="font-display font-semibold text-bad">ระบบอ่านไฟล์ด้วยคำตอบนี้ไม่ได้ · กด ‹ ย้อนกลับ ไปแก้</p>
                <ul className="grid gap-0.5 text-xs">
                  {trial.trial.errors.map((e, i) => (
                    <li key={i}>
                      <b>แถวที่ {e.rowNumber}</b>
                      {e.field ? ` · ${e.field}` : ""} — {e.message}
                    </li>
                  ))}
                  {trial.trial.moreErrors > 0 && <li className="text-muted-foreground">และอีก {trial.trial.moreErrors} แถว</li>}
                </ul>
              </div>
            ) : (
              <ReadBack t={trial.trial} isBE={reading?.isBuddhistYear ?? false} posLabel={posLabel} branchName={branch?.name ?? ""} />
            )}
            {saveError && <p className="rounded-xl border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">{saveError}</p>}
          </>
        )}
      </div>

      {/* ---- back / next ---- */}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-border bg-surface px-4 py-3 sm:px-5">
        <button type="button" onClick={back} disabled={!canBack} className="btn-secondary btn-sm">
          ‹ ย้อนกลับ
        </button>
        <button
          type="button"
          onClick={next}
          disabled={pending || (step === 4 && !(trial?.ok === true && trial.trial.ok))}
          className="btn btn-sm ml-auto"
        >
          {nextLabel}
        </button>
        {msg && (
          <p role="alert" className="order-3 basis-full text-sm text-bad">
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function roleOf(i: number, asks: Partial<Record<Ask, number>>, extras: Partial<Record<Extra, number>>, header: string[]): ["k" | "o" | "n", string] {
  for (const a of ASKS) if (asks[a.key] === i) return ["k", a.short];
  for (const x of EXTRAS) if (extras[x.key] === i) return ["o", `${x.label} (เสริม)`];
  if (isUnitPrice(header[i] ?? "")) return ["n", "ราคาต่อหน่วย · ไม่ใช้"];
  return ["n", "ไม่ใช้"];
}

function SampleTable({ header, rows, roleOf }: { header: string[]; rows: string[][]; roleOf: (i: number) => ["k" | "o" | "n", string] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {header.map((h, i) => {
              const [kind, label] = roleOf(i);
              return (
                <th key={i} className={`whitespace-nowrap border-b border-border px-2.5 py-1.5 text-left align-top font-display text-xs font-semibold ${kind === "k" ? "bg-highlight" : "bg-surface-sunk"}`}>
                  {h || `คอลัมน์ ${i + 1}`}
                  <span
                    className={`mt-1 block w-max rounded-full px-1.5 font-sans text-[10.5px] font-semibold ${
                      kind === "k" ? "bg-primary text-primary-foreground" : kind === "o" ? "bg-primary-soft text-primary" : "border border-dashed border-border-strong text-muted-subtle"
                    }`}
                  >
                    {label}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {header.map((_, ci) => (
                <td key={ci} className={`whitespace-nowrap border-b border-border px-2.5 py-1.5 ${roleOf(ci)[0] === "k" ? "bg-highlight" : ""}`}>
                  {r[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColumnChips({ header, sample, chosen, onPick }: { header: string[]; sample: string[]; chosen: number | undefined; onPick: (i: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {header.map((h, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(i)}
          aria-pressed={chosen === i}
          className={`grid max-w-[11rem] rounded-[10px] border px-2.5 py-1 text-left text-[12.5px] leading-snug transition-colors ${
            chosen === i ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-border-strong bg-background hover:bg-surface-sunk"
          }`}
        >
          <span className="truncate font-semibold">{h || `คอลัมน์ ${i + 1}`}</span>
          <small className="truncate text-[11px] text-muted-foreground">{sample[i] || "—"}</small>
        </button>
      ))}
    </div>
  );
}

function NeedColumn(props: { label: string; why: string; header: string[]; sample: string[]; chosen: number | undefined; onPick: (i: number) => void }) {
  return (
    <div className={`grid gap-1.5 rounded-xl border px-3 py-2 ${props.chosen === undefined ? "border-bad-border" : "border-border"}`}>
      <p className="text-sm font-semibold">{props.label}</p>
      <ColumnChips header={props.header} sample={props.sample} chosen={props.chosen} onPick={props.onPick} />
      <p className="text-xs text-muted-foreground">{props.why}</p>
    </div>
  );
}

function ReadBack({ t, isBE, posLabel, branchName }: { t: Extract<Extract<TrialReadState, { ok: true }>["trial"], { ok: true }>; isBE: boolean; posLabel: string; branchName: string }) {
  const baht = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;
  const day = (iso: string) => thaiDateLabel(new Date(`${iso}T00:00:00Z`), isBE);
  return (
    <div className="grid gap-2">
      {t.days.map((d) => (
        <div key={d.date} className="grid gap-0.5 rounded-2xl border border-border bg-surface px-3 py-2.5 text-[13px]">
          <b className="font-display">
            {day(d.date)} · {baht(d.net)}
          </b>
          {d.lines.map((l) => (
            <span key={l.name} className="flex justify-between gap-3 text-muted-foreground">
              <span className="min-w-0">
                {l.name} × {l.qty.toLocaleString("th-TH")}
                {l.discount > 0 ? ` (ลด ${baht(l.discount)})` : ""}
              </span>
              <span className="font-display tabular-nums text-foreground">{baht(l.net)}</span>
            </span>
          ))}
          {d.moreLines > 0 && <span className="text-xs text-muted-subtle">และอีก {d.moreLines} เมนู</span>}
        </div>
      ))}
      {t.moreDays > 0 && <p className="text-xs text-muted-foreground">และอีก {t.moreDays} วัน</p>}
      {t.usedCutoff && <p className="text-xs text-muted-foreground">วันขายคิดจากเวลาในไฟล์ · บิลหลังเที่ยงคืนถึง {Math.floor(t.cutoffMinutes / 60).toString().padStart(2, "0")}:{(t.cutoffMinutes % 60).toString().padStart(2, "0")} อยู่ในยอดของวันก่อนหน้า</p>}
      {t.inconsistentRows > 0 && (
        <p className="rounded-xl border border-warn-border bg-warn-bg px-3 py-2 text-xs text-warn">
          {t.inconsistentRows} แถว ยอดก่อนส่วนลด − ส่วนลด ไม่เท่ากับยอดเงิน · ลองตรวจคำตอบเรื่อง VAT และ service charge อีกครั้ง
        </p>
      )}
      <Note title="จะบันทึก">
        รูปแบบไฟล์ “{posLabel} · {branchName}” · ไฟล์นี้มียอดขาย {t.totalDays} วัน {t.totalRows.toLocaleString("th-TH")} แถว รวม {baht(t.totalNet)} · เมนูในไฟล์ {t.menus} รายการ
        {t.blankRowsSkipped > 0 ? ` · แถวว่าง ${t.blankRowsSkipped} แถว ระบบข้าม` : ""}
      </Note>
    </div>
  );
}

const H = ({ children }: { children: ReactNode }) => <h3 className="text-balance font-display text-lg font-semibold">{children}</h3>;
const Sub = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
const Label = ({ children }: { children: ReactNode }) => <p className="font-display text-[12px] font-semibold tracking-[0.06em] text-gold-ink">{children}</p>;
const Evidence = ({ children }: { children: ReactNode }) => <p className="rounded-[10px] bg-surface-sunk px-2.5 py-1.5 text-[12.5px] text-foreground">{children}</p>;

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 rounded-2xl bg-[#EEF0DC] px-3.5 py-2.5 text-[13px] text-muted-foreground">
      <b className="text-foreground">{title}</b>
      <span>{children}</span>
    </div>
  );
}

function Card({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`grid min-w-0 gap-0.5 rounded-2xl border px-3 py-2.5 text-left text-sm transition-colors ${
        on ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-border-strong bg-surface hover:bg-surface-sunk"
      }`}
    >
      {children}
    </button>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 rounded-2xl border border-border bg-surface px-3 py-3">
      <p className="font-display text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}

/** No answer is preselected: an unanswered question must not read as "no" (rule P10). */
function YesNo({ value, yes, no, onChange }: { value: boolean | null; yes: string; no: string; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:max-w-md">
      <Card on={value === true} onClick={() => onChange(true)}>
        <b className="font-display font-semibold">{yes}</b>
      </Card>
      <Card on={value === false} onClick={() => onChange(false)}>
        <b className="font-display font-semibold">{no}</b>
      </Card>
    </div>
  );
}
