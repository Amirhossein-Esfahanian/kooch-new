import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  detail: null as Record<string, unknown> | null,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  permissions: ["ManagePayments", "ManageReservations"],
  role: "AdminAssistant" as "AdminAssistant" | "SuperAdmin",
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ platformPermissions: mocks.permissions, platformRole: mocks.role }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/reservations/ManualReservationDialog", () => ({ ManualReservationDialog: () => null }));
vi.mock("@/components/reservations/ReservationTable", () => ({
  ReservationTable: ({ onView }: { onView: (item: unknown) => void }) => (
    <button onClick={() => onView({ id: 12, reservationNumber: "R-123456" })}>مشاهده رزرو آزمون</button>
  ),
}));
vi.mock("@/components/reservations/ReservationDetailsDialog", () => ({
  ReservationDetailsDialog: (props: Record<string, unknown>) => {
    mocks.detail = props;
    const item = props.reservation as { status?: string; cancellationFinancial?: { refundPending?: boolean };
      cancellationRequest?: { status?: string } | null } | null;
    const cancel = props.onCancel as ((item: unknown, payload: unknown) => Promise<void>) | undefined;
    const refund = props.onRefund as ((item: unknown, payload: unknown) => Promise<void>) | undefined;
    const rejectRequest = props.onRejectCancellationRequest as ((item: unknown, note: string | null) => Promise<void>) | undefined;
    return <div>
      <span>Cancellation request: {item?.cancellationRequest?.status ?? "-"}</span>
      {item?.cancellationRequest?.status === "Pending" && rejectRequest &&
        <button onClick={() => void rejectRequest(item, "نیاز به بررسی").catch(() => undefined)}>Reject guest request</button>}
      <span>وضعیت جزئیات: {item?.status ?? "-"}</span>
      <span>بازپرداخت در انتظار: {String(item?.cancellationFinancial?.refundPending ?? false)}</span>
      {item && cancel && <button onClick={() => void cancel(item, {
        reason: "GuestRequest", explanation: "درخواست مهمان", idempotencyKey: "cancel-key",
        financialResolution: { mode: "AutomaticFullRefundV1" },
      }).catch(() => undefined)}>ارسال لغو</button>}
      {item && refund && <button onClick={() => void refund(item, {
        referenceNumber: "001234", refundedAt: "2026-09-29T10:00:00Z",
        reason: "اصلاح رزرو", note: null, idempotencyKey: "refund-key",
      }).catch(() => undefined)}>ارسال بازپرداخت</button>}
    </div>;
  },
}));
vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});
vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => "واحد" };
});
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess, warning: vi.fn() },
}));

import AdminReservationsPage from "@/app/admin/reservations/page";
import { ApiRequestError } from "@/lib/owner-api";

const financial = {
  paidCancellation: true, grossPaidAmount: 1000, currency: "IRR", mode: "AutomaticFullRefundV1",
  guestRefundAmount: 1000, finalPropertyShare: 0, finalKoochShare: 0,
  refundPending: true, alreadyHandledByLegacyRefundV1: false,
};
const initial = { id: 12, reservationNumber: "R-123456", status: "Confirmed",
  cancellationFinancial: { ...financial, mode: null, guestRefundAmount: null,
    finalPropertyShare: null, finalKoochShare: null, refundPending: false } };

let current: typeof initial | Record<string, unknown>;
let mutationFailure: ApiRequestError | null;
let detailReads: number;
let rejectRequestPromise: Promise<unknown> | null;

function installApi() {
  mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/admin/properties") return Promise.resolve([]);
    if (path.startsWith("/admin/reservations?"))
      return Promise.resolve({ items: [], totalCount: 0, page: 1, pageSize: 10, totalPages: 0 });
    if (path === "/admin/manual-payments/reservation/12") return Promise.resolve([]);
    if (path === "/admin/reservations/12") { detailReads += 1; return Promise.resolve(current); }
    if (path === "/admin/reservations/12/cancellation-request/reject" && init?.method === "PUT") {
      if (mutationFailure) return Promise.reject(mutationFailure);
      if (rejectRequestPromise) return rejectRequestPromise;
      current = { ...current, cancellationRequest: {
        ...(current as { cancellationRequest?: Record<string, unknown> }).cancellationRequest,
        status: "Rejected", resolutionNote: "نیاز به بررسی",
      } };
      return Promise.resolve(current);
    }
    if (path === "/admin/reservations/12/cancel" && init?.method === "PUT") {
      if (mutationFailure) return Promise.reject(mutationFailure);
      current = { ...current, status: "Cancelled", cancellationFinancial: { ...financial } };
      return Promise.resolve({ ...current, cancellationOutcome: { paidCancellation: true } });
    }
    if (path === "/admin/reservations/12/refund" && init?.method === "POST") {
      if (mutationFailure) return Promise.reject(mutationFailure);
      current = { ...current, cancellationFinancial: { ...financial, refundPending: false } };
      return Promise.resolve({ reservationId: 12 });
    }
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });
}

