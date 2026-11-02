// ============================================================
// คิดครัว — หน้าแรก: วิธีใช้งาน (Kong 2026-11-02)
// ============================================================
// Six sections, mockup https://claude.ai/artifact/EV99SYahxAp4pAAao2AXiB, both
// questions answered "ก": all six in the mockup's order, and real phone screens
// of the demo shop in วันหนึ่งของร้าน. The words live in content.ts.
//
// One change from the mockup: ข้อมูลอยู่ที่เดียว sat on a dark band right after
// ทุกฝ่ายในร้าน, which is dark too, and the two read as one block. It keeps its
// dark cards on a light page instead.
//
// Server-safe: no "use client". Movement comes from Motion.tsx, which already
// watches every .lp-rv and .lp-lines on the page.
// ============================================================

import type { ReactNode } from "react";
import { CHAIN, DAY_PERIODIC, DAY_SLOTS, FLOW_HUB, FLOW_IN, FLOW_OUT, LADDER, MORE, ONE_PLACE } from "./content";
import { Icon, Mark, Phrases, d } from "./parts";

function Head({ eyebrow, lines, lead }: { eyebrow: string; lines: string[]; lead?: string }) {
  return (
    <div className="lp-sec-head">
      <p className="lp-eyebrow lp-rv">{eyebrow}</p>
      <h2 className="lp-lines">
        {lines.map((l, i) => (
          <span className="lp-line" key={l}>
            <span style={d(i * 0.1)}>
              <Phrases t={l} />
            </span>
          </span>
        ))}
      </h2>
      {lead ? (
        <p className="lp-how-lead lp-rv" style={d(0.2)}>
          <Phrases t={lead} />
        </p>
      ) : null}
    </div>
  );
}

const Rows = ({ rows, cls }: { rows: [string, string][]; cls?: (i: number) => string }) => (
  <div className="lp-tbl">
    {rows.map(([k, v], i) => (
      <div className={cls?.(i)} key={k}>
        <span>{k}</span>
        <b>{v}</b>
      </div>
    ))}
  </div>
);

