import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => "تومان" };
});

import { ReservationTable, type ReservationTableItem } from "@/components/reservations/ReservationTable";

const reservation: ReservationTableItem = {
  reservationId: 12,
  reservationNumber: "R-123456",
  guestName: "مهمان آزمون",
  propertyName: "اقامتگاه آزمون",
  roomTypeName: "استاندارد",
  checkInDate: "2026-10-10",
  checkOutDate: "2026-10-12",
  status: "Confirmed",
  finalAmount: 1000,
  remainingAmount: 0,
};

function renderTable(item: ReservationTableItem, context: "admin" | "owner" = "admin") {
  const onView = vi.fn();
  render(<ReservationTable context={context} currentPage={1} loading={false}
    onPageChange={vi.fn()} onView={onView} reservations={[item]} totalPages={1} />);
  return onView;
}

describe("Admin reservation pending cancellation request badge", () => {
  it("shows a separate compact request badge without changing reservation status or details action", () => {
    const item = { ...reservation, hasPendingCancellationRequest: true };
    const onView = renderTable(item);
    const row = screen.getByRole("row", { name: /مهمان آزمون/ });
    expect(within(row).getByText("تایید شده")).toBeTruthy();
    expect(within(row).getByText("درخواست لغو")).toBeTruthy();
    expect(within(row).queryByText("لغو شده")).toBeNull();
    expect(within(row).queryByRole("button", { name: /رد درخواست|لغو رزرو/ })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "مشاهده رزرو" }));
    expect(onView).toHaveBeenCalledWith(item);
  });

  it("does not show a badge when the backend flag is false", () => {
    renderTable({ ...reservation, hasPendingCancellationRequest: false });
    expect(screen.queryByText("درخواست لغو")).toBeNull();
    expect(screen.getByText("تایید شده")).toBeTruthy();
  });

  it("does not show the Admin-only badge in the Owner table", () => {
    renderTable({ ...reservation, hasPendingCancellationRequest: true }, "owner");
    expect(screen.queryByText("درخواست لغو")).toBeNull();
    expect(screen.getByText("تایید شده")).toBeTruthy();
  });
});
