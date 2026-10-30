"use client";

// The "?" walkthrough (Kong 2026-10-30: "มีปุ่ม?เพื่อเป็นป๊อปอัพขั้นตอนการทำ
// ทีละขั้น"). Six steps, round 3 of the mockup R3vZEuvaWr2gWQosAgYfkA; the
// same six for every import, with the attaching and the review told for what
// is being imported (ingredients, or bills).
// Every step is laid into the same grid cell, so the window is as tall as its
// tallest step and ย้อนกลับ / ถัดไป never move. Opens by itself on the first
// visit; after that only from the button.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type GuideKind = "products" | "bills" | "recipes";

export default function ImportGuide({ prompt, kind }: { prompt: string; kind: GuideKind }) {
  const SEEN_KEY = `kitkrua:import-guide-seen:${kind}`;
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) === null) setOpen(true);
    } catch {
      /* storage blocked — the button still works */
    }
  }, [SEEN_KEY]);

  const close = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    opener.current?.focus();
  }, [SEEN_KEY]);

  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-border-strong bg-surface py-1 pl-1.5 pr-4 text-sm font-medium transition-colors hover:border-warn"
      >
        <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-primary font-display text-[15px] font-semibold text-primary-foreground">
          ?
        </span>
        วิธีนำเข้าทีละขั้น
      </button>
      {open && <GuideWindow prompt={prompt} kind={kind} onClose={close} />}
    </>
  );
}

function GuideWindow({ prompt, kind, onClose }: { prompt: string; kind: GuideKind; onClose: () => void }) {
  const [at, setAt] = useState(0);
  const [ready, setReady] = useState(false);
  const win = useRef<HTMLDivElement>(null);
  const steps = STEPS(prompt, kind);
  const last = steps.length - 1;

  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (!ready) return;
    win.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setAt((k) => Math.min(last, k + 1));
      else if (e.key === "ArrowLeft") setAt((k) => Math.max(0, k - 1));
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [ready, onClose, last]);

  if (!ready) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid animate-fade-in items-end bg-black/50 backdrop-blur-[2px] sm:place-items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={win}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`guide-step-${at}`}
        tabIndex={-1}
        className="max-h-[92dvh] w-full animate-pop-in overflow-y-auto rounded-t-[22px] bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none sm:max-h-[calc(100dvh-48px)] sm:max-w-[560px] sm:rounded-[22px]"
      >
        <div className="flex items-center gap-3.5 px-5 pt-[18px] sm:pl-[22px]">
          <div className="flex flex-1 gap-[5px]" role="group" aria-label="ไปขั้นที่">
            {steps.map((_, k) => (
              <button
                key={k}
                type="button"
                aria-label={`ขั้นที่ ${k + 1}`}
                aria-current={k === at ? "step" : undefined}
                onClick={() => setAt(k)}
                className={`relative h-1.5 flex-1 rounded-full before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[''] ${
                  k === at ? "bg-primary" : k < at ? "bg-primary/45" : "bg-border-strong/70"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-wash"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] px-5 pb-1 pt-3.5 sm:px-[22px]">
          {steps.map((s, k) => (
            <div
              key={k}
              aria-hidden={k !== at}
              className={`col-start-1 row-start-1 grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 ${k === at ? "animate-fade-in" : "invisible"}`}
            >
              <span className="font-display text-[12.5px] font-semibold tracking-[0.08em] text-warn">
                ขั้นที่ {k + 1} จาก {steps.length}
              </span>
              <h2 id={`guide-step-${k}`} className="-mt-1.5 text-xl font-semibold">
                {s.title}
              </h2>
              {s.body}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2.5 px-5 pb-5 pt-3.5 sm:px-[22px]">
          <button type="button" onClick={() => setAt((k) => k - 1)} className={`btn-secondary flex-1 sm:flex-none ${at === 0 ? "invisible" : ""}`}>
            ย้อนกลับ
          </button>
          <button type="button" onClick={() => (at === last ? onClose() : setAt((k) => k + 1))} className="btn flex-1 sm:flex-none">
            {at === last ? "เริ่มนำเข้า" : "ถัดไป"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ------------------------------------------------------------
// The six steps
// ------------------------------------------------------------

const say = "text-[15px] text-foreground";
const fine = "text-[13px] text-muted-foreground";

function Ill({ children, tip = false }: { children: ReactNode; tip?: boolean }) {
  return (
    <div
      className={`grid min-h-[160px] grid-cols-[minmax(0,1fr)] place-items-center gap-3 rounded-2xl border border-border bg-muted px-3.5 pt-5 ${tip ? "pb-[52px]" : "pb-5"}`}
    >
      {children}
    </div>
  );
}

function ChatWindow({ children }: { children: ReactNode }) {
  return (
    <div className="grid w-full max-w-[400px] grid-cols-[minmax(0,1fr)] rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <i className="h-[7px] w-[7px] rounded-full bg-border-strong" />
        <i className="h-[7px] w-[7px] rounded-full bg-border-strong" />
        <i className="h-[7px] w-[7px] rounded-full bg-border-strong" />
        <span className="ml-1.5">แชตใหม่</span>
      </div>
      {children}
    </div>
  );
}

function FileChip({ kind, name, hl = false }: { kind: string; name: string; hl?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-border bg-surface px-2.5 py-1 text-[12.5px] ${hl ? "ring-2 ring-warn ring-offset-2" : ""}`}
    >
      <i className="rounded-[5px] bg-primary-soft px-1.5 font-display text-[10.5px] font-semibold not-italic tracking-wide text-primary">{kind}</i>
      {name}
    </span>
  );
}

function Callout({ children, side = "center" }: { children: ReactNode; side?: "left" | "right" | "center" }) {
  const pos = side === "left" ? "left-0" : side === "right" ? "right-[-4px]" : "left-1/2 -translate-x-1/2";
  const arrow = side === "left" ? "after:left-4" : side === "right" ? "after:right-3.5" : "after:left-1/2 after:-ml-1.5";
  return (
    <span
      className={`absolute top-[calc(100%+12px)] z-[1] whitespace-nowrap rounded-lg bg-warn px-2.5 py-1 font-display text-xs font-semibold text-warn-foreground after:absolute after:bottom-full after:border-[6px] after:border-transparent after:border-b-warn after:content-[''] ${pos} ${arrow}`}
    >
      {children}
    </span>
  );
}

const icoBase = "grid h-8 w-8 shrink-0 place-items-center rounded-full border font-display text-[17px] font-semibold";
const ico = `${icoBase} border-border bg-surface`;
const icoGo = `${icoBase} border-primary bg-primary text-primary-foreground`;
const pulse = "ring-2 ring-warn ring-offset-2";

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="grid gap-1.5 text-[14.5px]">
      {items.map((it, i) => (
        <li key={i} className="grid grid-cols-[auto_1fr] gap-2 text-muted-foreground">
          <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 rounded-full bg-warn" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function CopyPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          navigator.clipboard.writeText(prompt).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2400);
            },
            () => setCopied(false)
          );
        }}
      >
        คัดลอกคำสั่ง
      </button>
      {copied && (
        <span role="status" className="text-[13px] text-good">
          คัดลอกแล้ว วางในช่องพิมพ์ของ AI ได้เลย
        </span>
      )}
    </div>
  );
}

