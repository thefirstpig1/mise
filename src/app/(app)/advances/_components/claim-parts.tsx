"use client";

// ADR 0037 Q5–Q6 — the pieces both advance screens share: a status chip, a
// photo you can open full size or download, and a camera button that uploads.

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { CLAIM_STATUS_CHIP, CLAIM_STATUS_LABEL } from "@/lib/advance-labels";
import { fileUrl, uploadPhoto, type PhotoKind, type UploadResult } from "@/lib/upload-photo";
import type { ClaimStatus } from "@/server/staff-advance";

export function StatusChip({ status }: { status: ClaimStatus }) {
  return <span className={`${CLAIM_STATUS_CHIP[status]} whitespace-nowrap`}>{CLAIM_STATUS_LABEL[status]}</span>;
}

/** A stored photo: the small copy in the list, the full original one tap away. */
export function PhotoThumb({ id, label, size = "md" }: { id: string; label: string; size?: "sm" | "md" | "lg" }) {
  const box = size === "sm" ? "h-9 w-8" : size === "lg" ? "h-40 w-full" : "h-16 w-14";
  return (
    <a
      href={fileUrl(id)}
      target="_blank"
      rel="noreferrer"
      title={`${label} — เปิดรูปเต็ม`}
      className={`relative block shrink-0 overflow-hidden rounded-lg border border-border-strong bg-surface-sunk ${box}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a private route, not a static asset */}
      <img src={fileUrl(id, { thumb: true })} alt={label} loading="lazy" className="h-full w-full object-cover" />
      {size === "lg" && <span className="absolute bottom-2 left-2 rounded-full border border-border bg-surface px-2 py-0.5 text-xs">{label}</span>}
    </a>
  );
}

/** The empty slot that says what is missing. */
export function MissingPhoto({ label, size = "md" }: { label: string; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-9 w-8 text-[10px]" : "h-16 w-14 text-xs";
  return <span className={`grid shrink-0 place-items-center rounded-lg border border-dashed border-bad-border bg-bad-bg text-bad ${box}`}>{label}</span>;
}

/**
 * A button that opens the camera (on a phone) or the file picker, and uploads
 * what was chosen. The parent receives the stored file and any live bill the
 * same bytes are already on.
 */
export function PhotoButton({
  kind,
  label,
  onUploaded,
  onError,
  className = "btn-secondary btn-sm",
  disabled,
}: {
  kind: PhotoKind;
  label: string;
  onUploaded: (r: Extract<UploadResult, { ok: true }>) => void;
  onError: (message: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        // The rear camera on a phone; ignored by a desktop browser.
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          const r = await uploadPhoto(f, kind);
          setBusy(false);
          if (r.ok) onUploaded(r);
          else onError(r.formError);
        }}
      />
      <button type="button" disabled={busy || disabled} onClick={() => input.current?.click()} className={className}>
        {/* Queue item 9: the app's line camera, not an emoji — a first photo
            shows it; "＋ อีกรูป" already says what it does. */}
        {!busy && !label.startsWith("＋") && <Camera aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.9} />}
        {busy ? "กำลังอัปโหลด…" : label}
      </button>
    </>
  );
}
