"use client";

// สมัครใช้งาน in two steps (review 2026-10-28, mockup GG5e43SSLmNFxEHfa5RQJH):
// (1) you and the shop, (2) what kind of shop it is. Both steps are ONE form —
// step 1's fields are only hidden on step 2, so they still post — and the
// server decides; this file only stops "ถัดไป" when step 1 is visibly empty.

import { useActionState, useEffect, useRef, useState } from "react";
import { signupAction, type SignupState } from "./actions";

const IDLE: SignupState = { ok: false };

function Err({ state, name }: { state: SignupState; name: string }) {
  const msg = !state.ok ? state.fieldErrors?.[name] : undefined;
  return msg ? <p className="mt-1.5 text-sm text-bad">{msg}</p> : null;
}

function Choice({ name, value, title, hint }: { name: string; value: string; title: string; hint: string }) {
  return (
    <label className="flex min-w-0 flex-1 basis-48 cursor-pointer flex-col gap-0.5 rounded-2xl border border-border bg-surface px-4 py-3.5 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:ring-1 has-[:checked]:ring-primary">
      <span className="flex items-center gap-2">
        <input type="radio" name={name} value={value} className="h-4 w-4 accent-primary" />
        <span className="font-semibold">{title}</span>
      </span>
      <span className="pl-6 text-sm text-muted-foreground">{hint}</span>
    </label>
  );
}

