"use client";

// A file picker in Thai that a finger can hit (Kong 2026-10-25): tap to choose
// or drag a file onto it. Replaces the browser's own "Choose File · No file
// chosen", which is English, tiny and cannot be styled.

import { useRef, useState } from "react";

export default function FileDrop({
  accept,
  hint,
  disabled,
  onFile,
  fileName,
}: {
  accept?: string;
  hint?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  /** The file currently chosen, to show instead of the prompt. */
  fileName?: string | null;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !disabled) onFile(f);
      }}
      className={`grid cursor-pointer place-items-center gap-1 rounded-2xl border-2 border-dashed p-5 text-center transition ${
        disabled ? "cursor-not-allowed opacity-50" : over ? "border-primary bg-primary/5" : "border-border-strong bg-surface-sunk hover:bg-muted"
      }`}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <span className="font-display font-semibold">{fileName ? `📄 ${fileName}` : "📄 แตะเพื่อเลือกไฟล์ หรือลากไฟล์มาวาง"}</span>
      {hint && <span className="text-xs text-muted-subtle">{hint}</span>}
      {fileName && <span className="text-xs text-primary">แตะเพื่อเปลี่ยนไฟล์</span>}
    </label>
  );
}
