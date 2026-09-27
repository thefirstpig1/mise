// ============================================================
// Mise — the Thai category seed and its rename file agree (Part 35 L2)
// ============================================================

import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prismaBypass } from "@/lib/db-admin";
import { sweepTestTenants } from "./support/sweep";
import { DEFAULT_CATEGORIES, UNCATEGORISED } from "@/lib/category-seed";
import { UNCATEGORISED_CATEGORY } from "@/server/expense";
import { createTenant } from "@/server/tenant-init";

const SQL = readFileSync(join(process.cwd(), "prisma", "manual", "category_names_th.sql"), "utf8");

/** The (account, en_section, en_group, th_section, th_group) rows written in the SQL. */
function sqlRows(): string[] {
  return [...SQL.matchAll(/\('(COGS|OpEx)', '([^']+)', '([^']+)', '([^']+)', '([^']+)'\)/g)].map((m) =>
    m.slice(1).join("|")
  );
}

const created: string[] = [];
afterAll(async () => {
  await sweepTestTenants(prismaBypass, { ids: created });
  await prismaBypass.user.deleteMany({ where: { email: { startsWith: "p35-catseed-" } } });
});

describe("category seed", () => {
  it("the rename file covers exactly the seeded list plus the uncategorised bucket", () => {
    const expected = [
      ...DEFAULT_CATEGORIES.map((c) => [c.account, c.en.section, c.en.group, c.th.section, c.th.group].join("|")),
      [UNCATEGORISED.account, UNCATEGORISED.en.section, UNCATEGORISED.en.group, UNCATEGORISED.th.section, UNCATEGORISED.th.group].join("|"),
    ];
    expect(sqlRows().sort()).toEqual(expected.sort());
  });

  it("the uncategorised bucket sits under the SAME section as the seeded food", () => {
    const food = DEFAULT_CATEGORIES.find((c) => c.en.section === "Food")!;
    expect(UNCATEGORISED_CATEGORY.accountingSection).toBe(food.th.section);
  });

  it("a new shop is seeded in Thai, with no English left", async () => {
    const user = await prismaBypass.user.create({ data: { email: `p35-catseed-${Date.now()}@example.com` } });
    const { tenant } = (await createTenant({ ownerUserId: user.id, tenantName: "P35 category seed" })) as {
      tenant: { id: string };
    };
    created.push(tenant.id);
    const rows = await prismaBypass.category.findMany({ where: { tenantId: tenant.id } });
    expect(rows).toHaveLength(DEFAULT_CATEGORIES.length);
    for (const r of rows) {
      expect(r.accountingSection).not.toMatch(/[A-Za-z]/);
      expect(r.groupName).not.toMatch(/[A-Za-z]/);
    }
  });
});
