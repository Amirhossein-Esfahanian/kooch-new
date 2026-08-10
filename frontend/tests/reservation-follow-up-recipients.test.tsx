import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  assign: vi.fn(),
  deactivate: vi.fn(),
  get: vi.fn(),
  search: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/reservation-follow-up", () => ({
  assignReservationFollowUpRecipient: api.assign,
  deactivateReservationFollowUpRecipient: api.deactivate,
  getReservationFollowUpRecipients: api.get,
  searchReservationFollowUpCandidates: api.search,
}));

import { ReservationFollowUpRecipients } from "@/components/admin/ReservationFollowUpRecipients";

describe("ReservationFollowUpRecipients", () => {
  beforeEach(() => {
    api.assign.mockReset().mockResolvedValue(undefined);
    api.deactivate.mockReset().mockResolvedValue(undefined);
    api.get.mockReset().mockResolvedValue([]);
    api.search.mockReset().mockResolvedValue([
      {
        userId: 12,
        fullName: "همکار مجاز",
        email: "staff@example.test",
        phoneNumber: null,
      },
    ]);
  });

  it("lets an admin select an eligible platform colleague and refreshes the lists", async () => {
    render(<ReservationFollowUpRecipients propertyId={42} />);

    expect(await screen.findByText("پیگیری رزروهای استعلامی")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "همکار مدیریت سایت" }));
    fireEvent.click(await screen.findByRole("button", { name: /همکار مجاز/ }));
    fireEvent.click(screen.getByRole("button", { name: "افزودن پیگیر" }));

    await waitFor(() => expect(api.assign).toHaveBeenCalledWith(42, 12));
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText(/هیچ دسترسی جدیدی ایجاد نمی‌کند/)).toBeTruthy();
  });

  it("deactivates an existing assignment through a confirmation dialog", async () => {
    api.get.mockResolvedValue([
      {
        userId: 15,
        fullName: "پیگیر فعلی",
        email: "follow-up@example.test",
        phoneNumber: null,
        isActive: true,
      },
    ]);
    render(<ReservationFollowUpRecipients propertyId={42} />);

    expect(await screen.findByText("پیگیر فعلی")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "غیرفعال‌سازی" }));
    const confirmationButtons = await screen.findAllByRole("button", { name: "غیرفعال‌سازی" });
    fireEvent.click(confirmationButtons.at(-1)!);

    await waitFor(() => expect(api.deactivate).toHaveBeenCalledWith(42, 15));
  });
});