export default function SignupForm({ signedInEmail }: { signedInEmail: string | null }) {
  const [state, action, pending] = useActionState(signupAction, IDLE);
  const [step, setStep] = useState<1 | 2>(1);
  const [late, setLate] = useState(false);
  const [missing, setMissing] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);

  // A server refusal reopens the step that holds the wrong field.
  useEffect(() => {
    if (!state.ok && state.step) setStep(state.step);
  }, [state]);

  const next = () => {
    const f = form.current;
    if (!f) return;
    const get = (n: string) => String(new FormData(f).get(n) ?? "").trim();
    const m: Record<string, string> = {};
    if (!get("name")) m.name = "กรุณาใส่ชื่อของคุณ";
    if (!signedInEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(get("email"))) m.email = "กรุณาใส่อีเมลให้ถูกต้อง";
    if (!get("tenant_name")) m.tenant_name = "กรุณาใส่ชื่อร้าน";
    setMissing(m);
    if (Object.keys(m).length === 0) setStep(2);
  };

  const err = (n: string) => missing[n] ?? (!state.ok ? state.fieldErrors?.[n] : undefined);
  const input = (n: string) => `input h-12 w-full text-base ${err(n) ? "border-bad ring-1 ring-bad" : ""}`;

  return (
    <form ref={form} action={action} className="space-y-6" noValidate>
      <div>
        <p className="text-[13px] font-semibold text-[#8B6A1E]">ขั้น {step} จาก 2</p>
        <div aria-hidden className="mt-2 grid grid-cols-2 gap-1.5">
          <span className="h-[5px] rounded-full bg-primary" />
          <span className={`h-[5px] rounded-full ${step === 2 ? "bg-primary" : "bg-wash"}`} />
        </div>
      </div>

      {/* ---------- step 1 ---------- */}
      <div className={step === 1 ? "space-y-5" : "hidden"}>
        <div>
          <h1 className="text-[28px] font-semibold">สมัครใช้งานคิดครัว</h1>
          <p className="mt-1.5 text-muted-foreground">ข้อมูลของคุณและร้าน</p>
        </div>
        <div>
          <label htmlFor="name" className="label mb-1.5">ชื่อของคุณ</label>
          <input id="name" name="name" autoComplete="name" className={input("name")} aria-invalid={!!err("name")} />
          {err("name") && <p className="mt-1.5 text-sm text-bad">{err("name")}</p>}
        </div>
        <div>
          <label htmlFor="email" className="label mb-1.5">อีเมล</label>
          {signedInEmail ? (
            <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-base">{signedInEmail}</p>
          ) : (
            <>
              <input id="email" name="email" type="email" autoComplete="email" className={input("email")} aria-invalid={!!err("email")} />
              {err("email") && <p className="mt-1.5 text-sm text-bad">{err("email")}</p>}
            </>
          )}
          <p className="mt-1.5 text-sm text-muted-foreground">ใช้อีเมลนี้เข้าสู่ระบบทุกครั้ง ไม่ต้องตั้งรหัสผ่าน</p>
        </div>
        <div>
          <label htmlFor="tenant_name" className="label mb-1.5">ชื่อร้าน</label>
          <input id="tenant_name" name="tenant_name" placeholder="เช่น ครัวคุณแม่" maxLength={100} className={input("tenant_name")} aria-invalid={!!err("tenant_name")} />
          {err("tenant_name") && <p className="mt-1.5 text-sm text-bad">{err("tenant_name")}</p>}
        </div>
        <button type="button" onClick={next} className="btn h-12 w-full text-base">
          ถัดไป
        </button>
      </div>

      {/* ---------- step 2 ---------- */}
      <div className={step === 2 ? "space-y-6" : "hidden"}>
        <div>
          <h1 className="text-[28px] font-semibold">ร้านของคุณเป็นแบบไหน</h1>
          <p className="mt-1.5 text-muted-foreground">ตอบให้ตรงกับร้าน ตัวเลขจะถูกต้องตั้งแต่วันแรก · แก้ภายหลังได้ที่ตั้งค่าร้าน</p>
        </div>
        <div>
          <label htmlFor="branch_name" className="label mb-1.5">สาขาแรกชื่ออะไร</label>
          <input id="branch_name" name="branch_name" defaultValue="สาขาหลัก" className="input h-12 w-full text-base" />
        </div>
        <fieldset className="space-y-2.5">
          <legend className="mb-2.5 font-semibold">ร้านจดทะเบียน VAT ไหม</legend>
          <div className="flex flex-wrap gap-2.5">
            <Choice name="is_vat_registered" value="yes" title="จดแล้ว" hint="ต้นทุนของไม่รวม VAT เพราะขอคืนได้" />
            <Choice name="is_vat_registered" value="no" title="ยังไม่จด" hint="VAT ที่จ่ายไปนับเป็นต้นทุนของ · รายได้เกิน ฿1.8 ล้าน/ปี ต้องจด" />
          </div>
          <Err state={state} name="is_vat_registered" />
        </fieldset>
        <fieldset className="space-y-2.5" onChange={(e) => setLate((e.target as HTMLInputElement).value === "yes")}>
          <legend className="mb-2.5 font-semibold">ร้านเปิดเลยเที่ยงคืนไหม</legend>
          <div className="flex flex-wrap gap-2.5">
            <Choice name="open_past_midnight" value="no" title="ปิดก่อนเที่ยงคืน" hint="ยอดของวันไหนก็เป็นของวันนั้น" />
            <Choice name="open_past_midnight" value="yes" title="เปิดเลยเที่ยงคืน" hint="บิลหลังเที่ยงคืนยังนับเป็นยอดของคืนนั้น" />
          </div>
          <Err state={state} name="open_past_midnight" />
          {late && (
            <div className="rounded-2xl border border-border bg-surface px-4 py-3.5">
              <label htmlFor="sales_day_cutoff" className="label mb-1.5">นับเป็นวันใหม่ตั้งแต่กี่โมง</label>
              <input id="sales_day_cutoff" name="sales_day_cutoff" type="time" min="00:00" max="12:00" defaultValue="05:00" className="input h-12 w-36 text-base tabular-nums" />
              <p className="mt-1.5 text-sm text-muted-foreground">บิลก่อนเวลานี้นับเป็นยอดของเมื่อวาน · ร้านปิดตีสอง ใช้ 05:00 ได้เลย</p>
            </div>
          )}
        </fieldset>
        {!state.ok && state.formError && <p className="text-sm text-bad">{state.formError}</p>}
        <div className="flex gap-2.5">
          <button type="button" onClick={() => setStep(1)} className="h-12 rounded-xl border border-border-strong bg-surface px-5 font-semibold text-primary hover:bg-muted">
            ย้อนกลับ
          </button>
          <button type="submit" disabled={pending} className="btn h-12 flex-1 text-base">
            {pending ? "กำลังสร้างร้าน…" : "สร้างร้าน"}
          </button>
        </div>
        {!signedInEmail && <p className="text-center text-sm text-muted-foreground">กดแล้วระบบจะส่งลิงก์เข้าสู่ระบบไปที่อีเมลของคุณ</p>}
      </div>
    </form>
  );
}
