import { describe, expect, it } from "vitest";
import {
  getPropertyFinancialWarnings,
  hasActiveExtraGuestRoomType,
} from "@/components/pricing/PricingWarnings";

const capableRoom = { isActive: true, allowExtraGuest: true, maxExtraGuests: 2 };

describe("Property financial warnings", () => {
  it.each([
    ["no rooms", []],
    ["inactive capable room", [{ ...capableRoom, isActive: false }]],
    ["extra guests disabled", [{ ...capableRoom, allowExtraGuest: false }]],
    ["zero extra capacity", [{ ...capableRoom, maxExtraGuests: 0 }]],
  ])("does not warn for missing prices with %s", (_case, rooms) => {
    expect(hasActiveExtraGuestRoomType(rooms)).toBe(false);
    expect(getPropertyFinancialWarnings({ extraGuestPrice: null }, rooms)).toEqual([]);
  });

  it("ignores null child overrides and null or zero child price", () => {
    const rooms = [capableRoom];
    const withNullChildPrice = {
      extraGuestPrice: 0,
      freeChildAgeLimit: null,
      maxFreeChildren: null,
      childPrice: null,
    };
    expect(getPropertyFinancialWarnings(withNullChildPrice, rooms)).toEqual([]);
    const withZeroChildPrice = { ...withNullChildPrice, childPrice: 0 };
    expect(getPropertyFinancialWarnings(withZeroChildPrice, rooms)).toEqual([]);
  });

  it("warns only for null extra guest price with an active capable room", () => {
    const rooms = [{ ...capableRoom, isActive: false }, capableRoom];
    expect(hasActiveExtraGuestRoomType(rooms)).toBe(true);
    expect(getPropertyFinancialWarnings({ extraGuestPrice: null }, rooms)).toEqual([
      "missingExtraGuestPrice",
    ]);
    expect(getPropertyFinancialWarnings({ extraGuestPrice: 0 }, rooms)).toEqual([]);
    expect(getPropertyFinancialWarnings({ extraGuestPrice: 100 }, rooms)).toEqual([]);
    expect(getPropertyFinancialWarnings(null, rooms)).toEqual([]);
  });
});
