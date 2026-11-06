// ============================================================
// คิดครัว — หน้าแรก (Kong 2026-10-30: "ต่อข้อ 6 หน้าแรกเลย")
// ============================================================
// The design Kong liked — mockup https://claude.ai/artifact/CGi4XVy5QJqDUw9qoW3HJC
// (v2: "ส่วนตัวดีไซน์ ถือว่าดีใช้ได้ ชอบเลยล่ะ") — with its words held to what
// the system does today (see content.ts). Every picture is a real screen of the
// demo shop, captured 2026-10-30 (again 2026-11-02, after the menu changed) with
// the owner's address and name, the admin button and a real chain's code and
// phone number taken out. วิธีใช้งาน (six sections, 2026-11-02) is HowItWorks.tsx.
//
// What changed from the mockup, and why: the นัดสาธิต form and every promise
// around it (a team, a call back within a day, 30 minutes) are gone — nobody
// keeps them yet (Kong: "ไม่งั้นมันจะกลายเป็นการหลอกลวงลูกค้า"). The page leads to
// signup; "ขอเดโม" arrives with the guided tour, later.
//
// 2026-11-06 (Kong "ทำหน้าแรกต่อเลย"): ไม่ใช่ POS — a strip in the hero and its own
// section right after it (mockup WbpsYxAgy9YPi5C95UrErL) — and Deltafood ideas
// 1–4 (DMzmUZXLrnrc8BFR1RXqB6): the floating capsule header, shop types, the
// three promises as cards with a real screen each, and ฟังดูคุ้นไหม → คิดครัว.
// ============================================================

import "./_landing/landing.css";
import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { BENTO, FEATURES, HERO_POS, NOT_POS_FACTS, NOT_POS_NODES, NOT_POS_STEPS, PAINS, SHOP_TYPES, START_STEPS, TRUST } from "./_landing/content";
import { Icon, Mark, Phrases, d } from "./_landing/parts";
import RoleTabs from "./_landing/RoleTabs";
import Faq from "./_landing/Faq";
import Motion from "./_landing/Motion";
import { DaySection, ExpenseSection, FlowSection, MoreSection, OnePlaceSection, RecipeSection } from "./_landing/HowItWorks";

