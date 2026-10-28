import { describe, expect, it } from "vitest";
import { groupSuggestions, likelyDuplicateOf, sameNameKey, type MergeMenuFacts } from "@/server/menu-merge-suggest";

const m = (id: string, name: string, pos: string | null, net = 0, extra: Partial<MergeMenuFacts> = {}): MergeMenuFacts => ({
  id,
  name,
  posMenuCode: null,
  posIntegrationId: pos,
  branchId: null,
  branchName: null,
  isRetired: false,
  net,
  qty: 0,
  hasRecipe: false,
  mergedIntoMenuId: null,
  spellingIds: [],
  ...extra,
});

describe("sameNameKey", () => {
  it("ignores spacing and brackets", () => {
    expect(sameNameKey("ชาไทย (เย็น)")).toBe(sameNameKey("ชาไทยเย็น"));
    expect(sameNameKey("กะเพราหมูสับ ไข่ดาว")).toBe(sameNameKey("กะเพราหมูสับไข่ดาว"));
  });
});

describe("groupSuggestions", () => {
  it("joins one row per POS, best score first, so two dishes never chain together", () => {
    const menus = [m("a1", "กะเพราหมู", "ari", 300), m("l1", "กะเพราหมู", "lp", 200), m("a2", "กะเพราไก่", "ari", 100)];
    const groups = groupSuggestions(menus, [
      { a: "a1", b: "l1", score: 1 },
      { a: "l1", b: "a2", score: 0.6 },
    ]);
    expect(groups).toEqual([{ kind: "exact", menuIds: ["a1", "l1"], net: 500 }]);
  });

  it("never offers a menu that is already folded into another", () => {
    const menus = [m("w", "ส้มตำ", "ari"), m("x", "ส้มตำ", "lp", 0, { mergedIntoMenuId: "w" })];
    expect(groupSuggestions(menus, [{ a: "w", b: "x", score: 1 }])).toEqual([]);
  });

  it("lets a third branch join an existing winner, but not a branch it already holds", () => {
    const menus = [
      m("w", "ส้มตำไทย", "ari", 0, { spellingIds: ["x"] }),
      m("x", "ส้มตำไทย", "lp", 0, { mergedIntoMenuId: "w" }),
      m("y", "ส้มตำไทย", "bn", 50),
      m("z", "ส้มตำไทย", "lp", 40),
    ];
    const groups = groupSuggestions(menus, [
      { a: "w", b: "y", score: 1 },
      { a: "w", b: "z", score: 1 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].menuIds.sort()).toEqual(["w", "y"]);
  });

  it("marks a group near when the names differ beyond spacing", () => {
    const menus = [m("a", "หมูกรอบผัดพริกเกลือ", "ari"), m("b", "หมูกรอบพริกเกลือ", "lp")];
    expect(groupSuggestions(menus, [{ a: "a", b: "b", score: 0.7 }])[0].kind).toBe("near");
  });
});

describe("likelyDuplicateOf", () => {
  it("points each recipe-less copy at the best-selling member that has a recipe", () => {
    const menus = [
      m("a1", "กะเพรา", "ari", 900, { hasRecipe: true, posMenuCode: "A01" }),
      m("x1", "กะเพรา", "lat", 400),
      m("y1", "กะเพรา", "thong", 950, { hasRecipe: true, posMenuCode: "T01" }),
    ];
    const got = likelyDuplicateOf({ menus, suggestions: [{ kind: "exact", menuIds: ["a1", "x1", "y1"], net: 2250 }] });
    expect(got).toEqual({ x1: { id: "y1", name: "กะเพรา", code: "T01" } });
  });

  it("names nobody when no member of the group has a recipe — that is a recipe to write", () => {
    const menus = [m("x1", "ข้าวซอย", "ari", 500), m("x2", "ข้าวซอย", "lat", 300)];
    expect(likelyDuplicateOf({ menus, suggestions: [{ kind: "exact", menuIds: ["x1", "x2"], net: 800 }] })).toEqual({});
  });
});
