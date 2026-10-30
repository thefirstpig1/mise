"use client";

// หน้าแรก: the movement of mockup CGi4XVy5QJqDUw9qoW3HJC v2 — things rise into
// place as they scroll in, the header turns solid, the hero's figures count up,
// the hero layers drift, and a feature picture tilts under the pointer. The
// page reads the same without any of it: until this runs, the stylesheet keeps
// everything visible (.lp:not(.is-live)), and reduced motion turns it all off.

import { useEffect } from "react";

export default function Motion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lp");
    if (!root) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.add("is-live");

    const countUp = (el: HTMLElement) => {
      if (reduce) return;
      const to = parseFloat(el.dataset.count ?? "0");
      const dec = Number(el.dataset.dec ?? 0);
      const pre = el.dataset.prefix ?? "";
      const fmt = (v: number) => pre + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString("en-US"));
      const t0 = performance.now();
      const dur = 1400;
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        el.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      // A throttled tab must still end on the real figure.
      setTimeout(() => (el.textContent = fmt(to)), dur + 150);
    };

    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target as HTMLElement;
          el.classList.add("is-in");
          el.querySelectorAll<HTMLElement>("[data-count]").forEach(countUp);
          io.unobserve(el);
        }),
      { threshold: 0.14, rootMargin: "0px 0px -6% 0px" }
    );
    root.querySelectorAll(".lp-rv, .lp-rv-img, .lp-lines, .lp-feat, .lp-item").forEach((el) => io.observe(el));

    const hdr = document.getElementById("lp-hdr");
    const stage = document.getElementById("lp-hero-stage");
    const pars = [...root.querySelectorAll<HTMLElement>("[data-par]")];
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        hdr?.classList.toggle("is-solid", scrollY > 40);
        if (!reduce && stage) {
          const off = Math.max(-400, Math.min(400, stage.getBoundingClientRect().top - innerHeight * 0.35));
          pars.forEach((p) => {
            const base = p.classList.contains("lp-phone") ? " rotate(2.5deg)" : "";
            p.style.transform = `translateY(${off * parseFloat(p.dataset.par ?? "0")}px)${base}`;
          });
        }
        ticking = false;
      });
    };
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const off: (() => void)[] = [];
    if (!reduce && matchMedia("(hover:hover) and (pointer:fine)").matches) {
      root.querySelectorAll<HTMLElement>(".lp-stage").forEach((s) => {
        const move = (e: PointerEvent) => {
          const r = s.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          s.style.transform = `perspective(1400px) rotateX(${(0.5 - y) * 4}deg) rotateY(${(x - 0.5) * 5}deg)`;
          s.style.setProperty("--gx", `${x * 100}%`);
          s.style.setProperty("--gy", `${y * 100}%`);
        };
        const leave = () => (s.style.transform = "");
        s.addEventListener("pointermove", move);
        s.addEventListener("pointerleave", leave);
        off.push(() => {
          s.removeEventListener("pointermove", move);
          s.removeEventListener("pointerleave", leave);
        });
      });
    }

    return () => {
      io.disconnect();
      removeEventListener("scroll", onScroll);
      off.forEach((f) => f());
    };
  }, []);
  return null;
}
