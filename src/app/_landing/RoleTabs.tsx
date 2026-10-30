"use client";

// หน้าแรก › ทุกฝ่ายในร้าน (mockup CGi4XVy5QJqDUw9qoW3HJC v2): one tab per job,
// each saying what that person does here and what they do NOT see — that the
// cook never sees a price is a selling point, not a gap. The cream pill slides
// to the chosen tab; the panel replays its entrance on every change.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ROLES } from "./content";
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

export default function RoleTabs() {
  const [on, setOn] = useState(0);
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
    const l = list.current;
    const t = tabs.current[i];
    if (l && t && l.scrollWidth > l.clientWidth) l.scrollTo({ left: t.offsetLeft - 16, behavior: "smooth" });
  };

  const r = ROLES[on];
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
          <div className="lp-pic">
            {r.pic.kind === "desk" ? (
              <div className="lp-desk">
                <img src={r.pic.src} alt={r.pic.alt} loading="lazy" />
              </div>
            ) : r.pic.kind === "phones" ? (
              r.pic.shots.map((s) => (
                <div className="lp-mob" key={s.src}>
                  <img src={s.src} alt={s.alt} width={780} height={1520} loading="lazy" />
                </div>
              ))
            ) : (
              <div className="lp-pcard">
                <p className="lp-eyebrow">{r.pic.eyebrow}</p>
                <div className="lp-t">{r.pic.title}</div>
                <p>{r.pic.body}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
