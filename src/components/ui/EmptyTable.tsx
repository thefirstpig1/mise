// ============================================================
// คิดครัว — a list with nothing in it yet, drawn as the list it will be
// ============================================================
// Kong 2026-11-05: "layout มันต้องเหมือนกันกับตอนที่มีข้อมูล … แต่ตัวกราฟตัวข้อมูล
// อย่า mislead … เขาต้องรู้ว่ามันจะมีกราฟ มีตารางอะไรบ้าง". A list page used to
// collapse into one box with a drawing (EmptyState). It now keeps its table:
// the REAL column heads, a few dashed rows, and the page's own sentence under
// them — so the reader sees what each document will show before the first one
// exists, and nothing on the screen is a made-up figure.
//
// The words are the caller's, exactly as EmptyState took them.
// ============================================================

import type { ReactNode } from "react";
import DashBar from "@/components/ui/DashBar";

export type EmptyColumn = {
  label: string;
  /** Money and counts sit right, as in the filled table. */
  right?: boolean;
  /** Hidden below this width, as in the filled table. */
  hide?: "sm" | "md";
};

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell" } as const;
// Varied so the rows read as rows of different things, not a striped block.
// A share of the column, never a fixed width: in a narrow card a fixed bar
// pushed the table wider than the card (ปิดเดือน's journal, 2026-11-05).
const WIDTHS = ["80%", "95%", "55%", "70%", "60%", "85%", "45%"];

export default function EmptyTable({
  columns,
  label,
  rows = 3,
  help,
  children,
}: {
  columns: EmptyColumn[];
  /** The page guide's part id — the same id the filled table carries (PageGuide). */
  help?: string;
  /** What the table is, for a screen reader: "รายการใบสั่งซื้อ". */
  label: string;
  rows?: number;
  children: ReactNode;
}) {
  return (
    <div data-help={help} className="data-table">
      <table aria-label={`${label} ยังไม่มีรายการ`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label} className={`${c.right ? "text-right" : ""} ${c.hide ? HIDE[c.hide] : ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody aria-hidden>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              {columns.map((c, j) => (
                <td key={c.label} className={c.hide ? HIDE[c.hide] : ""}>
                  <DashBar className={`h-3 min-w-8 ${c.right ? "ml-auto" : ""}`} style={{ width: WIDTHS[(i * 3 + j * 2) % WIDTHS.length] }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-dashed border-border-strong px-6 py-5 text-center text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
