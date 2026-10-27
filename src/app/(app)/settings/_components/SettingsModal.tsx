"use client";

// A short form in a popup, for the settings lists (branches, departments,
// people). ModalShell supplies the window, Esc and the scrim; the Portal puts
// it under <body>, because the page frame animates in with a transform and a
// fixed element inside it would be fixed to the frame (mise-ui-review §7).

import { useId, type ReactNode } from "react";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import { Portal } from "@/app/(app)/menus/_components/sheet-parts";

export default function SettingsModal({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <Portal>
      <ModalShell onClose={onClose} labelledBy={id} narrow>
        <div className="mb-4 pr-10">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
        </div>
        {children}
      </ModalShell>
    </Portal>
  );
}
