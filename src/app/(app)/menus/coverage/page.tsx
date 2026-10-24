// /menus/coverage — retired 2026-10-24 (Kong, duplication review B3).
//
// The same three menus and the same baht figure already sat on จัดการเมนู (the
// card and the "ยังไม่มีสูตร" filter) and on ทดลองเมนู (with a "+ ร่างสูตร"
// button, which is the thing to do next). The page added only a 7/30/90-day
// switch. Old links land on ทดลองเมนู.

import { redirect } from "next/navigation";

export default function CoverageRetired() {
  redirect("/menus/lab");
}
