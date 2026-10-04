// The app-wide search (src/lib/smart-search.ts) — every row of the rule table
// Kong approved on 2026-10-03, against the demo shop's real names and codes.
import { describe, it, expect } from "vitest";
import { STRONG_MATCH, highlightRuns, rankBySearch, scoreText, type SearchField } from "@/lib/smart-search";

type Item = { name: string; code: string; cat: string };
const MENUS: Item[] = [
  ["กะเพราหมูสับไข่ดาว", "A01", "อาหารจานเดียว"],
  ["กะเพรากุ้ง", "A02", "อาหารจานเดียว"],
  ["ข้าวผัดหมู", "A03", "อาหารจานเดียว"],
  ["ผัดไทยกุ้งสด", "A05", "อาหารจานเดียว"],
  ["ข้าวไข่เจียวหมูสับ", "A12", "อาหารจานเดียว"],
  ["ข้าวซอยไก่", "A15", "อาหารจานเดียว"],
  ["แกงเขียวหวานไก่", "A07", "กับข้าว"],
  ["ไก่ผัดเม็ดมะม่วง", "A14", "กับข้าว"],
  ["ต้มยำกุ้งน้ำข้น", "A06", "ต้ม ยำ ส้มตำ"],
  ["กาแฟเย็น", "B02", "เครื่องดื่ม"],
  ["โค้ก", "B03", "เบียร์และน้ำอัดลม"],
  ["เบียร์สิงห์", "B04", "เบียร์และน้ำอัดลม"],
].map(([name, code, cat]) => ({ name, code, cat }));
const PRODUCTS: Item[] = [
  ["กระเทียม", "P-0017", "ผักและผลไม้"],
  ["กุ้งขาว", "P-0005", "อาหารทะเล"],
  ["ปลากะพง", "P-0006", "อาหารทะเล"],
  ["หมูสับ", "P-0001", "เนื้อสัตว์"],
  ["เมล็ดกาแฟคั่ว", "P-0022", "กาแฟและชา"],
  ["เบียร์สิงห์ 620 มล.", "P-0025", "เครื่องดื่มแอลกอฮอล์"],
  ["ใบกะเพรา", "P-0015", "ผักและผลไม้"],
].map(([name, code, cat]) => ({ name, code, cat }));
const FIELDS: SearchField<Item>[] = [
  { get: (i) => i.name, kind: "name" },
  { get: (i) => i.code, kind: "code" },
  { get: (i) => i.cat, kind: "category" },
];
const top = (items: Item[], q: string) =>
  rankBySearch(items, q, FIELDS)
    .filter((r) => r.score >= STRONG_MATCH)
    .map((r) => r.item.name);

