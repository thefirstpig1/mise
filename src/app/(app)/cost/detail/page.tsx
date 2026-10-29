// /cost/detail was the raw branch cost table. Kong 2026-10-29 asked for it to
// become the month-end close for the accountant ("ทำให้มันดีกว่านี้ … export
// ไปโปรแกรมบัญชีต่างๆได้"), which lives at /month-end. Old links land there.

import { redirect } from "next/navigation";

export default function CostDetailRedirect() {
  redirect("/month-end");
}
