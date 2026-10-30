// ============================================================
// คิดครัว — หน้าแรก (Kong 2026-10-30: "ต่อข้อ 6 หน้าแรกเลย")
// ============================================================
// The design Kong liked — mockup https://claude.ai/artifact/CGi4XVy5QJqDUw9qoW3HJC
// (v2: "ส่วนตัวดีไซน์ ถือว่าดีใช้ได้ ชอบเลยล่ะ") — with its words held to what
// the system does today (see content.ts). Every picture is a real screen of the
// demo shop, captured 2026-10-30 with the owner's address, the admin button and
// a real chain's code and phone number taken out.
//
// What changed from the mockup, and why: the นัดสาธิต form and every promise
// around it (a team, a call back within a day, 30 minutes) are gone — nobody
// keeps them yet (Kong: "ไม่งั้นมันจะกลายเป็นการหลอกลวงลูกค้า"). The page leads to
// signup; "ขอเดโม" arrives with the guided tour, later.
// ============================================================

import "./_landing/landing.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FEATURES, PROMISES, START_STEPS, TRUST } from "./_landing/content";
import { Icon, Mark, Phrases, d } from "./_landing/parts";
import RoleTabs from "./_landing/RoleTabs";
import Faq from "./_landing/Faq";
import Motion from "./_landing/Motion";

export default async function HomePage() {
  const session = await auth();
  // Signed in already: the landing page is for visitors.
  if (session?.user) redirect("/home");

  return (
    <div className="lp">
      <Motion />

      <header className="lp-hdr" id="lp-hdr">
        <div className="lp-wrap">
          <a href="#top" className="lp-brand" aria-label="คิดครัว">
            <Mark />
            คิดครัว
          </a>
          <nav className="lp-nav" aria-label="เมนูหลัก">
            <a href="#features">ฟังก์ชัน</a>
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
                  <Phrases t="ยอดขาย ต้นทุน และกำไรของร้านคุณ" />
                </span>
              </span>
              <span className="lp-line">
                <span style={d(0.24)}>
                  <Phrases t="ครบในระบบเดียว" />
                </span>
              </span>
            </h1>
            <p className="lp-sub lp-rv" style={d(0.4)}>
              นำเข้ายอดขายจากไฟล์ของเครื่อง POS ที่ใช้อยู่ ไม่ต้องเปลี่ยนเครื่อง และเริ่มใช้ได้แม้ยังไม่มีสูตรอาหาร
            </p>
            <div className="lp-ctas lp-rv" style={d(0.52)}>
              <Link href="/signup" className="lp-btn lp-btn-cream">
                เริ่มใช้งาน <span className="lp-arr">→</span>
              </Link>
              <a href="#features" className="lp-btn lp-btn-ghost">
                ดูว่าทำอะไรได้บ้าง
              </a>
            </div>
            <p className="lp-fine lp-rv" style={d(0.62)}>
              สมัครด้วยอีเมล และเข้าสู่ระบบด้วยลิงก์ ไม่ต้องตั้งรหัสผ่าน
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
                    <Phrases t="ของหายจากการนับสต๊อก" />
                  </div>
                  <div className="lp-v">
                    <span data-count="1.45" data-dec="2">
                      1.45
                    </span>
                    % <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>ของยอดขาย</span>
                  </div>
                  <span className="lp-chip">✓ อยู่ในเป้า ≤ 2%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-promise">
        <div className="lp-wrap">
          <div className="lp-grid">
            {PROMISES.map((p, i) => (
              <div className="lp-item lp-rv" style={d(i * 0.12)} key={p.title}>
                <div className="lp-rule" style={d(0.1 + i * 0.12)} />
                <span className="lp-num">0{i + 1}</span>
                <h3>
                  <Phrases t={p.title} />
                </h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-features" id="features">
        <div className="lp-wrap lp-sec-head">
          <p className="lp-eyebrow lp-rv">ฟังก์ชันหลัก</p>
          <h2 className="lp-lines">
            <span className="lp-line">
              <span>
                <Phrases t="ไม่ได้บอกแค่ตัวเลข" />
              </span>
            </span>
            <span className="lp-line">
              <span style={d(0.1)}>
                <Phrases t="แต่ชี้ให้เห็นว่าเกิดจากอะไร และจุดไหนน่าสังเกต" />
              </span>
            </span>
          </h2>
        </div>
        {FEATURES.map((f, i) => {
          const flip = i % 2 === 1;
          return (
            <div className={flip ? "lp-band" : undefined} key={f.tag}>
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
              ครัวขอซื้อวัตถุดิบ ฝ่ายจัดซื้อออกใบสั่งซื้อ ฝ่ายบัญชีดูแลค่าใช้จ่าย และเจ้าของร้านดูกำไร โดยตัวเลขต้นทุนและกำไรแสดงเฉพาะคนที่ได้รับสิทธิ์
            </p>
          </div>
          <div className="lp-rgrid lp-rv" style={d(0.25)}>
            <RoleTabs />
          </div>
        </div>
      </section>

      <section className="lp-trust">
        <div className="lp-wrap">
          <div className="lp-sec-head">
            <p className="lp-eyebrow lp-rv">ความน่าเชื่อถือของตัวเลข</p>
            <h2 className="lp-lines">
              <span className="lp-line">
                <span>
                  <Phrases t="ตัวเลขที่ถูกต้อง" />
                </span>
              </span>
              <span className="lp-line">
                <span style={d(0.1)}>
                  <Phrases t="และบอกเสมอว่าข้อมูลครบแค่ไหน" />
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
            <Phrases t="สมัครด้วยอีเมล แล้วทำตามขั้นตอน ในแดชบอร์ดทีละข้อ" />
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
            <a href="#features">ฟังก์ชัน</a>
            <a href="#faq">คำถามที่พบบ่อย</a>
            <Link href="/login">เข้าสู่ระบบ</Link>
          </span>
          <span>ภาพหน้าจอทั้งหมดเป็นข้อมูลจากร้านตัวอย่าง · © 2569 คิดครัว</span>
        </div>
      </footer>
    </div>
  );
}
