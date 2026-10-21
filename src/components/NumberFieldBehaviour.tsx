"use client";

// Kong 2026-10-21: "เวลาที่จะแก้ตัวเลข ทำให้มันauto select all ได้ไหม".
// Every number field in the app selects what it holds when it gains focus, so
// typing replaces the old figure instead of being appended to it. And a
// mouse wheel over a focused number box no longer nudges the value — the
// browser default that silently turns 12 into 11 while someone scrolls the page.
//
// Document-level listeners rather than a prop on 53 inputs: a field written
// tomorrow behaves the same without anyone remembering to opt in.

import { useEffect } from "react";

const isNumberField = (el: EventTarget | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement &&
  !el.readOnly &&
  (el.type === "number" || el.inputMode === "decimal" || el.inputMode === "numeric");

export default function NumberFieldBehaviour() {
  useEffect(() => {
    let justFocused: HTMLInputElement | null = null;
    const onFocus = (e: FocusEvent) => {
      if (!isNumberField(e.target)) return;
      const el = e.target;
      justFocused = el;
      // Synchronously: a background tab never runs requestAnimationFrame, and
      // the mouseup guard below keeps the click from undoing the selection.
      el.select();
    };
    // Safari moves the caret on mouseup after focus, undoing the selection.
    const onMouseUp = (e: MouseEvent) => {
      if (justFocused && e.target === justFocused) e.preventDefault();
      justFocused = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (isNumberField(e.target) && e.target.type === "number" && document.activeElement === e.target) e.target.blur();
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("wheel", onWheel);
    };
  }, []);
  return null;
}