// ---------- 1 · ตัวเลขมาจากไหน ----------
export function FlowSection() {
  return (
    <section className="lp-how lp-how-sec" id="flow">
      <div className="lp-wrap">
        <Head
          eyebrow="ตัวเลขมาจากไหน"
          lines={["ร้านทำงานตามปกติ", "คิดครัวรวมให้เป็นตัวเลข"]}
          lead="ทุกตัวเลขมาจากงานที่ร้านทำอยู่แล้ว ทั้งขาย ซื้อ จ่าย และนับ · คนทำงานกรอกที่หน้างาน เจ้าของเปิดดูผลได้ทันที"
        />
        <div className="lp-flow">
          <div className="lp-rv">
            <p className="lp-col-h">
              <b>1</b>งานที่ร้านทำ
            </p>
            <div className="lp-srcs">
              {FLOW_IN.map((s) => (
                <div className={`lp-src${s.once ? " is-once" : ""}`} key={s.title}>
                  <span className="lp-hic">
                    <Icon k={s.icon} className="lp-i" />
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  <span className="lp-who">{s.who}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="lp-arrow" aria-hidden>
            <span className="lp-rail" />
          </div>
          <div className="lp-rv" style={d(0.12)}>
            <p className="lp-col-h">
              <b>2</b>คิดครัวคิดให้
            </p>
            <div className="lp-hub">
              <p className="lp-hub-brand">
                <Mark size={30} ink="#F8F3E1" />
                คิดครัว
              </p>
              <ul>
                {FLOW_HUB.map((t) => (
                  <li key={t}>
                    <Icon k="check" className="lp-i" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="lp-arrow" aria-hidden>
            <span className="lp-rail" />
          </div>
          <div className="lp-rv" style={d(0.24)}>
            <p className="lp-col-h">
              <b>3</b>ตัวเลขที่ได้
            </p>
            <div className="lp-outs">
              {FLOW_OUT.map(([icon, t]) => (
                <div className="lp-out" key={t}>
                  <span className="lp-hic is-clay">
                    <Icon k={icon} className="lp-i" />
                  </span>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="lp-how-foot lp-rv">ข้อมูลส่วนไหนยังไม่ครบ ตัวเลขที่ได้จะบอกว่าขาดอะไร ไม่เดาแทน</p>
      </div>
    </section>
  );
}

// ---------- 2 · ตัดสต๊อกตามสูตร ----------
function Step({ n, title, cap, last, children, delay }: { n: string; title: string; cap?: string; last?: boolean; children: ReactNode; delay: number }) {
  return (
    <div className="lp-st lp-rv" style={d(delay)}>
      <span className="lp-st-n">{n}</span>
      <h3>{title}</h3>
      {children}
      {cap ? <p className="lp-st-cap">{cap}</p> : null}
      {last ? null : (
        <span className="lp-st-go" aria-hidden>
          <Icon k="arrow" className="lp-i" />
        </span>
      )}
    </div>
  );
}

export function RecipeSection() {
  return (
    <section className="lp-how lp-how-sec lp-dark lp-recipe" id="recipe">
      <div className="lp-wrap">
        <Head
          eyebrow="ตัดสต๊อกตามสูตร"
          lines={["ขายไปกี่จาน", "สต๊อกลดให้เองตามสูตร"]}
          lead="นำเข้าไฟล์ยอดขายแล้ว ระบบคูณจำนวนจานกับสูตร แล้วหักวัตถุดิบออกจากสต๊อกให้ทันที ไม่ต้องจดว่าใช้อะไรไปเท่าไร"
        />
        <div className="lp-steps4">
          <Step n="① ไฟล์ยอดขายจาก POS" title="ขายไปเท่าไร" cap="วันที่ 14 · สาขาอารีย์" delay={0}>
            <Rows rows={[["ผัดกะเพราหมูสับ", "120 จาน"], ["ข้าวผัดกุ้ง", "64 จาน"], ["ต้มยำกุ้งน้ำข้น", "38 ชาม"]]} cls={(i) => (i === 0 ? "is-hl" : "")} />
          </Step>
          <Step n="② สูตรต่อ 1 จาน" title="ผัดกะเพราหมูสับ" cap="ตั้งครั้งเดียว แก้เมื่อไรก็มีผลตั้งแต่วันนั้น" delay={0.1}>
            <Rows rows={[["หมูสับ", "100 ก."], ["ใบกะเพรา", "10 ก."], ["พริกขี้หนู", "5 ก."], ["กระเทียม", "8 ก."]]} />
          </Step>
          <Step n="③ สต๊อกลดให้เอง" title="120 จาน × สูตร" cap="ทันทีที่นำเข้าไฟล์ ไม่ต้องกดอะไรเพิ่ม" delay={0.2}>
            <Rows rows={[["หมูสับ", "−12 กก."], ["ใบกะเพรา", "−1.2 กก."], ["พริกขี้หนู", "−0.6 กก."], ["กระเทียม", "−0.96 กก."]]} cls={() => "is-minus"} />
          </Step>
          <Step n="④ นับจริงแล้วเทียบ" title="หมูสับ" last delay={0.3}>
            <Rows rows={[["ระบบบอกว่าควรเหลือ", "4.0 กก."], ["นับได้จริง", "3.4 กก."]]} />
            <div className="lp-verdict">
              <span>หายไป 0.6 กก.</span>
              <p className="lp-verdict-big">≈ ฿96</p>
              <span>ขึ้นที่หน้า ของหายไปไหน เรียงจากมากไปน้อย</span>
            </div>
          </Step>
        </div>
        <div className="lp-notes3">
          <div className="lp-rv">
            <Icon k="pot" className="lp-i" />
            <span>
              <b>ของที่ครัวทำเอง</b> เช่น น้ำซุป หมูหมัก มีสูตรของตัวเอง ระบบตัดวัตถุดิบต่อให้อีกชั้น
            </span>
          </div>
          <div className="lp-rv" style={d(0.08)}>
            <Icon k="gauge" className="lp-i" />
            <span>
              <b>เมนูที่ยังไม่มีสูตร</b> ระบบบอกว่าตัดสต๊อกได้กี่ % ของยอดขาย ไม่ทำเหมือนว่าครบ
            </span>
          </div>
          <div className="lp-rv" style={d(0.16)}>
            <Icon k="count" className="lp-i" />
            <span>
              <b>ยังไม่มีสูตรเลย?</b> นับสต๊อกต้นเดือนกับปลายเดือน ก็รู้กำไรรายเดือนได้
            </span>
          </div>
        </div>
        <p className="lp-how-note">ตัวเลขในแผนภาพเป็นตัวอย่างประกอบ</p>
      </div>
    </section>
  );
}

// ---------- 3 · บันทึกรายจ่าย ----------
function ExpenseCard({ title, body, children, delay }: { title: string; body: string; children: ReactNode; delay: number }) {
  return (
    <div className="lp-ec lp-rv" style={d(delay)}>
      <div className="lp-mini" aria-hidden>
        {children}
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export function ExpenseSection() {
  return (
    <section className="lp-how lp-how-sec lp-band" id="expenses">
      <div className="lp-wrap">
        <Head
          eyebrow="บันทึกรายจ่าย"
          lines={["รายจ่ายส่วนใหญ่", "ไม่ต้องพิมพ์เอง"]}
          lead="บิลค่าวัตถุดิบเกิดจากใบรับสินค้า บิลประจำตั้งครั้งเดียว ส่วนเงินที่พนักงานออกไปก่อน ถ่ายรูปบิลส่งจากมือถือ"
        />
        <div className="lp-cards4">
          <ExpenseCard title="รับของแล้ว บิลขึ้นเอง" body="ยืนยันใบรับสินค้า แล้วบิลค่าวัตถุดิบพร้อม VAT ถูกสร้างให้ทันที" delay={0}>
            <div className="lp-doc">
              <div className="lp-doc-t">
                <span>ใบรับสินค้า</span>
                <b>฿4,820</b>
              </div>
              <span>ตลาดไท · หมูสับ ผัก เครื่องปรุง</span>
            </div>
            <span className="lp-down">
              <Icon k="down" className="lp-i" />
              ยืนยันแล้ว สร้างให้เอง
            </span>
            <div className="lp-doc is-auto">
              <div className="lp-doc-t">
                <span>บิลค่าวัตถุดิบ</span>
                <b>฿4,820</b>
              </div>
              <span>VAT แยกให้แล้ว · ไม่ต้องคีย์ซ้ำ</span>
            </div>
          </ExpenseCard>
          <ExpenseCard title="บิลประจำ ตั้งครั้งเดียว" body="ค่าเช่า ค่าไฟ ค่าน้ำ ตั้งไว้ครั้งเดียว ถึงกำหนดแล้วยังไม่บันทึก แดชบอร์ดเตือนให้" delay={0.08}>
            <div className="lp-rec">
              <span>
                ค่าเช่าร้าน<small>ทุกวันที่ 1</small>
              </span>
              <span className="lp-pill is-good">
                <Icon k="check" className="lp-i" />
                บันทึกแล้ว
              </span>
            </div>
            <div className="lp-rec">
              <span>
                ค่าไฟ<small>ทุกวันที่ 25</small>
              </span>
              <span className="lp-pill is-clay">
                <Icon k="bell" className="lp-i" />
                ถึงกำหนดแล้ว
              </span>
            </div>
            <div className="lp-rec">
              <span>
                ค่าน้ำ<small>ทุกวันที่ 28</small>
              </span>
              <span className="lp-pill">อีก 3 วัน</span>
            </div>
          </ExpenseCard>
          <ExpenseCard title="พนักงานออกเงินไปก่อน" body="ถ่ายรูปบิลส่งจากมือถือ เจ้าของกดอนุมัติแล้วคืนเงิน เห็นได้ตลอดว่าค้างคืนใครเท่าไร" delay={0.16}>
            <div className="lp-ph">
              <span className="lp-ph-pic">
                <Icon k="camera" className="lp-i" />
              </span>
              <span>
                <b>฿350</b>
                <small>ซื้อน้ำแข็ง · ร้านข้างตลาด</small>
              </span>
            </div>
            <div className="lp-pills">
              <span className="lp-pill">รออนุมัติ</span>
              <span className="lp-pill">รอคืนเงิน</span>
              <span className="lp-pill is-good">คืนแล้ว</span>
            </div>
          </ExpenseCard>
          <ExpenseCard title="บิลย้อนหลังหลายเดือน" body="ให้ AI ที่ร้านใช้อยู่ทำไฟล์จากบิล แล้วนำเข้าทีเดียว ทุกแถวขึ้นให้ตรวจก่อนบันทึก" delay={0.24}>
            <div className="lp-ai">
              <div>
                <Icon k="spark" className="lp-i is-gold" />
                AI ของร้านทำไฟล์จากบิล
              </div>
              <div>
                <b>✓</b>ม.ค.–มี.ค. · 46 ใบ · ตรวจทีละแถว
              </div>
              <div>
                <b>✓</b>นำเข้าทีเดียว
              </div>
            </div>
          </ExpenseCard>
        </div>
        <p className="lp-how-foot lp-rv">ทุกบิลไปรวมที่หน้าวิเคราะห์รายจ่าย แยกตามหมวดและผู้ขาย กดดูได้ถึงบิลทีละใบ</p>
      </div>
    </section>
  );
}

// ---------- 4 · วันหนึ่งของร้าน ----------
/** The demo shop had no open round to cut, so this one slot is drawn, not photographed. */
function CutDrawing() {
  return (
    <div className="lp-cut" role="img" aria-label="ใบขอซื้อจากหลายแผนก รวมเป็นใบสั่งซื้อแยกตามผู้ขาย">
      <p className="lp-cut-h">ใบขอซื้อที่ค้าง</p>
      <span className="lp-cut-req">ครัว · หมูสับ 5 กก.</span>
      <span className="lp-cut-req">ครัว · หมูสามชั้น 3 กก.</span>
      <span className="lp-cut-req">บาร์ · มะนาว 2 กก.</span>
      <span className="lp-cut-arrow">
        <Icon k="down" className="lp-i" />
        ตัดรอบ
      </span>
      <span className="lp-cut-po">
        <b>ใบสั่งซื้อ</b>ฟาร์มหมู · 2 รายการ
      </span>
      <span className="lp-cut-po">
        <b>ใบสั่งซื้อ</b>ตลาดผลไม้ · 1 รายการ
      </span>
    </div>
  );
}

export function DaySection() {
  return (
    <section className="lp-how lp-how-sec" id="day">
      <div className="lp-wrap">
        <Head
          eyebrow="งานประจำวัน"
          lines={["วันหนึ่งของร้าน", "ที่ใช้คิดครัว"]}
          lead="งานส่วนใหญ่คืองานที่ร้านทำอยู่แล้ว แค่เปลี่ยนจากกระดาษมาเป็นมือถือ · แต่ละคนเห็นเฉพาะงานของตัวเอง"
        />
        <ol className="lp-day">
          {DAY_SLOTS.map((s, i) => (
            <li className={`lp-slot lp-rv${s.owner ? " is-owner" : ""}`} style={d(i * 0.08)} key={s.when}>
              <div className="lp-slot-pic">
                {s.pic ? <img src={s.pic.src} alt={s.pic.alt} width={780} height={1520} loading="lazy" /> : <CutDrawing />}
              </div>
              <div className="lp-slot-txt">
                <p className="lp-when">
                  <span className="lp-dot">
                    <Icon k={s.icon} className="lp-i" />
                  </span>
                  {s.when}
                </p>
                <span className="lp-pill">{s.who}</span>
                <p>{s.body}</p>
                <p className="lp-res">
                  <Icon k="check" className="lp-i" />
                  {s.result}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className="lp-periodic">
          {DAY_PERIODIC.map(([icon, head, body], i) => (
            <div className="lp-rv" style={d(i * 0.08)} key={head}>
              <Icon k={icon} className="lp-i" />
              <span>
                <b>{head}</b>
                {body}
              </span>
            </div>
          ))}
        </div>
        <div className="lp-ladder lp-rv">
          <div>
            <h3>
              <Phrases t="ไม่ต้องใช้ครบตั้งแต่วันแรก" />
            </h3>
            <p className="lp-ladder-sub">เริ่มจากสิ่งที่ร้านมีอยู่แล้ว แล้วค่อยเพิ่มเมื่อพร้อม · ทุกขั้นได้ตัวเลขที่ใช้ได้จริง</p>
          </div>
          <ol className="lp-rungs">
            {LADDER.map((r, i) => (
              <li className="lp-rung" key={r.title}>
                <span className="lp-rung-k">ขั้นที่ {i + 1}</span>
                <h4>{r.title}</h4>
                <p className="lp-rung-do">{r.does}</p>
                <p className="lp-rung-get">
                  <Icon k="check" className="lp-i" />
                  {r.gets}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ---------- 5 · ข้อมูลอยู่ที่เดียว ----------
export function OnePlaceSection() {
  return (
    <section className="lp-how lp-how-sec" id="one-place">
      <div className="lp-wrap">
        <Head
          eyebrow="ข้อมูลอยู่ที่เดียว"
          lines={["ราคาที่จ่ายครั้งเดียว", "ไปถึงทุกตัวเลขเอง"]}
          lead="ไม่มี Excel หลายไฟล์ที่ตัวเลขไม่ตรงกัน · ราคาจากใบรับสินค้าถูกใช้ต่อในสต๊อก ต้นทุนเมนู กำไร และไฟล์ปิดเดือน"
        />
        <ol className="lp-chain">
          {CHAIN.map(([icon, k, v, p], i) => (
            <li className="lp-lk lp-rv" style={d(i * 0.08)} key={k}>
              <span className="lp-lk-k">
                <Icon k={icon} className="lp-i" />
                {k}
              </span>
              <span className="lp-lk-v">{v}</span>
              <p>{p}</p>
            </li>
          ))}
        </ol>
        <p className="lp-how-note is-light">ตัวเลขในแผนภาพเป็นตัวอย่างประกอบ</p>
        <div className="lp-mgmt">
          <div className="lp-tree lp-rv" role="img" aria-label="ตัวอย่าง บัญชีเดียว สองร้าน สามสาขา">
            <div className="lp-acct">
              <span className="lp-av">ค</span>
              <span>
                บัญชีเจ้าของ<small>อีเมลเดียว เข้าได้ทุกร้าน</small>
              </span>
            </div>
            <div className="lp-shops">
              <div className="lp-shop">
                <div className="lp-shop-nm">
                  ครัวคุณแม่<small>2 สาขา</small>
                </div>
                <div className="lp-brs">
                  <span>สาขาอารีย์</span>
                  <span>สาขาลาดพร้าว</span>
                </div>
                <p className="lp-xfer">
                  <Icon k="swap" className="lp-i" />
                  โอนของระหว่างสาขา ต้นทุนตามไปด้วย
                </p>
              </div>
              <div className="lp-shop">
                <div className="lp-shop-nm">
                  ส้มตำนัวนัว<small>1 สาขา</small>
                </div>
                <div className="lp-brs">
                  <span>สาขาหลัก</span>
                </div>
                <p className="lp-xfer">
                  <Icon k="shield" className="lp-i" />
                  เมนู สูตร ตัวเลข แยกจากร้านแรกทั้งหมด
                </p>
              </div>
            </div>
          </div>
          <div className="lp-rv" style={d(0.1)}>
            <h3 className="lp-mgmt-h">
              <Phrases t="ทุกสาขา ทุกร้าน ในบัญชีเดียว" />
            </h3>
            <ul className="lp-mpoints">
              {ONE_PLACE.map(([icon, head, body]) => (
                <li key={head}>
                  <span className="lp-hic">
                    <Icon k={icon} className="lp-i" />
                  </span>
                  <span>
                    <b>{head}</b>
                    <span>{body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- 6 · ทำอะไรได้อีก ----------
export function MoreSection() {
  return (
    <section className="lp-how lp-how-sec lp-band" id="more">
      <div className="lp-wrap">
        <Head eyebrow="ทำอะไรได้อีก" lines={["เรื่องเล็ก ๆ ที่ร้านอาหารเจอทุกวัน", "คิดไว้ให้แล้ว"]} />
        <ul className="lp-tiles">
          {MORE.map(([icon, head, body], i) => (
            <li className="lp-tile lp-rv" style={d((i % 4) * 0.06)} key={head}>
              <span className="lp-hic">
                <Icon k={icon} className="lp-i" />
              </span>
              <h3>{head}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
