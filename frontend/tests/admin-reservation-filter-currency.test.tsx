import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  currencyLabel: "تومان",
}));

vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({
    platformPermissions: [],
    platformRole: "SuperAdmin",
  }),
}));

vi.mock("@/components/admin/ReservationFollowUpRecipients", () => ({
  ReservationFollowUpRecipients: () => null,
}));

vi.mock("@/components/reservations/ManualReservationDialog", () => ({
  ManualReservationDialog: () => null,
}));

vi.mock("@/components/reservations/ReservationDetailsDialog", () => ({
  ReservationDetailsDialog: () => null,
}));

vi.mock("@/components/reservations/ReservationTable", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/reservations/ReservationTable")
  >();
  return { ...actual, ReservationTable: () => <div>جدول رزروها</div> };
});

vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => mocks.currencyLabel };
});

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import AdminReservationsPage from "@/app/admin/reservations/page";

describe("Admin reservation filter currency context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currencyLabel = "تومان";
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === "/admin/properties") return Promise.resolve([]);
      if (path.startsWith("/admin/reservations?")) {
        return Promise.resolve({
          items: [],
          totalCount: 0,
          page: 1,
          pageSize: 10,
          totalPages: 0,
        });
      }
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows one configured unit context and preserves monetary query values", async () => {
    mocks.currencyLabel = "ریال آزمایشی";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminReservationsPage />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "اعمال" }).hasAttribute("disabled"),
      ).toBe(false),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "باز کردن فیلترهای پیشرفته" }),
    );
    expect(screen.getByText("واحد مبالغ: ریال آزمایشی")).toBeTruthy();
    expect(screen.getAllByText(/ریال آزمایشی/)).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("مبلغ کل از"), {
      target: { value: "100000" },
    });
    fireEvent.change(screen.getByLabelText("پرداخت‌شده تا"), {
      target: { value: "75000" },
    });
    fireEvent.change(screen.getByLabelText("باقی‌مانده از"), {
      target: { value: "25000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "اعمال" }));

    await waitFor(() =>
      expect(
        mocks.apiRequest.mock.calls.some(([path]) => {
          const url = new URL(String(path), "https://kooch.test");
          return (
            url.pathname === "/admin/reservations" &&
            url.searchParams.get("totalPriceMin") === "100000" &&
            url.searchParams.get("paidAmountMax") === "75000" &&
            url.searchParams.get("remainingAmountMin") === "25000"
          );
        }),
      ).toBe(true),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the canonical fallback for monetary filters", () => {
    render(<AdminReservationsPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "باز کردن فیلترهای پیشرفته" }),
    );
    expect(screen.getByText("واحد مبالغ: تومان")).toBeTruthy();
  });
});
