import { describe, expect, it } from "vitest";
import { initialFilters, readReservationListState, reservationDetailsHref, reservationListHref, safeReservationReturnHref } from "@/components/reservations/admin-reservation-navigation";

describe("Admin reservation routing context", () => {
  it("round-trips every list filter and page without confusing a number filter with an inbound details link", () => {
    const filters = { ...initialFilters };
    Object.keys(filters).forEach((key, index) => Object.assign(filters, { [key]: `value-${index}` }));
    const origin = reservationListHref(filters, 4);
    const details = new URL(reservationDetailsHref(37, origin), "https://test.invalid");
    expect(details.pathname).toBe("/admin/reservations/37");
    expect(details.searchParams.get("returnTo")).toBe(origin);
    const params = new URL(origin, "https://test.invalid").searchParams;
    expect(params.has("reservationNumber")).toBe(false);
    expect(readReservationListState(params)).toEqual({ filters, page: 4 });
    expect(safeReservationReturnHref(origin)).toBe(origin);
  });
  it.each([null, "https://evil.invalid/admin/reservations", "//evil.invalid/admin/reservations", "/admin/users", "/admin/reservations/37", "/admin/reservations#unsafe"])("returns directly entered or unsafe context %s to the default list", value => {
    expect(safeReservationReturnHref(value)).toBe("/admin/reservations");
  });
  it.each(["0", "-1", "NaN", "1.5", "9007199254740993", ""])("uses page one for malformed pagination %s", page => {
    expect(readReservationListState(new URLSearchParams({ page })).page).toBe(1);
  });
  it("does not pass unknown query parameters or legacy action IDs into the return link", () => {
    expect(safeReservationReturnHref("/admin/reservations?status=Confirmed&reservationId=99&other=secret&page=2"))
      .toBe("/admin/reservations?status=Confirmed&page=2");
    expect(reservationDetailsHref(37)).toBe("/admin/reservations/37");
  });
});
