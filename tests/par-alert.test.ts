// Rules PAR-1 / PAR-2 (Kong 2026-10-21): below par is red, near par is yellow.
import { describe, it, expect } from "vitest";
import { parAlertOf } from "@/lib/par-alert";

describe("parAlertOf", () => {
  it("no par = no alert, whatever is on hand", () => {
    expect(parAlertOf({ onHand: 0, par: null, usedPerDay: 5 }, 3)).toBeNull();
  });

  it("below par is LOW (on hand only — stock on order does not hide it)", () => {
    expect(parAlertOf({ onHand: 159, par: 200, usedPerDay: 6 }, 3)).toEqual({ level: "LOW" });
  });

  it("exactly at par is not LOW; it is NEAR when the shop warns ahead", () => {
    expect(parAlertOf({ onHand: 50, par: 50, usedPerDay: 2 }, 3)).toEqual({ level: "NEAR", daysToPar: 0 });
  });

  it("NEAR = reaches par within the warning days at the real usage rate", () => {
    // 163.3 − 160 = 3.3 kg above par, used 2.17/day → 1.5 days
    expect(parAlertOf({ onHand: 163.3, par: 160, usedPerDay: 2.17 }, 3)).toEqual({ level: "NEAR", daysToPar: 1 });
    // 880 − 450 = 430 above par at 24.6/day → 17 days: fine
    expect(parAlertOf({ onHand: 880, par: 450, usedPerDay: 24.6 }, 3)).toBeNull();
    // the same product in a shop that warns 20 days ahead
    expect(parAlertOf({ onHand: 880, par: 450, usedPerDay: 24.6 }, 20)).toEqual({ level: "NEAR", daysToPar: 17 });
  });

  it("with no usage rate, within 20% above par is NEAR", () => {
    expect(parAlertOf({ onHand: 59, par: 50, usedPerDay: null }, 3)).toEqual({ level: "NEAR", daysToPar: null });
    expect(parAlertOf({ onHand: 61, par: 50, usedPerDay: null }, 3)).toBeNull();
  });

  it("warning days 0 = below-par only", () => {
    expect(parAlertOf({ onHand: 50.1, par: 50, usedPerDay: 10 }, 0)).toBeNull();
    expect(parAlertOf({ onHand: 59, par: 50, usedPerDay: null }, 0)).toBeNull();
    expect(parAlertOf({ onHand: 49, par: 50, usedPerDay: null }, 0)).toEqual({ level: "LOW" });
  });
});
