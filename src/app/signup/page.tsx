import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createTenant } from "@/server/tenant-init";
import { signIn } from "@/lib/auth";

async function handleSignup(formData: FormData) {
  "use server";

  const email = formData.get("email") as string;
  const name = formData.get("name") as string;
  const tenantName = formData.get("tenant_name") as string;
  const branchName = formData.get("branch_name") as string;
  const isVatRegistered = formData.get("is_vat_registered") === "on";

  if (!email || !tenantName) {
    throw new Error("กรุณากรอกข้อมูลให้ครบ");
  }

  // 1. Create user (or find existing)
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, emailVerified: null },
    update: { name },
  });

  // 2. Create tenant with full init
  await createTenant({
    ownerUserId: user.id,
    tenantName,
    isVatRegistered,
    firstBranchName: branchName || "สาขาหลัก",
  });

  // 3. Send magic link to login
  await signIn("email", { email, redirectTo: "/dashboard" });
}

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        <h1 className="mb-2 text-3xl font-bold">สมัครใช้งาน Mise</h1>
        <p className="mb-8 text-muted-foreground">
          สร้างบัญชี + ตั้งค่าร้านของคุณ
        </p>

        <form action={handleSignup} className="space-y-4">
          <div className="border-b border-border pb-4">
            <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
              ข้อมูลผู้ใช้
            </h2>
            <div className="space-y-3">
              <div>
                <label htmlFor="name" className="mb-1 block text-sm font-medium">
                  ชื่อของคุณ
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  className="w-full rounded-lg border border-border bg-background px-4 py-2"
                />
              </div>
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium">
                  อีเมล
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-lg border border-border bg-background px-4 py-2"
                />
              </div>
            </div>
          </div>

          <div className="border-b border-border pb-4">
            <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
              ข้อมูลร้าน
            </h2>
            <div className="space-y-3">
              <div>
                <label htmlFor="tenant_name" className="mb-1 block text-sm font-medium">
                  ชื่อร้าน
                </label>
                <input
                  id="tenant_name"
                  name="tenant_name"
                  type="text"
                  required
                  placeholder="เช่น ร้านลาบ Lauren"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2"
                />
              </div>
              <div>
                <label htmlFor="branch_name" className="mb-1 block text-sm font-medium">
                  ชื่อสาขาแรก
                </label>
                <input
                  id="branch_name"
                  name="branch_name"
                  type="text"
                  defaultValue="สาขาหลัก"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2"
                />
              </div>
              <div className="flex items-start gap-2 pt-2">
                <input
                  id="is_vat_registered"
                  name="is_vat_registered"
                  type="checkbox"
                  className="mt-1"
                />
                <div>
                  <label htmlFor="is_vat_registered" className="text-sm font-medium">
                    ร้านจดทะเบียน VAT
                  </label>
                  <p className="text-xs text-muted-foreground">
                    ถ้ารายได้เกิน ฿1.8M ต่อปี ต้องจด VAT
                  </p>
                </div>
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90"
          >
            สร้างบัญชี
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          มีบัญชีแล้ว?{" "}
          <a href="/login" className="text-primary underline">
            เข้าสู่ระบบ
          </a>
        </p>
      </div>
    </main>
  );
}
