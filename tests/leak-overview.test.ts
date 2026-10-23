// ของหายไปไหน — the one pure rule the overview adds (rule LK-HINT's name match).
import { describe, expect, it } from "vitest";
import { nameCore } from "@/server/leak-overview";

describe("nameCore — matching a product to a menu sold without a recipe", () => {
  it("drops the size, so a bottle matches its menu", () => {
    expect(nameCore("เบียร์สิงห์ 620 มล.")).toBe("เบียร์สิงห์");
    expect("เบียร์สิงห์ (ขวด)".includes(nameCore("เบียร์สิงห์ 620 มล."))).toBe(true);
  });
  it("keeps a plain name whole, so มะนาว finds น้ำมะนาวโซดา", () => {
    expect("น้ำมะนาวโซดา".includes(nameCore("มะนาว"))).toBe(true);
  });
  it("drops a trailing note in brackets", () => {
    expect(nameCore("กุ้งขาว (แช่แข็ง)")).toBe("กุ้งขาว");
  });
});
