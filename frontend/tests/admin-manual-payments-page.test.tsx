import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  dialogProps: null as Record<string, unknown> | null,
  permissions: ["ManagePayments"],
  role: "AdminAssistant" as "AdminAssistant" | "SuperAdmin",
  toastWarning: vi.fn(),
}));

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({
    platformPermissions: mocks.permissions,
    platformRole: mocks.role,
  }),
}));

vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/reservations/ManualReservationDialog", () => ({
  ManualReservationDialog: () => null,
}));

vi.mock("@/components/reservations/ReservationTable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/reservations/ReservationTable")>();
  return {
    ...actual,
    ReservationTable: ({ onView }: { onView: (item: unknown) => void }) => (
      <button onClick={() => onView({
        id: 12,
        reservationNumber: "RSV-12",
        status: "ApprovedAwaitingPayment",
        checkInDate: "2026-09-20",
        checkOutDate: "2026-09-22",
      })}>
        مشاهده رزرو آزمون
      </button>
    ),
  };
});

vi.mock("@/components/reservations/ReservationDetailsDialog", () => ({
  ReservationDetailsDialog: (props: Record<string, unknown>) => {
    mocks.dialogProps = props;
    const create = props.onCreateManualPayment as ((reservation: unknown, payload: unknown) => Promise<void>) | undefined;
    const approve = props.onApproveManualPayment as ((paymentId: number) => Promise<void>) | undefined;
    const reject = props.onRejectManualPayment as ((paymentId: number, reason: string) => Promise<void>) | undefined;
    return (
      <div>
        <span>پرداخت‌ها: {Array.isArray(props.manualPayments) ? props.manualPayments.length : 0}</span>
        {create && <button onClick={() => void create(props.reservation, {
          amount: 200000,
          currency: "IRR",
          method: "BankTransfer",
          paymentDate: "2026-09-25",
          paymentTime: null,
          referenceNumber: null,
          destinationBank: null,
          destinationAccountReference: null,
          notes: null,
        }).catch(() => undefined)}>ثبت آزمایشی</button>}
        {approve && <button onClick={() => void approve(41).catch(() => undefined)}>تأیید آزمایشی</button>}
        {reject && <button onClick={() => void reject(41, "رد آزمون").catch(() => undefined)}>رد آزمایشی</button>}
      </div>
    );
  },
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => "تومان" };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: mocks.toastWarning },
}));

import AdminReservationsPage from "@/app/admin/reservations/page";
import { ApiRequestError } from "@/lib/owner-api";

const reservationDetails = {
  id: 12,
  reservationNumber: "RSV-12",
  status: "ApprovedAwaitingPayment",
  checkInDate: "2026-09-20",
  checkOutDate: "2026-09-22",
  remainingAmount: 200000,
  currency: "IRR",
};

const manualPayment = {
  paymentId: 41,
  reservationId: 12,
  amount: 200000,
  currency: "IRR",
  status: "Pending",
  method: "BankTransfer",
  verificationStatus: "PendingVerification",
  paymentDate: "2026-09-25",
  submittedAtUtc: "2026-09-25T09:00:00Z",
};

function installApi() {
  mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/admin/properties") return Promise.resolve([]);
    if (path.startsWith("/admin/reservations?")) {
      return Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 10, totalPages: 0 });
    }
    if (path === "/admin/reservations/12") return Promise.resolve(reservationDetails);
    if (path === "/admin/manual-payments/reservation/12") return Promise.resolve([manualPayment]);
    if (path === "/admin/manual-payments" && init?.method === "POST") return Promise.resolve(manualPayment);
    if (path === "/admin/manual-payments/41/approve") {
      return Promise.resolve({ ...manualPayment, reservationStatus: "CapacityLost", status: "Successful" });
    }
    if (path === "/admin/manual-payments/41/reject") {
      return Promise.resolve({ ...manualPayment, verificationStatus: "Rejected", status: "Failed" });
    }
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });
}

describe("Admin manual payment page integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dialogProps = null;
    mocks.permissions = ["ManagePayments"];
    mocks.role = "AdminAssistant";
    installApi();
  });

  it("loads manual payments with reservation details for ManagePayments actors", async () => {
    render(<AdminReservationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "مشاهده رزرو آزمون" }));

    await screen.findByText("پرداخت‌ها: 1");
    expect(mocks.apiRequest).toHaveBeenCalledWith("/admin/manual-payments/reservation/12");
  });

  it("posts the create payload without evidence and refreshes the current reservation", async () => {
    render(<AdminReservationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "مشاهده رزرو آزمون" }));
    fireEvent.click(await screen.findByRole("button", { name: "ثبت آزمایشی" }));

    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/admin/manual-payments",
      expect.objectContaining({ method: "POST" }),
    ));
    const createCall = mocks.apiRequest.mock.calls.find(([path]) => path === "/admin/manual-payments");
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body.reservationId).toBe(12);
    expect(body).not.toHaveProperty("evidenceFilePath");
    await waitFor(() => expect(
      mocks.apiRequest.mock.calls.filter(([path]) => path === "/admin/reservations/12").length,
    ).toBeGreaterThan(1));
  });

  it("uses the existing approve and reject endpoints and refreshes after each mutation", async () => {
    render(<AdminReservationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "مشاهده رزرو آزمون" }));
    fireEvent.click(await screen.findByRole("button", { name: "تأیید آزمایشی" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/admin/manual-payments/41/approve",
      { method: "POST" },
    ));
    fireEvent.click(screen.getByRole("button", { name: "رد آزمایشی" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/admin/manual-payments/41/reject",
      { method: "POST", body: JSON.stringify({ reason: "رد آزمون" }) },
    ));
  });

  it("does not fetch or expose manual-payment actions without ManagePayments", async () => {
    mocks.permissions = ["ManageReservations"];
    render(<AdminReservationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "مشاهده رزرو آزمون" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/admin/reservations/12"));

    expect(mocks.apiRequest).not.toHaveBeenCalledWith("/admin/manual-payments/reservation/12");
    expect(screen.queryByRole("button", { name: "ثبت آزمایشی" })).toBeNull();
    expect(screen.queryByRole("button", { name: "تأیید آزمایشی" })).toBeNull();
  });

  it("shows a clear conflict message and refreshes after a 409", async () => {
    let approveAttempts = 0;
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === "/admin/properties") return Promise.resolve([]);
      if (path.startsWith("/admin/reservations?")) {
        return Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 10, totalPages: 0 });
      }
      if (path === "/admin/reservations/12") return Promise.resolve(reservationDetails);
      if (path === "/admin/manual-payments/reservation/12") return Promise.resolve([manualPayment]);
      if (path === "/admin/manual-payments/41/approve") {
        approveAttempts += 1;
        return Promise.reject(new ApiRequestError("Conflict", 409));
      }
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });

    render(<AdminReservationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "مشاهده رزرو آزمون" }));
    await screen.findByText("پرداخت‌ها: 1");
    const initialReads = mocks.apiRequest.mock.calls.filter(
      ([path]) => path === "/admin/manual-payments/reservation/12",
    ).length;
    fireEvent.click(screen.getByRole("button", { name: "تأیید آزمایشی" }));

    await waitFor(() => expect(approveAttempts).toBe(1));
    await waitFor(() => expect(
      mocks.apiRequest.mock.calls.filter(
        ([path]) => path === "/admin/manual-payments/reservation/12",
      ).length,
    ).toBeGreaterThan(initialReads));
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "این پرداخت قبلاً توسط مدیر دیگری بررسی شده است. اطلاعات به‌روز شد.",
    );
  });
});
