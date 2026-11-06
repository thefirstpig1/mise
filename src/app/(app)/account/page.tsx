// ADR 0045 Q12 — บัญชีของฉัน: the address this account signs in with, and the
// one consent it may give or withdraw at any time (privacy draft §4: news and
// promotions by e-mail). Every member reaches it from their name in the menu.

import { requireTenant } from "@/lib/require-tenant";
import PageHeader from "@/components/ui/PageHeader";
import MarketingConsent from "./_components/MarketingConsent";
import { getMarketingConsentLogic } from "./actions";

export default async function AccountPage() {
  const { user } = await requireTenant("any:member");
  const optInAt = await getMarketingConsentLogic(user.id!);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <PageHeader title="บัญชีของฉัน" description="อีเมลที่ใช้เข้าสู่ระบบ และการรับข่าวสารจากคิดครัว" />
      <section className="space-y-1 rounded-[18px] border border-border/70 bg-surface p-4 shadow-card">
        <p className="text-xs font-medium text-muted-subtle">อีเมลที่ใช้เข้าสู่ระบบ</p>
        <p className="font-medium">{user.email}</p>
        <p className="text-xs text-muted-foreground">ลิงก์เข้าสู่ระบบส่งไปที่อีเมลนี้ · ถ้าเข้าอีเมลนี้ไม่ได้แล้ว ติดต่อคิดครัวผ่านปุ่ม “แจ้งปัญหาหรือเสนอแนะ”</p>
      </section>
      <MarketingConsent optedIn={optInAt !== null} since={optInAt} />
    </div>
  );
}
