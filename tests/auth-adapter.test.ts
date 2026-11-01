// ============================================================
// Mise — signing in again over a session that is already gone (2026-11-01)
// ============================================================
// Kong's browser still carried the cookie of a deleted trial account. A magic
// link then failed with ?error=Configuration, because Auth.js deletes the old
// session before signing the browser in again and the stock adapter throws
// when that row is missing. The adapter now answers `null` for a missing row.
//
// `user` and `session` carry no tenantId, so the suite sweep does not cover
// them — every row this file writes, it deletes.
// ============================================================

import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { sessionTolerantAdapter } from "@/lib/auth-adapter";

const RUN = `auth-adapter-${Date.now()}`;
const adapter = sessionTolerantAdapter(prisma);

afterAll(async () => {
  await prisma.session.deleteMany({ where: { sessionToken: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { email: `${RUN}@example.com` } });
});

describe("deleteSession", () => {
  it("answers null when the session row is already gone, instead of failing the sign-in", async () => {
    await expect(adapter.deleteSession!(`${RUN}-never-existed`)).resolves.toBeNull();
  });

  it("still deletes a session that exists", async () => {
    const user = await prisma.user.create({ data: { email: `${RUN}@example.com` } });
    const sessionToken = `${RUN}-live`;
    await prisma.session.create({
      data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 3600_000) },
    });

    const deleted = await adapter.deleteSession!(sessionToken);

    expect(deleted).toMatchObject({ sessionToken, userId: user.id });
    expect(await prisma.session.count({ where: { sessionToken } })).toBe(0);
  });

  it("still throws on any other failure", async () => {
    const broken = {
      session: {
        delete: async () => {
          throw Object.assign(new Error("connection lost"), { code: "P1001" });
        },
      },
    } as unknown as Parameters<typeof sessionTolerantAdapter>[0];

    await expect(sessionTolerantAdapter(broken).deleteSession!("x")).rejects.toThrow("connection lost");
  });
});