const STEPS = (prompt: string, kind: GuideKind): { title: string; body: ReactNode }[] => [
  {
    title: "เปิดโปรแกรม AI ที่ร้านใช้",
    body: (
      <>
        <p className={say}>ใช้ ChatGPT, Gemini หรือ Claude ก็ได้ แล้วเริ่มแชตใหม่ เพื่อไม่ให้ปนกับเรื่องที่เคยคุยไว้</p>
        <Ill>
          <div className="flex flex-wrap justify-center gap-2.5">
            {["ChatGPT", "Gemini", "Claude"].map((n) => (
              <span key={n} className="rounded-xl border border-border bg-surface px-4 py-2.5 font-display text-[14.5px] font-semibold">
                {n}
              </span>
            ))}
          </div>
          <span className={fine}>ใช้ได้ทั้งบนมือถือและคอมพิวเตอร์</span>
        </Ill>
      </>
    ),
  },
  {
    title: kind === "bills" ? "แนบรูปบิลหรือใบเสร็จ" : "แนบไฟล์ข้อมูลของร้าน",
    body: (
      <>
        <p className={say}>
          {kind === "bills"
            ? "กดปุ่ม + ข้างช่องพิมพ์ข้อความ แล้วเลือกรูปบิลหรือใบเสร็จ แนบได้หลายใบพร้อมกัน"
            : "กดปุ่ม + ข้างช่องพิมพ์ข้อความ แล้วเลือกไฟล์ของร้าน แนบได้หลายไฟล์พร้อมกัน"}
        </p>
        <Ill tip>
          <ChatWindow>
            <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
              {kind === "bills" ? (
                <>
                  <FileChip kind="JPG" name="บิล-เจ๊ใหญ่.jpg" />
                  <FileChip kind="JPG" name="ใบเสร็จ-แม็คโคร.jpg" />
                  <FileChip kind="PDF" name="ใบกำกับ-ตุลาคม.pdf" />
                </>
              ) : (
                <>
                  <FileChip kind="XLSX" name="รายการของ.xlsx" />
                  <FileChip kind="DOCX" name="สูตรร้าน.docx" />
                  <FileChip kind="JPG" name="สมุดสูตร-หน้า1.jpg" />
                </>
              )}
            </div>
            <div className="mx-2 mb-2 flex items-center gap-2 rounded-[14px] bg-muted py-1.5 pl-2 pr-1.5">
              <span className="relative inline-grid shrink-0">
                <span aria-hidden="true" className={`${ico} ${pulse}`}>
                  +
                </span>
                <Callout side="left">กดตรงนี้เพื่อแนบไฟล์</Callout>
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">พิมพ์ข้อความ…</span>
              <span aria-hidden="true" className={ico}>
                ↑
              </span>
            </div>
          </ChatWindow>
        </Ill>
        {kind === "bills" ? (
          <Bullets items={["ถ่ายทีละใบ ให้เห็นชื่อร้านที่หัวบิล วันที่ และทุกบรรทัด", "บิลยาวถ่ายเป็นหลายรูปได้ ตัวอักษรต้องชัด"]} />
        ) : (
          <Bullets items={[<>รองรับไฟล์ <b className="font-semibold text-foreground">Excel, Word, PDF และรูปถ่าย</b></>, "รูปถ่ายสมุด: ถ่ายตรงทีละหน้า ให้ตัวอักษรชัดเจน"]} />
        )}
        <p className="rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">
          ไฟล์ที่แนบจะส่งไปที่ AI ของร้านเท่านั้น คิดครัวได้รับข้อมูลเมื่อร้านอัปโหลดในขั้นที่ 5
        </p>
      </>
    ),
  },
  {
    title: "คัดลอกคำสั่ง แล้วส่งให้ AI",
    body: (
      <>
        <p className={say}>กดปุ่มด้านล่างเพื่อคัดลอกคำสั่ง จากนั้นวางในช่องพิมพ์ข้อความของ AI แล้วกดส่ง</p>
        <CopyPrompt prompt={prompt} />
        <Ill tip>
          <ChatWindow>
            <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
              {kind === "bills" ? (
                <>
                  <FileChip kind="JPG" name="บิล-เจ๊ใหญ่.jpg" />
                  <FileChip kind="JPG" name="ใบเสร็จ-แม็คโคร.jpg" />
                </>
              ) : (
                <>
                  <FileChip kind="XLSX" name="รายการของ.xlsx" />
                  <FileChip kind="JPG" name="สมุดสูตร-หน้า1.jpg" />
                </>
              )}
            </div>
            <div className="mx-2 mb-2 flex items-center gap-2 rounded-[14px] bg-muted py-1.5 pl-2 pr-1.5">
              <span aria-hidden="true" className={ico}>
                +
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {kind === "bills" ? "ช่วยอ่านบิลและใบเสร็จซื้อของของร้านที่แนบมา…" : "ช่วยแปลงข้อมูลวัตถุดิบและสูตรอาหารของร้านที่แนบมา…"}
              </span>
              <span className="relative inline-grid shrink-0">
                <span aria-hidden="true" className={`${icoGo} ${pulse}`}>
                  ↑
                </span>
                <Callout side="right">กดส่ง</Callout>
              </span>
            </div>
          </ChatWindow>
        </Ill>
        <p className={fine}>บนมือถือ: กดค้างในช่องพิมพ์ แล้วเลือก “วาง”</p>
      </>
    ),
  },
  {
    title: "ดาวน์โหลดผลลัพธ์",
    body: (
      <>
        <p className={say}>เมื่อ AI ทำเสร็จ จะได้ผลลัพธ์แบบใดแบบหนึ่งต่อไปนี้</p>
        <Ill tip>
          <ChatWindow>
            <div className="grid grid-cols-[minmax(0,1fr)] px-3 py-2.5">
              <div className="grid max-w-[92%] justify-self-start gap-2 rounded-[14px] rounded-bl-[4px] bg-muted px-2.5 py-2 text-[12.5px]">
                {kind === "bills" ? "เรียบร้อยแล้ว อ่านได้ 12 บิล 86 บรรทัด" : "เรียบร้อยแล้ว แผ่น “วัตถุดิบ” 47 แถว แผ่น “สูตร” 12 เมนู"}
                <span className="relative inline-grid justify-self-start">
                  <FileChip kind="XLSX" name={kind === "bills" ? "คิดครัว-บิลซื้อ.xlsx ⤓" : "คิดครัว-นำเข้า.xlsx ⤓"} hl />
                  <Callout side="left">กดเพื่อดาวน์โหลด</Callout>
                </span>
              </div>
            </div>
          </ChatWindow>
        </Ill>
        <Bullets
          items={[
            <>
              <b className="font-semibold text-foreground">ได้ไฟล์ Excel</b> กดดาวน์โหลดเก็บไว้
            </>,
            <>
              <b className="font-semibold text-foreground">ได้เป็นตาราง</b> เลือกข้อความทั้งตาราง แล้วคัดลอก
            </>,
            <>
              <b className="font-semibold text-foreground">AI แจ้งว่ายังส่งไม่ครบ</b> พิมพ์ “ต่อ” จนกว่าจะครบ
            </>,
          ]}
        />
      </>
    ),
  },
  {
    title: "อัปโหลดเข้าคิดครัว",
    body: (
      <>
        <p className={say}>กลับมาที่หน้านี้ ลากไฟล์มาวางในกรอบ หรือกดเลือกไฟล์ ถ้าได้ผลลัพธ์เป็นตาราง ให้กด “วางตารางแทน”</p>
        <Ill>
          <div className="grid w-full max-w-[400px] justify-items-center gap-1.5 rounded-[14px] border-2 border-dashed border-warn bg-surface p-4 text-center">
            <b className="font-display text-sm font-semibold">ลากไฟล์มาวางที่นี่</b>
            <FileChip kind="XLSX" name={kind === "bills" ? "คิดครัว-บิลซื้อ.xlsx" : "คิดครัว-นำเข้า.xlsx"} />
          </div>
        </Ill>
        <p className={fine}>
          {kind === "recipes" ? "ใช้ไฟล์เดียวกับตอนนำเข้าวัตถุดิบได้ ระบบอ่านแผ่น “สูตร” แล้วแสดงหน้าตรวจทานทันที ยังไม่มีการบันทึก" : "ระบบจะอ่านข้อมูลแล้วแสดงหน้าตรวจทานทันที ยังไม่มีการบันทึก"}
        </p>
      </>
    ),
  },
  {
    title: "ตรวจทาน แล้วกดบันทึก",
    body: (
      <>
        <p className={say}>
          {kind === "bills"
            ? "ทุกบรรทัดแสดงข้อความจากบิลไว้ให้เทียบ ระบบเช็กว่าจำนวน × ราคา ตรงกับยอดรวม ตรวจเฉพาะแถวที่มีสีก็เพียงพอ"
            : kind === "recipes"
              ? "แต่ละเมนูจับคู่กับเมนูจากไฟล์ยอดขาย วัตถุดิบจับคู่กับรายการของร้าน หน่วยครัว (ทัพพี ช้อน) ถามขนาดครั้งเดียวแล้วจำไว้"
              : "ทุกแถวแสดงข้อความต้นฉบับของร้านไว้ให้เทียบ ตรวจเฉพาะแถวที่มีสีก็เพียงพอ"}
        </p>
        <Ill>
          <div className="grid w-full max-w-[400px] gap-1.5">
            {(kind === "bills"
              ? [
                  ["Sweet Syrup → น้ำเชื่อม", "AI แนะนำ", "chip-warn"],
                  ["ไข่ไก่ 3 × 120 ≠ 380", "ตัวเลขไม่ลงกัน", "chip-warn"],
                  ["พริกแห้ง 1 ถุง", "ต้องบอกขนาด", "chip-bad"],
                ]
              : kind === "recipes"
                ? [
                    ["ข้าวผัดหมู", "ตรงกับเมนู", "chip-good"],
                    ["น้ำมันหอย 1 ช้อนโต๊ะ", "พบในวิธีทำ", "chip-warn"],
                    ["ข้าว 1 ทัพพี", "ต้องบอกขนาด", "chip-bad"],
                  ]
                : [
                  ["กระเพรา", "ชื่อใกล้ของเดิม", "chip-warn"],
                  ["น้ำมันหอย", "พบในวิธีทำ", "chip-warn"],
                  ["(อ่านชื่อไม่ออก)", "ต้องแก้", "chip-bad"],
                ]
            ).map(([n, t, c]) => (
              <div key={n} className="flex items-center justify-between gap-2 rounded-[10px] border border-border bg-surface px-2.5 py-1.5 text-[13px]">
                <span>{n}</span>
                <span className={`chip ${c}`}>{t}</span>
              </div>
            ))}
          </div>
        </Ill>
        <Bullets
          items={[
            <>
              <b className="font-semibold text-foreground">สีเหลือง</b> ควรตรวจ แต่บันทึกได้
            </>,
            <>
              <b className="font-semibold text-foreground">สีแดง</b> ต้องแก้ไขหรือกดข้ามก่อนบันทึก
            </>,
            kind === "bills"
              ? "เก็บแค่ราคาและผู้ขาย ไม่ลงสต๊อก ไม่ลงค่าใช้จ่าย"
              : kind === "recipes"
                ? "บันทึกเป็นสูตรร่าง ยังไม่ตัดสต๊อกจนกว่าจะกด “ใช้สูตร” ที่หน้าทดลองเมนู"
                : "ข้อมูลจะเข้าระบบเมื่อกดปุ่มบันทึกเท่านั้น",
          ]}
        />
      </>
    ),
  },
];
