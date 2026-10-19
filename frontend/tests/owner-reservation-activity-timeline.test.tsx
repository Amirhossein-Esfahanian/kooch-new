import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";
import { apiRequest } from "@/lib/owner-api";

vi.mock("@/lib/owner-api", async (original) => ({
  ...await original<typeof import("@/lib/owner-api")>(), apiRequest: vi.fn(),
}));

interface OwnerActivity {
  activityType: string;
  title: string;
  details: string | null;
  actorDisplayName: string;
  occurredAtUtc: string;
}

const request = vi.mocked(apiRequest);
const reservation = {
  id: 23, reservationNumber: "R-123456", propertyId: 7, propertyName: "اقامتگاه آزمون",
  roomTypeId: 3, roomTypeName: "دبل", guestId: 4, guestName: "مهمان آزمون",
  checkInDate: "2026-10-20", checkOutDate: "2026-10-22", adults: 2, children: 0,
  status: "Confirmed", finalAmount: 1000,
} as ReservationTableItem;

const created: OwnerActivity = {
  activityType: "Created", title: "رزرو ایجاد شد", details: null,
  actorDisplayName: "System", occurredAtUtc: "2026-10-17T10:30:00Z",
};
const approved: OwnerActivity = {
  activityType: "Approved", title: "درخواست رزرو تأیید شد", details: "تأیید اقامتگاه",
  actorDisplayName: "مالک آزمون", occurredAtUtc: "2026-10-18T11:30:00Z",
};

function page(items: OwnerActivity[], pageNumber = 1, totalPages = 1) {
  return { items, totalCount: totalPages, page: pageNumber, pageSize: 20, totalPages };
}

function renderOwner(item = reservation, propertyId = 7) {
  return render(<ReservationDetailsDialog onOpenChange={vi.fn()} open
    ownerActivityPropertyId={propertyId} reservation={item} />);
}

beforeEach(() => { request.mockReset(); });
afterEach(() => { cleanup(); });

describe("Owner reservation activity timeline", () => {
  it("loads the selected Property and Reservation, then renders the safe timeline read-only", async () => {
    request.mockResolvedValue(page([created, approved]));
    renderOwner();
    const section = screen.getByText("تاریخچه فعالیت‌ها").closest("section") ?? document.body;
    expect(within(section).getByText(/در حال دریافت فعالیت‌ها/)).toBeTruthy();
    expect(await within(section).findByText("رزرو ایجاد شد")).toBeTruthy();
    expect(within(section).getByText("درخواست رزرو تأیید شد")).toBeTruthy();
    expect(within(section).getByText("تأیید اقامتگاه")).toBeTruthy();
    expect(within(section).getByText("سیستم")).toBeTruthy();
    expect(within(section).getByText("مالک آزمون")).toBeTruthy();
    const times = section.querySelectorAll("time");
    expect(times[0].getAttribute("datetime")).toBe(created.occurredAtUtc);
    expect(times[0].textContent).toMatch(/۱۴۰۵/);
    expect(request).toHaveBeenCalledWith("/owner/properties/7/reservations/23/activities?page=1&pageSize=20");
    expect(request.mock.calls.some(([path]) => String(path).includes("/admin/"))).toBe(false);
    expect(within(section).queryByRole("textbox")).toBeNull();
    expect(within(section).queryByRole("link")).toBeNull();
    expect(within(section).queryByText(/یادداشت داخلی|AdminTask/)).toBeNull();
  });

  it("loads the next page once and keeps the chronological list without duplicates", async () => {
    let finishPageTwo!: (value: ReturnType<typeof page>) => void;
    request.mockResolvedValueOnce(page([created], 1, 2))
      .mockImplementationOnce(() => new Promise((resolve) => { finishPageTwo = resolve; }));
    renderOwner();
    await screen.findByText("رزرو ایجاد شد");
    const more = screen.getByRole("button", { name: "نمایش فعالیت‌های بیشتر" });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(request).toHaveBeenCalledTimes(2);
    finishPageTwo(page([approved], 2, 2));
    await screen.findByText("درخواست رزرو تأیید شد");
    const section = screen.getByText("تاریخچه فعالیت‌ها").closest("section") ?? document.body;
    expect(section.querySelectorAll("ol > li")).toHaveLength(2);
    expect(Array.from(section.querySelectorAll("ol > li strong")).map((item) => item.textContent))
      .toEqual(["رزرو ایجاد شد", "درخواست رزرو تأیید شد"]);
    expect(request).toHaveBeenLastCalledWith("/owner/properties/7/reservations/23/activities?page=2&pageSize=20");
    expect(within(section).queryByRole("button", { name: "نمایش فعالیت‌های بیشتر" })).toBeNull();
  });

  it("shows empty and error states, and retries a failed later page without discarding loaded items", async () => {
    request.mockResolvedValueOnce(page([]));
    const first = renderOwner();
    expect(await screen.findByText("هنوز فعالیتی ثبت نشده است.")).toBeTruthy();
    first.unmount();

    request.mockReset();
    request.mockResolvedValueOnce(page([created], 1, 2))
      .mockRejectedValueOnce(new Error("خطای شبکه"))
      .mockResolvedValueOnce(page([approved], 2, 2));
    renderOwner();
    await screen.findByText("رزرو ایجاد شد");
    fireEvent.click(screen.getByRole("button", { name: "نمایش فعالیت‌های بیشتر" }));
    expect(await screen.findByText("خطای شبکه")).toBeTruthy();
    expect(screen.getByText("رزرو ایجاد شد")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByText("درخواست رزرو تأیید شد")).toBeTruthy();
    expect(screen.getAllByText("رزرو ایجاد شد")).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not retain activities from a previously selected reservation", async () => {
    let finishOld!: (value: ReturnType<typeof page>) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(page([approved]));
    const view = renderOwner();
    view.rerender(<ReservationDetailsDialog onOpenChange={vi.fn()} open
      ownerActivityPropertyId={8} reservation={{ ...reservation, id: 24, propertyId: 8 }} />);
    expect(await screen.findByText("درخواست رزرو تأیید شد")).toBeTruthy();
    finishOld(page([created]));
    await waitFor(() => expect(screen.queryByText("رزرو ایجاد شد")).toBeNull());
    expect(request).toHaveBeenLastCalledWith("/owner/properties/8/reservations/24/activities?page=1&pageSize=20");
  });
});