export default async function HomePage() {
  const session = await auth();
  // Signed in already: the landing page is for visitors.
  if (session?.user) redirect("/home");

  return (
    <div className="lp">
      <Motion />

      <header className="lp-hdr" id="lp-hdr">
        <div className="lp-wrap">
          <div className="lp-capsule">
            <a href="#top" className="lp-brand" aria-label="คิดครัว">
              <Mark />
              คิดครัว
            </a>
            <nav className="lp-nav" aria-label="เมนูหลัก">
              <a href="#what">ฟีเจอร์</a>
              <a href="#day">วิธีใช้งาน</a>
              <a href="#roles">ทุกฝ่ายในร้าน</a>
              <a href="#faq">คำถามที่พบบ่อย</a>
            </nav>
            <div className="lp-hdr-right">
              <Link href="/login" className="lp-login">
                เข้าสู่ระบบ
              </Link>
              <Link href="/signup" className="lp-btn lp-btn-sm lp-btn-start">
                เริ่มใช้งาน
              </Link>
            </div>
          </div>
        </div>
      </header>

      <section className="lp-hero" id="top">
        <div className="lp-wrap">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow lp-rv" style={d(0.05)}>
              ระบบหลังร้านสำหรับร้านอาหาร
            </p>
            <h1 className="lp-lines">
              <span className="lp-line">
                <span style={d(0.12)}>
                  <Phrases t="ขายได้เท่านี้" />
                </span>
              </span>
              <span className="lp-line">
                <span style={d(0.24)}>
                  <Phrases t="เหลือกำไรเท่าไร" />
                </span>
              </span>
            </h1>
            <p className="lp-sub lp-rv" style={d(0.4)}>
              <Phrases t="คิดครัวรวมยอดขายจากไฟล์ POS บิลซื้อ และการนับสต็อก ให้เห็นต้นทุนและกำไรของร้านทุกเดือน · เริ่มได้แม้ยังไม่มีสูตรอาหาร" />
            </p>
            <ul className="lp-poschips lp-rv" style={d(0.46)} aria-label="ใช้กับ POS ที่ร้านมีอยู่">
              {HERO_POS.map(([icon, t]) => (
                <li key={t}>
                  <Icon k={icon} />
                  {t}
                </li>
              ))}
            </ul>
            <div className="lp-ctas lp-rv" style={d(0.52)}>
              <Link href="/signup" className="lp-btn lp-btn-cream">
                เริ่มใช้งาน <span className="lp-arr">→</span>
              </Link>
              <a href="#what" className="lp-btn lp-btn-ghost">
                ดูว่าทำอะไรได้บ้าง
              </a>
            </div>
            <p className="lp-fine lp-rv" style={d(0.62)}>
              สมัครด้วยอีเมล เข้าระบบด้วยลิงก์ที่ส่งไปทางอีเมล ไม่ต้องจำรหัสผ่าน
            </p>
          </div>

          <div className="lp-stage-hero lp-rv-img" style={d(0.5)} id="lp-hero-stage">
            <div className="lp-browser">
              <div className="lp-bar" aria-hidden>
                <i />
                <i />
                <i />
              </div>
              <img src="/landing/sales-app.png" alt="หน้ายอดขายของร้านตัวอย่าง: ยอดขายเทียบเดือนก่อน และยอดขายรายวัน" width={1456} height={900} />
            </div>
            <div className="lp-phone" data-par="-0.10">
              <img src="/landing/catalog.png" alt="ใบขอซื้อบนมือถือ" width={780} height={1520} />
            </div>
            <div className="lp-float is-a" data-par="-0.16">
              <div className="lp-bob">
                <div className="lp-stat">
                  <div className="lp-k">
                    <Phrases t="ยอดขายเฉลี่ยต่อวัน" />
                  </div>
                  <div className="lp-v" data-count="30751" data-prefix="฿">
                    ฿30,751
                  </div>
                  <div className="lp-s">ก.ย. 69 · ร้านตัวอย่าง</div>
                </div>
              </div>
            </div>
            <div className="lp-float is-b" data-par="-0.08">
              <div className="lp-bob">
                <div className="lp-stat">
                  <div className="lp-k">
                    <Phrases t="ของที่นับแล้วหายไป" />
                  </div>
                  <div className="lp-v">
                    <span data-count="1.45" data-dec="2">
                      1.45
                    </span>
                    % <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>ของยอดขาย</span>
                  </div>
                  <span className="lp-chip">✓ ไม่เกินเป้า 2%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-notpos" id="not-pos">
        <div className="lp-wrap">
          <div className="lp-sec-head">
            <p className="lp-eyebrow lp-rv">ไม่ต้องเปลี่ยน POS</p>
            <h2 className="lp-lines">
              <span className="lp-line">
                <span>
                  <Phrases t="คิดครัวไม่ใช่ POS" />
                </span>
              </span>
              <span className="lp-line">
                <span style={d(0.1)}>
                  <Phrases t="ทำงานต่อจาก POS ที่ร้านใช้อยู่" />
                </span>
              </span>
            </h2>
            <p className="lp-how-lead lp-rv" style={d(0.2)}>
              <Phrases t="หน้าร้านขายและคิดเงินด้วยเครื่องเดิม คิดครัวดูแลหลังร้าน ตั้งแต่ซื้อของ สต็อก ไปจนถึงต้นทุนและกำไร โดยใช้ไฟล์ยอดขายที่ POS ส่งออกได้" />
            </p>
          </div>
          <div className="lp-pflow">
            {NOT_POS_NODES.map((n, i) => (
              <Fragment key={n.title}>
                {i > 0 ? (
                  <div className="lp-pstep lp-rv" style={d(0.1 + i * 0.16)} aria-hidden>
                    <Icon k="arrow" />
                    <span>{NOT_POS_STEPS[i - 1]}</span>
                  </div>
                ) : null}
                <div className={`lp-pnode lp-rv${n.kind ? ` is-${n.kind}` : ""}`} style={d(i * 0.16)}>
                  <span className="lp-pico">
                    <Icon k={n.icon} />
                  </span>
                  <span className="lp-pwhere">{n.where}</span>
                  <h3>{n.title}</h3>
                  <p>{n.body}</p>
                  {n.tag ? <span className="lp-ptag">{n.tag}</span> : null}
                </div>
              </Fragment>
            ))}
          </div>
          <div className="lp-pfacts">
            {NOT_POS_FACTS.map(([t, body], i) => (
              <div className="lp-pfact lp-rv" style={d(i * 0.08)} key={t}>
                <Icon k="check" />
                <b>{t}</b>
                <p>{body}</p>
              </div>
            ))}
          </div>
          <p className="lp-pneeds lp-rv">
            <b>สิ่งที่ต้องมี:</b> POS ที่ส่งออกไฟล์ยอดขายเป็น Excel หรือ CSV ได้
          </p>
          <div className="lp-types">
            <p className="lp-eyebrow lp-rv">ใช้ได้กับร้านแบบไหน</p>
            <ul>
              {SHOP_TYPES.map((t, i) => (
                <li className="lp-rv" style={d(0.05 + i * 0.05)} key={t}>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="lp-what" id="what">
        <div className="lp-wrap">
          <div className="lp-sec-head">
            <p className="lp-eyebrow lp-rv">ทำอะไรได้บ้าง</p>
            <h2 className="lp-lines">
              <span className="lp-line">
                <span>
                  <Phrases t="ตัวเลขที่เจ้าของร้านถามทุกเดือน" />
                </span>
              </span>
            </h2>
          </div>
          <div className="lp-bento">
            {BENTO.map((b, i) => (
              <a href={b.href} className={`lp-btile lp-rv${b.wide ? " is-wide" : ""}`} style={d((i % 2) * 0.08)} key={b.title}>
                <span className="lp-bshot">
                  <img src={b.img.src} alt={b.img.alt} loading="lazy" style={{ objectPosition: b.img.pos, transformOrigin: b.img.pos, ["--z" as string]: b.img.zoom }} />
                </span>
                <span className="lp-bbody">
                  <h3>
                    <Phrases t={b.title} />
                  </h3>
                  <span className="lp-bp">{b.body}</span>
                  <span className="lp-bfig">
                    <b>{b.fig}</b>
                    <span>{b.sub}</span>
                  </span>
                  <span className="lp-bmore">
                    {b.more} <span className="lp-arr">→</span>
                  </span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-dark lp-pains">
        <div className="lp-wrap">
          <div className="lp-sec-head">
            <p className="lp-eyebrow lp-rv">ฟังดูคุ้นไหม</p>
            <h2 className="lp-lines">
              <span className="lp-line">
                <span>
                  <Phrases t="ขายดี แต่ไม่รู้ว่าเงินหายไปไหน" />
                </span>
              </span>
            </h2>
          </div>
          <div className="lp-ptable">
            <div className="lp-phead" aria-hidden>
              <span>ตอนนี้</span>
              <span />
              <span>เมื่อใช้คิดครัว</span>
            </div>
            {PAINS.map(([pi, pain, fi, fix], i) => (
              <div className="lp-prow lp-rv" style={d(i * 0.06)} key={pain}>
                <div className="lp-pain">
                  <span className="lp-pdot">
                    <Icon k={pi} />
                  </span>
                  <span>{pain}</span>
                </div>
                <span className="lp-parr" aria-hidden>
                  <Icon k="arrow" />
                </span>
                <div className="lp-fix">
                  <span className="lp-pdot">
                    <Icon k={fi} />
                  </span>
                  <span>{fix}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FlowSection />
      <RecipeSection />

      <section className="lp-features" id="features">
        <div className="lp-wrap lp-sec-head">
          <p className="lp-eyebrow lp-rv">ฟีเจอร์หลัก</p>
          <h2 className="lp-lines">
            <span className="lp-line">
              <span>
                <Phrases t="ไม่ได้มีแค่ตัวเลข" />
              </span>
            </span>
            <span className="lp-line">
              <span style={d(0.1)}>
                <Phrases t="แต่ชี้ว่ามาจากไหน และตรงไหนน่าสังเกต" />
              </span>
            </span>
          </h2>
        </div>
        {FEATURES.map((f, i) => {
          const flip = i % 2 === 1;
          return (
            <div className={flip ? "lp-band" : undefined} id={f.id} key={f.tag}>
              <div className="lp-wrap">
                <article className={`lp-feat ${flip ? "is-flip" : ""}`}>
                  <div className="lp-copy">
                    <span className="lp-tag lp-rv">
                      <i />
                      {f.tag}
                    </span>
                    <h3 className="lp-rv" style={d(0.06)}>
                      <Phrases t={f.title} />
                    </h3>
                    <p className="lp-feat-body lp-rv" style={d(0.12)}>
                      {f.body}
                    </p>
                    <ul className="lp-points">
                      {f.points.map(([icon, head, sub], j) => (
                        <li className="lp-rv" style={d(0.18 + j * 0.08)} key={head}>
                          <span className="lp-ic">
                            <Icon k={icon} />
                          </span>
                          <span>
                            <b>{head}</b>
                            <span>{sub}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="lp-stage lp-rv-img" style={d(0.1)}>
                    <div className="lp-shot">
                      <img src={f.img.src} width={f.img.w} height={f.img.h} alt={f.img.alt} loading="lazy" />
                    </div>
                    <div className={`lp-callout at-${f.callout.at}`}>
                      <div className="lp-t">
                        {f.callout.star && <span className="lp-star">★ </span>}
                        <Phrases t={f.callout.title} />
                        {f.callout.up && <span className="lp-up"> {f.callout.up}</span>}
                      </div>
                      <div className="lp-s">{f.callout.sub}</div>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          );
        })}
      </section>

      <ExpenseSection />
      <DaySection />

      <section className="lp-dark lp-roles" id="roles">
        <div className="lp-wrap">
          <div className="lp-head">
            <p className="lp-eyebrow lp-rv">ทุกฝ่ายในร้าน</p>
            <h2 className="lp-lines">
              <span className="lp-line">
                <span>
                  <Phrases t="ทุกฝ่ายทำงานในระบบเดียวกัน" />
                </span>
              </span>
              <span className="lp-line">
                <span style={d(0.1)}>
                  <Phrases t="แต่ละคนเห็นเฉพาะงานที่รับผิดชอบ" />
                </span>
              </span>
            </h2>
            <p className="lp-rv" style={d(0.2)}>
              ครัวขอซื้อวัตถุดิบ ฝ่ายจัดซื้อออกใบสั่งซื้อ ฝ่ายบัญชีดูแลค่าใช้จ่าย และเจ้าของร้านดูกำไร ส่วนตัวเลขต้นทุนและกำไร เห็นเฉพาะคนที่เจ้าของร้านให้สิทธิ์
            </p>
          </div>
          <div className="lp-rgrid lp-rv" style={d(0.25)}>
            <RoleTabs />
          </div>
        </div>
      </section>

      <OnePlaceSection />
      <MoreSection />

      <section className="lp-trust">
        <div className="lp-wrap">
          <div className="lp-sec-head">
            <p className="lp-eyebrow lp-rv">ความน่าเชื่อถือของตัวเลข</p>
            <h2 className="lp-lines">
              <span className="lp-line">
                <span>
                  <Phrases t="ตัวเลขที่เชื่อได้" />
                </span>
              </span>
              <span className="lp-line">
                <span style={d(0.1)}>
                  <Phrases t="เพราะบอกเสมอว่าข้อมูลครบแค่ไหน" />
                </span>
              </span>
            </h2>
          </div>
          <div className="lp-tgrid">
            {TRUST.map(([icon, title, body], i) => (
              <div className="lp-tcard lp-rv" style={d((i % 2) * 0.08)} key={title}>
                <span className="lp-ic">
                  <Icon k={icon} />
                </span>
                <h3>
                  <Phrases t={title} />
                </h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-faq" id="faq">
        <div className="lp-wrap">
          <div className="lp-sec-head">
            <p className="lp-eyebrow lp-rv">คำถามที่พบบ่อย</p>
            <h2 className="lp-lines">
              <span className="lp-line">
                <span>
                  <Phrases t="ก่อนเริ่มใช้งาน ร้านมักถามเรื่องเหล่านี้" />
                </span>
              </span>
            </h2>
          </div>
          <Faq />
        </div>
      </section>

      <section className="lp-dark lp-start" id="start">
        <div className="lp-wrap">
          <p className="lp-eyebrow lp-rv">เริ่มใช้งาน</p>
          <h2 className="lp-lines">
            <span className="lp-line">
              <span>
                <Phrases t="เริ่มจากร้านเดียว สาขาเดียวก็ได้" />
              </span>
            </span>
          </h2>
          <p className="lp-lead lp-rv" style={d(0.15)}>
            <Phrases t="สมัครด้วยอีเมล แล้วทำตามขั้นตอนบนแดชบอร์ดทีละข้อ" />
          </p>
          <ol className="lp-steps">
            {START_STEPS.map((s, i) => (
              <li className="lp-rv" style={d(0.2 + i * 0.08)} key={s}>
                <span className="lp-n">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <Link href="/signup" className="lp-btn lp-btn-cream lp-rv" style={{ ...d(0.45), height: 54, padding: "0 28px", fontSize: 17, borderRadius: 16 }}>
            เริ่มใช้งาน <span className="lp-arr">→</span>
          </Link>
          <p className="lp-alt lp-rv" style={d(0.5)}>
            มีบัญชีแล้ว? <Link href="/login">เข้าสู่ระบบ</Link>
          </p>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <span className="lp-brand" style={{ fontSize: 16, color: "var(--olive)" }}>
            <Mark size={26} ink="#41431B" />
            คิดครัว · KitKrua
          </span>
          <span className="lp-links">
            <a href="#what">ฟีเจอร์</a>
            <a href="#day">วิธีใช้งาน</a>
            <a href="#faq">คำถามที่พบบ่อย</a>
            <Link href="/login">เข้าสู่ระบบ</Link>
          </span>
          <span>ภาพหน้าจอทั้งหมดใช้ข้อมูลร้านตัวอย่าง ไม่ใช่ข้อมูลร้านจริง · ตัวเลขในแผนภาพเป็นตัวอย่างประกอบ · © 2569 คิดครัว</span>
        </div>
      </footer>
    </div>
  );
}