async function openPage() {
  render(<AdminReservationsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "مشاهده رزرو آزمون" }));
  await waitFor(() => expect(detailReads).toBe(1));
}

describe("Admin cancellation and refund API integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detail = null;
    mocks.permissions = ["ManagePayments", "ManageReservations"];
    current = { ...initial };
    mutationFailure = null;
    detailReads = 0;
    rejectRequestPromise = null;
    installApi();
  });

  it("rejects a pending guest request, then reads its authoritative status without cancelling the reservation", async () => {
    current = { ...initial, cancellationRequest: { status: "Pending", reason: "GuestRequest" } };
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "Reject guest request" }));
    await waitFor(() => expect(detailReads).toBe(2));
    const calls = mocks.apiRequest.mock.calls.filter(([path]) => path === "/admin/reservations/12/cancellation-request/reject");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({ note: "نیاز به بررسی" });
    expect(screen.getByText("Cancellation request: Rejected")).toBeTruthy();
    expect((current as { status: string }).status).toBe("Confirmed");
  });

  it("keeps a pending request visible when rejection fails", async () => {
    current = { ...initial, cancellationRequest: { status: "Pending", reason: "GuestRequest" } };
    mutationFailure = new ApiRequestError("Request conflict", 409);
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "Reject guest request" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Request conflict"));
    expect(detailReads).toBe(1);
    expect(screen.getByText("Cancellation request: Pending")).toBeTruthy();
  });

  it("does not issue a second rejection while the first is pending", async () => {
    current = { ...initial, cancellationRequest: { status: "Pending", reason: "GuestRequest" } };
    let finish!: (value: unknown) => void;
    rejectRequestPromise = new Promise((resolve) => { finish = resolve; });
    await openPage();
    const button = screen.getByRole("button", { name: "Reject guest request" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === "/admin/reservations/12/cancellation-request/reject")).toHaveLength(1);
    finish({});
    await waitFor(() => expect(detailReads).toBe(2));
  });

  it("sends the paid cancellation payload and refreshes authoritative detail after success", async () => {
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "ارسال لغو" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/admin/reservations/12/cancel", expect.objectContaining({ method: "PUT" }),
    ));
    const call = mocks.apiRequest.mock.calls.find(([path]) => path === "/admin/reservations/12/cancel");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      reason: "GuestRequest", explanation: "درخواست مهمان", idempotencyKey: "cancel-key",
      financialResolution: { mode: "AutomaticFullRefundV1" },
    });
    await waitFor(() => expect(detailReads).toBe(2));
    expect(await screen.findByText("وضعیت جزئیات: Cancelled")).toBeTruthy();
    expect(screen.getByText("بازپرداخت در انتظار: true")).toBeTruthy();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("لغو و تعیین تکلیف مالی رزرو با موفقیت انجام شد.");
  });

  it("posts only refund execution facts, then re-reads pending state from backend", async () => {
    current = { ...initial, status: "Cancelled", cancellationFinancial: { ...financial } };
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "ارسال بازپرداخت" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/admin/reservations/12/refund", expect.objectContaining({ method: "POST" }),
    ));
    const call = mocks.apiRequest.mock.calls.find(([path]) => path === "/admin/reservations/12/refund");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      referenceNumber: "001234", refundedAt: "2026-09-29T10:00:00Z",
      reason: "اصلاح رزرو", note: null, idempotencyKey: "refund-key",
    });
    await waitFor(() => expect(detailReads).toBe(2));
    expect(await screen.findByText("بازپرداخت در انتظار: false")).toBeTruthy();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("بازپرداخت مهمان با موفقیت ثبت شد.");
  });

  it("shows the specific post-settlement conflict and leaves the reservation uncancelled", async () => {
    mutationFailure = new ApiRequestError("Conflict", 409, { code: "PostSettlementNettingRequired" });
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "ارسال لغو" }));
    await waitFor(() => expect(detailReads).toBe(2));
    expect(screen.getByText("وضعیت جزئیات: Confirmed")).toBeTruthy();
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining("فرآیند اصلاح تسویه"));
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === "/admin/reservations/12/cancel")).toHaveLength(1);
  });

  it.each([
    ["NoGuestRefundRequired", "مبلغی جهت بازپرداخت"],
    ["RefundAlreadyRecorded", "قبلاً ثبت شده است"],
    ["RefundIdempotencyConflict", "متفاوت است"],
  ])("shows %s without auto-retry and refreshes detail", async (code, message) => {
    current = { ...initial, status: "Cancelled", cancellationFinancial: { ...financial } };
    mutationFailure = new ApiRequestError("Conflict", 409, { code });
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "ارسال بازپرداخت" }));
    await waitFor(() => expect(detailReads).toBe(2));
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === "/admin/reservations/12/refund")).toHaveLength(1);
  });

  it("does not expose a refund callback without ManagePayments", async () => {
    mocks.permissions = ["ManageReservations"];
    await openPage();
    expect(mocks.detail?.onRefund).toBeUndefined();
    expect(mocks.apiRequest).not.toHaveBeenCalledWith("/admin/manual-payments/reservation/12");
  });
});
