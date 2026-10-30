"use client";

// หน้าแรก › คำถามที่พบบ่อย: each answer opens under its question.

import { useState } from "react";
import { FAQ } from "./content";
import { d } from "./parts";

export default function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="lp-faq-list">
      {FAQ.map(([q, a], i) => (
        <div key={q} className={`lp-qa lp-rv ${open === i ? "is-open" : ""}`} style={d(i * 0.05)}>
          <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            <span>{q}</span>
            <span className="lp-pm" aria-hidden>
              <svg viewBox="0 0 14 14">
                <path d="M7 1v12M1 7h12" />
              </svg>
            </span>
          </button>
          <div className="lp-ans">
            <div>
              <p>{a}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
