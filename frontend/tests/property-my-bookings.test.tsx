import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), auth: { authenticated: true, loading: false, user: { userId: 7 } } }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.auth }));
vi.mock("@/components/booking/PropertyGuestAccount", () => ({ PropertyGuestAccount: () => null }));
vi.mock("@/components/booking/CheckoutIdentityStep", () => ({ CheckoutIdentityStep: () => <p>ورود برای مشاهده رزروها</p> }));
vi.mock("@/lib/booking-sessions", () => ({ fetchAccountBookingSessions: mocks.fetch }));
vi.mock("@/lib/currency", () => ({ useSiteCurrencyLabel: () => "ریال", formatCurrency: (value: number) => `${value} ریال` }));
import { PropertyMyBookings } from "@/components/booking/PropertyMyBookings";
import { metadata } from "@/app/book/[slug]/my-bookings/page";
vi.mock("@/lib/public-properties.server", () => ({ getPublicBookingProperty: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
const property = { id: 2, name: "اقامتگاه باغ", slug: "garden" };
function response() { return { page: 1, pageSize: 10, totalCount: 11, totalPages: 2, items: [{
  sessionCode: "S-1", commissionType: 2, property: { propertyId: 2, name: property.name, slug: "garden" }, checkInDate: "2030-01-01", checkOutDate: "2030-01-02", totalAmount: 700, derivedStatus: "ReadyForPayment", currency: "IRR", reservations: [{ reservationNumber: "R-1", roomTypeName: "اتاق باغ", roomName: null, status: "ApprovedAwaitingPayment", finalAmount: 700 }],
}] }; }
describe("Property My Bookings", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.authenticated = true; mocks.fetch.mockResolvedValue(response()); });
  it("requests server-scoped pagination and renders authoritative room, reference, amount and detail link", async () => {
    render(<PropertyMyBookings property={property} />);
    expect(await screen.findByText("S-1")).toBeTruthy();
    expect(screen.getByText("R-1")).toBeTruthy();
    expect(screen.getByText(/اتاق باغ/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "جزئیات رزرو و پرداخت" }).getAttribute("href")).toBe("/book/garden/reservations/S-1");
    expect(mocks.fetch).toHaveBeenCalledWith(1, 10, { propertyId: 2, commissionType: 2 });
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(2, 10, { propertyId: 2, commissionType: 2 }));
    expect(document.body.textContent).not.toMatch(/کیف پول|Marketplace/);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it.each([0, 1, null, undefined])("rejects mixed or missing channel %s rather than client-side filtering", async (commissionType) => {
    const value = response(); mocks.fetch.mockResolvedValue({ ...value, items: [{ ...value.items[0], commissionType }] });
    render(<PropertyMyBookings property={property} />);
    expect(await screen.findByText(/دریافت رزروها انجام نشد/)).toBeTruthy();
    expect(screen.queryByText("R-1")).toBeNull();
  });
  it("rejects a wrong Property response", async () => {
    const value = response(); value.items[0].property.propertyId = 99; mocks.fetch.mockResolvedValue(value);
    render(<PropertyMyBookings property={property} />);
    expect(await screen.findByText(/دریافت رزروها انجام نشد/)).toBeTruthy();
    expect(screen.queryByText("R-1")).toBeNull();
  });
  it("handles loading, error, retry and empty independently", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("403"));
    render(<PropertyMyBookings property={property} />);
    expect(screen.getByText("در حال بارگذاری رزروها...")).toBeTruthy();
    expect(await screen.findByText(/دریافت رزروها انجام نشد/)).toBeTruthy();
    mocks.fetch.mockResolvedValue({ ...response(), items: [], totalCount: 0, totalPages: 0 });
    fireEvent.click(screen.getByRole("button", { name: "تلاش مجدد" }));
    expect(await screen.findByText(/هنوز رزروی از لینک عمومی/)).toBeTruthy();
  });
  it("requires authentication again after logout and discards stale pending responses", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<PropertyMyBookings property={property} />);
    mocks.auth.authenticated = false; view.rerender(<PropertyMyBookings property={property} />);
    expect(screen.getByText("ورود برای مشاهده رزروها")).toBeTruthy();
    resolve(response());
    expect(screen.queryByText("R-1")).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("ignores old Property requests after Property switching", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = render(<PropertyMyBookings property={property} />);
    mocks.fetch.mockResolvedValue({ ...response(), items: [], totalPages: 0 });
    view.rerender(<PropertyMyBookings property={{ id: 3, slug: "other", name: "دیگر" }} />);
    expect(await screen.findByText(/هنوز رزروی از لینک عمومی/)).toBeTruthy();
    resolve(response());
    expect(screen.queryByText("R-1")).toBeNull();
    expect(mocks.fetch).toHaveBeenLastCalledWith(1, 10, { propertyId: 3, commissionType: 2 });
  });
});
