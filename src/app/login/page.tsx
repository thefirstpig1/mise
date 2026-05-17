import { signIn } from "@/lib/auth";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { "check-email"?: string };
}) {
  const checkEmail = searchParams["check-email"] !== undefined;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-3xl font-bold">เข้าสู่ระบบ</h1>
        <p className="mb-8 text-muted-foreground">
          ระบบจะส่งลิงก์ login ไปอีเมลของคุณ
        </p>

        {checkEmail ? (
          <div className="rounded-lg border border-border bg-muted/40 p-6 text-center">
            <p className="mb-2 text-lg font-medium">📧 เช็คอีเมลของคุณ</p>
            <p className="text-sm text-muted-foreground">
              คลิกลิงก์ในอีเมลเพื่อเข้าสู่ระบบ
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              (Dev mode — ลิงก์จะแสดงใน terminal ของ dev server)
            </p>
          </div>
        ) : (
          <form
            action={async (formData) => {
              "use server";
              await signIn("email", formData);
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">
                อีเมล
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-background px-4 py-2 focus:border-primary focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-primary py-2 font-medium text-primary-foreground hover:opacity-90"
            >
              ส่งลิงก์ login
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          ยังไม่มีบัญชี?{" "}
          <a href="/signup" className="text-primary underline">
            สมัครใช้งาน
          </a>
        </p>
      </div>
    </main>
  );
}