describe("smart search — the rule table", () => {
  it("the whole name scores highest", () => {
    expect(scoreText("โค้ก", "โค้ก", "name").score).toBe(100);
  });
  it("a name that starts with the query beats one that only contains it", () => {
    expect(top(MENUS, "กะเพรา")).toEqual(["กะเพราหมูสับไข่ดาว", "กะเพรากุ้ง"]);
    const r = rankBySearch(MENUS, "หมูสับ", FIELDS);
    expect(r[0].item.name).toBe("กะเพราหมูสับไข่ดาว"); // contains, earlier in the name
    expect(r[1].item.name).toBe("ข้าวไข่เจียวหมูสับ");
  });
  it("finds a name without its tone marks", () => {
    expect(top(MENUS, "ไก")).toEqual(["ไก่ผัดเม็ดมะม่วง", "ข้าวซอยไก่", "แกงเขียวหวานไก่"]);
  });
  it("ignores spaces and English case", () => {
    expect(top(MENUS, "เบียร์ สิงห์")[0]).toBe("เบียร์สิงห์");
    expect(top(MENUS, "a02")).toEqual(["กะเพรากุ้ง"]);
  });
  it("finds a code by its number, without the letters or the leading zeros (Kong: 02 and 22)", () => {
    expect(top(MENUS, "02")).toEqual(["กะเพรากุ้ง", "กาแฟเย็น"]);
    expect(top(PRODUCTS, "22")).toEqual(["เมล็ดกาแฟคั่ว"]);
    expect(top(PRODUCTS, "0022")).toEqual(["เมล็ดกาแฟคั่ว"]);
    expect(scoreText("22", "P-0022", "code")).toMatchObject({ score: 80, why: "ตรงเลขรหัส" });
  });
  it("a whole code outranks the code's number, which outranks a code prefix", () => {
    expect(scoreText("A02", "A02", "code").score).toBe(85);
    expect(scoreText("A0", "A02", "code").score).toBe(75);
    expect(scoreText("2", "A12", "code").score).toBeLessThan(80); // contains, not the number
  });
  it("an abbreviation needs three letters close together", () => {
    expect(top(MENUS, "ขผม")).toEqual(["ข้าวผัดหมู"]);
    // "ไก" must not find ผัดไทยกุ้งสด through ไ…ก
    expect(top(MENUS, "ไก")).not.toContain("ผัดไทยกุ้งสด");
  });
  it("a near spelling is found, a merely similar start is not", () => {
    expect(top(MENUS, "กระเพรา")).toEqual(["กะเพราหมูสับไข่ดาว", "กะเพรากุ้ง"]);
    expect(top(PRODUCTS, "กระเพรา")).toEqual(["ใบกะเพรา"]); // not กระเทียม
  });
  it("a short word is not 'nearly' another word one letter away (Kong's demo: กุ้ง → ผักบุ้ง)", () => {
    const veg: Item[] = [...PRODUCTS, { name: "ผักบุ้ง", code: "P-0019", cat: "ผักและผลไม้" }];
    expect(top(veg, "กุ้ง")).toEqual(["กุ้งขาว"]);
  });
  it("matches the category, below any name match", () => {
    expect(top(PRODUCTS, "ทะเล")).toEqual(["กุ้งขาว", "ปลากะพง"]);
    expect(scoreText("ทะเล", "อาหารทะเล", "category").score).toBeLessThan(scoreText("ทะเล", "ทะเลเผา", "name").score);
  });
});

describe("smart search — nothing disappears", () => {
  it("every item is still in the result, matches first, the rest in their original order", () => {
    const r = rankBySearch(MENUS, "กะเพรา", FIELDS);
    expect(r).toHaveLength(MENUS.length);
    const rest = r.filter((x) => x.score < STRONG_MATCH).map((x) => x.index);
    expect(rest).toEqual([...rest].sort((a, b) => a - b));
  });
  it("a query nothing matches keeps the whole list in its order", () => {
    const r = rankBySearch(MENUS, "พิซซ่า", FIELDS);
    expect(r.every((x) => x.score === 0)).toBe(true);
    expect(r.map((x) => x.index)).toEqual(MENUS.map((_, i) => i));
  });
  it("equal scores keep the caller's order, so the list does not shuffle while typing", () => {
    const r = rankBySearch(MENUS, "02", FIELDS).filter((x) => x.score >= STRONG_MATCH);
    expect(r.map((x) => x.index)).toEqual([1, 9]);
  });
});

describe("smart search — highlighting", () => {
  it("marks the matched letters in the original text, across a space", () => {
    const m = scoreText("เบียร์สิงห์", "เบียร์ สิงห์ 620 มล.", "name");
    const runs = highlightRuns("เบียร์ สิงห์ 620 มล.", m.marks);
    expect(runs.filter((r) => r.hit).map((r) => r.text).join("")).toBe("เบียร์สิงห์");
  });
  it("marks the digits of a code found by its number", () => {
    const m = scoreText("22", "P-0022", "code");
    expect(highlightRuns("P-0022", m.marks)).toEqual([
      { text: "P-00", hit: false },
      { text: "22", hit: true },
    ]);
  });
});
