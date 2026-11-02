import { describe, expect, it } from "vitest";
import { initialAvailabilityContextKey, readBookingContext, validBookingPropertyEntry, writeBookingContext } from "@/lib/booking-context";

describe("canonical booking URL context", () => {
  it.each([{ childAges: [] }, { childAges: [4] }, { childAges: [4, 9] }])("round-trips dates, rooms, adults and ordered ages $childAges", ({ childAges }) => {
    const context = {
      dates: { startDate: "2030-08-10", endDate: "2030-08-12" },
      guests: { rooms: 3, adults: 4, children: childAges.length, childAges },
    };
    const query = writeBookingContext(context);
    expect(readBookingContext(query)).toEqual(context);
    expect(query.getAll("childAges")).toEqual(childAges.length ? [childAges.join(",")] : []);
    expect(initialAvailabilityContextKey(query, "house")).toBe(JSON.stringify([
      "house", "2030-08-10", "2030-08-12", 3, 4, childAges.length, childAges,
    ]));
  });

  it("reads legacy repeated ages and the guests alias without reordering", () => {
    const query = new URLSearchParams("children=2&childAges=4&childAges=9&guests=3");
    expect(readBookingContext(query).guests).toEqual({ rooms: 1, adults: 3, children: 2, childAges: [4, 9] });
  });

  it.each([
    "", "rooms=-1&adults=NaN&children=Infinity", "rooms=1.5&adults=0&children=9007199254740992",
    "children=2&childAges=4,bad", "children=2&childAges=4", "children=1&childAges=18",
  ])("uses bounded safe defaults without fabricating child ages for %s", (query) => {
    const parsed = readBookingContext(new URLSearchParams(query));
    expect(parsed).toEqual({ dates: { startDate: null, endDate: null }, guests: { rooms: 1, adults: 2, children: 0, childAges: [] } });
    expect(initialAvailabilityContextKey(new URLSearchParams(query), "house")).toBeNull();
  });

  it.each(["2030-02-30", "bad", "2030-8-10"])("rejects invalid calendar date %s", (checkIn) => {
    expect(readBookingContext(new URLSearchParams({ checkIn })).dates.startDate).toBeNull();
  });

  it("rejects reversed/equal stays, does not auto-search old dates, and retains unrelated params", () => {
    const query = new URLSearchParams("checkIn=2030-08-10&checkOut=2030-08-10&rooms=1&adults=2&children=0");
    expect(readBookingContext(query).dates.endDate).toBeNull();
    expect(initialAvailabilityContextKey(query, "house")).toBeNull();
    query.set("checkIn", "2020-01-01");
    query.set("checkOut", "2020-01-02");
    expect(initialAvailabilityContextKey(query, "house")).toBeNull();
    const output = writeBookingContext(readBookingContext(query), new URLSearchParams("utm_source=test&guests=6&childAges=7&childAges=9"));
    expect(output.get("utm_source")).toBe("test");
    expect(output.has("guests")).toBe(false);
    expect(output.has("childAges")).toBe(false);
    expect(output.get("checkIn")).toBe("2020-01-01");
  });

  it("only accepts an enumerated route bound to every cart item's Property", () => {
    const items = [{ propertyId: 10, propertySlug: "house" }];
    const entry = { kind: "book", propertyId: 10, propertySlug: "house", rooms: 2 };
    expect(validBookingPropertyEntry(entry, items)).toEqual(entry);
    for (const value of ["https://evil.test", { ...entry, kind: "//evil.test" },
      { ...entry, propertyId: 11 }, { ...entry, propertySlug: "other" }]) {
      expect(validBookingPropertyEntry(value, items)).toBeUndefined();
    }
    expect(validBookingPropertyEntry(entry, [...items, { propertyId: 11, propertySlug: "other" }])).toBeUndefined();
  });
});
