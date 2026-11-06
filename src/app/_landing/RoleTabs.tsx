"use client";

// หน้าแรก › ทุกฝ่ายในร้าน (mockup CGi4XVy5QJqDUw9qoW3HJC v2): one tab per job,
// each saying what that person does here and what they do NOT see — that the
// cook never sees a price is a selling point, not a gap. The cream pill slides
// to the chosen tab; the panel replays its entrance on every change.
//
// Kong 2026-11-03: "แต่ละ position … เอามาเยอะ ๆ ก็ได้ เขาจะได้ดูหน้าตาแอปคร่าว ๆ"
// (mockup WbpsYxAgy9YPi5C95UrErL, change 3): two to four real screens per job,
// switched by the small pictures under the big one. A phone alone leaves the
// frame half empty, so the job's next phone screen peeks beside it.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ROLES, type RoleShot } from "./content";
import { Phrases } from "./parts";

const TICK = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C6D08F" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const HIDE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12.6 12.6 0 0 1-3.2 4.3M6.1 6.1A12.4 12.4 0 0 0 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 4-.9" />
  </svg>
);

const alt = (s: RoleShot) => `${s.cap} — ร้านตัวอย่าง`;

function Stage({ shots, at, onPick }: { shots: RoleShot[]; at: number; onPick: (j: number) => void }) {
  const s = shots[at];
  if (s.kind === "desk") {
    return (
      <div className="lp-gdesk">
        <div className="lp-bar" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <img src={s.src} alt={alt(s)} width={s.w} height={s.h} />
      </div>
    );
  }
  const phones = shots.map((x, j) => [x, j] as const).filter(([x]) => x.kind === "phone");
  const here = phones.findIndex(([, j]) => j === at);
  const next = phones.length > 1 ? phones[(here + 1) % phones.length] : null;
  return (
    <div className="lp-gphones">
      <div className="lp-gphone">
        <img src={s.src} alt={alt(s)} width={s.w} height={s.h} />
      </div>
      {next ? (
        <button type="button" className="lp-gphone is-peek" onClick={() => onPick(next[1])} aria-label={`ดูภาพ ${next[0].cap}`}>
          <img src={next[0].src} alt="" width={next[0].w} height={next[0].h} loading="lazy" />
        </button>
      ) : null}
    </div>
  );
}

export default function RoleTabs() {
  const [on, setOn] = useState(0);
  const [shot, setShot] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ w: number; h: number; x: number; y: number } | null>(null);

  const measure = () => {
    const t = tabs.current[on];
    if (t) setPill({ w: t.offsetWidth, h: t.offsetHeight, x: t.offsetLeft, y: t.offsetTop });
  };
  useLayoutEffect(measure, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (i: number) => {
    setOn(i);
    setShot(0);
    const l = list.current;
    const t = tabs.current[i];
    if (l && t && l.scrollWidth > l.clientWidth) l.scrollTo({ left: t.offsetLeft - 16, behavior: "smooth" });
  };

  const r = ROLES[on];
  const s = r.shots[shot];
  return (
    <>
      <div className="lp-tabs" role="tablist" aria-label="หน้าที่" ref={list}>
        <span className="lp-ind" aria-hidden style={pill ? { width: pill.w, height: pill.h, transform: `translate(${pill.x}px,${pill.y}px)` } : { opacity: 0 }} />
        {ROLES.map((role, i) => (
          <button
            key={role.name}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={i === on}
            className="lp-tab"
            onClick={() => choose(i)}
          >
            <span className="lp-n">{role.name}</span>
            <span className="lp-d">{role.sub}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <div className="lp-panel" key={on}>
          <div className="lp-txt">
            <h3>
              <Phrases t={r.title} />
            </h3>
            <div className="lp-cans">
              {r.can.map((c) => (
                <p className="lp-can" key={c}>
                  {TICK}
                  <span>{c}</span>
                </p>
              ))}
              {r.cant && (
                <p className="lp-cant">
                  {HIDE}
                  <span>{r.cant}</span>
                </p>
              )}
            </div>
          </div>
          <div className="lp-gal">
            <div className="lp-gstage" key={shot}>
              <Stage shots={r.shots} at={shot} onPick={setShot} />
            </div>
            <p className="lp-gcap">
              <b>{s.cap}</b>
              <span>
                {shot + 1} จาก {r.shots.length} · ร้านตัวอย่าง
              </span>
            </p>
            <div className="lp-thumbs">
              {r.shots.map((x, j) => (
                <button type="button" key={x.src} className={`lp-thumb${x.kind === "phone" ? " is-phone" : ""}`} aria-pressed={j === shot} onClick={() => setShot(j)}>
                  <span className="lp-tpic">
                    <img src={x.src} alt="" loading="lazy" />
                  </span>
                  {x.cap}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
