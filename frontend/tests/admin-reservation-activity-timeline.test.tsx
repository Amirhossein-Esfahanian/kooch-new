import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";
import { apiRequest } from "@/lib/owner-api";

vi.mock("@/lib/owner-api", async (original) => ({
  ...await original<typeof import("@/lib/owner-api")>(), apiRequest: vi.fn(),
}));

const request = vi.mocked(apiRequest);
const reservation = {
  id: 12, reservationNumber: "R-123456", propertyId: 2, propertyName: "اقامتگاه آزمون",
  roomTypeId: 3, roomTypeName: "دبل", guestId: 4, guestName: "مهمان آزمون",
  checkInDate: "2026-10-20", checkOutDate: "2026-10-22", adults: 2, children: 0,
  status: "Confirmed", finalAmount: 1000,
} as ReservationTableItem;

const activity = {
  id: 1, reservationId: 12, actorUserId: null, actorDisplayName: "System",
  activityType: "ReservationCreated", visibility: 0, title: "رزرو ایجاد شد",
  details: "جزئیات رخداد", occurredAtUtc: "2026-10-17T10:30:00Z",
  relatedEntityType: null, relatedEntityId: null,
};

function renderDialog(admin = true, canAddNote = true) {
  return render(<ReservationDetailsDialog canAddInternalNote={canAddNote}
    onOpenChange={vi.fn()} open reservation={reservation} showAdminActivities={admin} />);
}

beforeEach(() => { request.mockReset(); });
afterEach(() => { cleanup(); });

describe("Admin reservation activity timeline", () => {
  it("loads persisted activities and renders title, details, system actor, Persian time and type", async () => {
    request.mockResolvedValue([activity]);
    renderDialog();
    const section = screen.getByText("تاریخچه فعالیت‌ها").closest("section") ?? document.body;
    expect(await within(section).findByText("رزرو ایجاد شد")).toBeTruthy();
    expect(within(section).getByText("جزئیات رخداد")).toBeTruthy();
    expect(within(section).getByText("سیستم")).toBeTruthy();
    expect(within(section).getByText("فعالیت")).toBeTruthy();
    expect(within(section).getByText(/۱۴۰۵/)).toBeTruthy();
    expect(within(section).queryByRole("button", { name: /حذف|ویرایش/ })).toBeNull();
    expect(request).toHaveBeenCalledWith("/admin/reservations/12/activities");
  });

  it("trims a new note, prevents empty submission, appends the response and clears the field", async () => {
    request.mockResolvedValueOnce([]).mockResolvedValueOnce({ ...activity, id: 2,
      actorUserId: 7, actorDisplayName: "مدیر آزمون", activityType: "InternalNote",
      title: "یادداشت داخلی", details: "پیگیری شد" });
    renderDialog();
    await screen.findByText("هنوز فعالیتی ثبت نشده است.");
    const input = screen.getByRole("textbox", { name: "یادداشت داخلی" }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "افزودن یادداشت داخلی" }));
    expect(screen.getByText("متن یادداشت را وارد کنید.")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "  پیگیری شد  " } });
    fireEvent.click(screen.getByRole("button", { name: "افزودن یادداشت داخلی" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/admin/reservations/12/activities/internal-notes",
      { method: "POST", body: JSON.stringify({ details: "پیگیری شد" }) },
    ));
    expect(await screen.findByText("پیگیری شد")).toBeTruthy();
    expect(screen.getByText("مدیر آزمون")).toBeTruthy();
    expect(input.value).toBe("");
    expect(screen.getByText(/فقط برای مدیران است/)).toBeTruthy();
  });

  it("keeps the section out of Owner views and hides note creation without write permission", async () => {
    request.mockResolvedValue([]);
    const view = renderDialog(false);
    expect(screen.queryByText("تاریخچه فعالیت‌ها")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    view.rerender(<ReservationDetailsDialog canAddInternalNote={false} onOpenChange={vi.fn()}
      open reservation={reservation} showAdminActivities />);
    await screen.findByText("هنوز فعالیتی ثبت نشده است.");
    expect(screen.queryByRole("button", { name: "افزودن یادداشت داخلی" })).toBeNull();
  });
});
