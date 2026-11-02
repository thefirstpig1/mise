"use server";

// ADR 0044 — the reporter's two writes: send a report, and mark the answers
// seen. Thin glue: requireTenant → zod → *Logic → Thai error; the operator's
// letter goes after the commit and can never fail the send (notify module).

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/require-tenant";
import { createReportSchema } from "@/lib/problem-report";
import { createProblemReportLogic, markMyReportsSeenLogic } from "@/server/problem-report";
import { notifyNewReport } from "@/server/problem-report-notify";
import { FileNotAttachableError } from "@/server/stored-file";

export type SendReportResult = { ok: true; number: number } | { ok: false; formError: string };

export async function sendReportAction(input: unknown): Promise<SendReportResult> {
  // The error page can show without a session; requireTenant would REDIRECT to
  // /login and the typed message would go with the page. Say so instead.
  const session = await auth();
  if (!session?.user?.id) return { ok: false, formError: "กรุณาเข้าสู่ระบบก่อน แล้วแจ้งอีกครั้ง — ข้อความที่พิมพ์ไว้ยังอยู่ในช่อง" };
  const { tenantId, user, assertBranch } = await requireTenant("any:member");
  const parsed = createReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  // A branch the page named but this person cannot reach is dropped, not trusted.
  let branchId = parsed.data.branchId;
  if (branchId) {
    try {
      assertBranch(branchId);
    } catch {
      branchId = undefined;
    }
  }
  try {
    const r = await createProblemReportLogic(tenantId, user.id!, { ...parsed.data, branchId });
    await notifyNewReport({ ...r, kind: parsed.data.kind, pagePath: parsed.data.pagePath, message: parsed.data.message });
    revalidatePath("/reports");
    return { ok: true, number: r.number };
  } catch (e) {
    if (e instanceof FileNotAttachableError) return { ok: false, formError: "รูปบางรูปแนบไม่ได้ กรุณาเลือกรูปใหม่แล้วลองอีกครั้ง" };
    console.error("[problem-report] send failed", e);
    return { ok: false, formError: "ส่งไม่สำเร็จ กรุณาลองอีกครั้ง" };
  }
}

export async function markReportsSeenAction(): Promise<{ ok: boolean }> {
  const { tenantId, user } = await requireTenant("any:member");
  await markMyReportsSeenLogic(tenantId, user.id!);
  return { ok: true };
}
