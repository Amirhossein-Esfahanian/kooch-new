import { describe, expect, it } from "vitest";
import {
  isArrivalWithinReceptionWindow,
  isOvernightReceptionWindow,
} from "@/lib/reception-hours";

describe("recurring reception hours", () => {
  it.each([
    ["13:59", false],
    ["14:00", true],
    ["18:00", true],
    ["23:00", true],
    ["23:01", false],
  ])("evaluates %s in the same-day window", (arrival, inside) => {
    expect(isArrivalWithinReceptionWindow(arrival, "14:00:00", "23:00:00")).toBe(inside);
  });

  it.each([
    ["21:59", false],
    ["22:00", true],
    ["23:30", true],
    ["00:00", true],
    ["01:30", true],
    ["06:00", true],
    ["06:01", false],
  ])("evaluates %s in the overnight window", (arrival, inside) => {
    expect(isArrivalWithinReceptionWindow(arrival, "22:00:00", "06:00:00")).toBe(inside);
  });

  it("describes overnight direction without considering the arrival day offset", () => {
    expect(isOvernightReceptionWindow("14:00", "23:00")).toBe(false);
    expect(isOvernightReceptionWindow("22:00", "06:00")).toBe(true);
    expect(isArrivalWithinReceptionWindow("01:30", "14:00", "23:00")).toBe(false);
    expect(isArrivalWithinReceptionWindow("01:30", "22:00", "06:00")).toBe(true);
  });

  it("does not invent a window for malformed or equal endpoints", () => {
    expect(isArrivalWithinReceptionWindow("01:30", "22:00", "22:00")).toBeNull();
    expect(isArrivalWithinReceptionWindow("invalid", "22:00", "06:00")).toBeNull();
  });
});
