import { describe, expect, it } from "vitest";
import { composePackName, guessContainer, packRatio, partsOf, sizeUnitsFor } from "@/lib/pack-unit";

// Kong 2026-10-21: a pack unit's name is built from container + size + unit,
// and a 500 g bag of a kg-counted product is "ถุง 500 g" holding 0.5 kg.
describe("pack unit names", () => {
  it("offers g/kg for a weighed product, ml/l for a liquid, the base itself for a counted one", () => {
    expect(sizeUnitsFor("kg")).toEqual(["g", "kg"]);
    expect(sizeUnitsFor("l")).toEqual(["ml", "l"]);
    expect(sizeUnitsFor("ฟอง")).toEqual(["ฟอง"]);
    // An old Thai spelling still on a row reads as its English size.
    expect(sizeUnitsFor("กก.")).toEqual(["g", "kg"]);
  });

  it("converts the size into base units", () => {
    expect(packRatio("500", "g", "kg")).toBe(0.5);
    expect(packRatio("1.5", "l", "ml")).toBe(1500);
    expect(packRatio(30, "ฟอง", "ฟอง")).toBe(30);
    expect(packRatio("500", "ml", "kg")).toBeNull(); // weight ↔ volume needs a density
    expect(packRatio("", "g", "kg")).toBeNull();
    expect(packRatio("0", "g", "kg")).toBeNull();
  });

  it("writes the name, and nothing until every part is there", () => {
    expect(composePackName("ถุง", "500", "g")).toBe("ถุง 500 g");
    expect(composePackName(" กระสอบ ", "10", "kg")).toBe("กระสอบ 10 kg");
    expect(composePackName("ถุง", "", "g")).toBe("");
    expect(composePackName("", "5", "kg")).toBe("");
    // g or kg is never assumed.
    expect(composePackName("ถุง", "500", "")).toBe("");
  });

  it("reads a composed name back only when its size agrees with the stored ratio", () => {
    expect(partsOf("ถุง 500 g", "0.5", "kg")).toEqual({ box: "ถุง", size: "500", sizeUnit: "g" });
    expect(partsOf("กระสอบ 10 kg", 10, "kg")).toEqual({ box: "กระสอบ", size: "10", sizeUnit: "kg" });
    // The name says 10 kg but the unit holds 12 — keep it hand-written, never "correct" it.
    expect(partsOf("กระสอบ 10 kg", 12, "kg")).toBeNull();
    // More than a container and a size.
    expect(partsOf("ลัง 24 กล่อง (6 l)", 6, "l")).toBeNull();
    expect(partsOf("แผง 30 ฟอง", 30, "ฟอง")).toEqual({ box: "แผง", size: "30", sizeUnit: "ฟอง" });
  });

  it("guesses the container from the size in use", () => {
    expect(guessContainer("ถุง 250 g")).toBe("ถุง");
    expect(guessContainer("กระสอบ 10 kg")).toBe("กระสอบ");
    expect(guessContainer(null)).toBe("");
  });
});
