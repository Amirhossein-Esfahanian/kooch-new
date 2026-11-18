import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";
import type { AdminManualPayment } from "@/components/reservations/ReservationDetailsDialog";

const mocks = vi.hoisted(() => ({ api: vi.fn(), router: { push: vi.fn(), replace: vi.fn() },
  role: "SuperAdmin", permissions: ["ManageReservations", "ManagePayments"] }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ reservationId: "42" }) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ platformRole: mocks.role, platformPermissions: mocks.permissions,
    authenticated: true, loading: false, workspaces: ["admin"] }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/reservations/ManualReservationDialog", () => ({ ManualReservationDialog: () => null }));
vi.mock("@/lib/owner-api", async original => ({ ...await original<typeof import("@/lib/owner-api")>(), apiRequest: mocks.api }));
vi.mock("@/lib/currency", async original => ({ ...await original<typeof import("@/lib/currency")>(), useSiteCurrencyLabel: () => "ریال" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import AdminReservationDetailsPage from "@/app/admin/reservations/[reservationId]/page";

let details: ReservationTableItem & { isPaymentEligible?: boolean };
let payments: AdminManualPayment[];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "SuperAdmin";
  mocks.permissions = ["ManageReservations", "ManagePayments"];
  payments = [];
  details = { id: 42, reservationId: 42, reservationNumber: "R-TEST42", propertyId: 10,
    propertyName: "اقامتگاه آزمایشی", roomTypeId: 20, roomTypeName: "اتاق آزمایشی", roomId: null,
    guestName: "مهمان آزمایشی", checkInDate: "2035-04-01", checkOutDate: "2035-04-03", adults: 1,
    children: 0, status: "Pending", source: "AdminCreated", currency: "IRR", finalAmount: 200,
    remainingAmount: 200, paidAmount: 0, canPrepareManualPayment: true, allowedStatusTransitions: ["Cancelled"] };
  mocks.api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/admin/properties" || path.endsWith("/activities")) return [];
    if (path === "/admin/reservations/42") return structuredClone(details);
    if (path === "/admin/manual-payments/reservation/42") return structuredClone(payments);
    if (path === "/admin/reservations/42/prepare-payment" && init?.method === "PUT") {
      details = { ...details, status: "ApprovedAwaitingPayment", canPrepareManualPayment: false,
        paymentExpiresAtUtc: new Date(Date.now() + 45 * 60_000).toISOString(), isPaymentEligible: true };
      return structuredClone(details);
    }
    if (path === "/admin/manual-payments" && init?.method === "POST") {
      payments = [{ paymentId: 7, reservationId: 42, amount: 200, currency: "IRR", method: "BankTransfer", paymentDate: "2026-11-18",
        paymentTime: null, referenceNumber: null, destinationBank: null, destinationAccountReference: null, notes: null,
        status: "Pending", verificationStatus: "PendingVerification", submittedAtUtc: new Date().toISOString() }];
      return payments[0];
    }
    if (path === "/admin/manual-payments/7/approve" && init?.method === "POST") {
      details = { ...details, status: "Confirmed", remainingAmount: 0, paidAmount: 200, isPaymentEligible: false };
      payments = payments.map(payment => ({ ...payment, status: "Successful", verificationStatus: "Approved" }));
      return { reservationStatus: "Confirmed", capacityClaimed: true };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
});

it("wires the real dedicated details page from Pending capability through preparation and individual payment", async () => {
  render(<AdminReservationDetailsPage />);
  const prepare = await screen.findByRole("button", { name: "آماده‌سازی برای پرداخت" });
  expect(screen.queryByRole("button", { name: "تأیید رزرو" })).toBeNull();
  expect(screen.queryByRole("button", { name: "ثبت پرداخت دستی" })).toBeNull();
  fireEvent.click(prepare);
  const confirmation = await screen.findByRole("alertdialog", { name: "آماده‌سازی برای پرداخت" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "آماده‌سازی برای پرداخت" }));
  const paymentAction = await screen.findByRole("button", { name: "ثبت پرداخت دستی" });
  expect(screen.getAllByText("مهلت پرداخت", { exact: true }).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "آماده‌سازی برای پرداخت" })).toBeNull();
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations/42").length).toBe(2);
  expect(mocks.api).toHaveBeenCalledWith("/admin/reservations/42/prepare-payment", { method: "PUT" });
  fireEvent.click(paymentAction);
  const paymentForm = await screen.findByRole("dialog", { name: "ثبت پرداخت دستی" });
  expect((within(paymentForm).getByLabelText(/^مبلغ/) as HTMLInputElement).value).toBe("200");
  fireEvent.click(within(paymentForm).getByRole("button", { name: "ثبت پرداخت" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "ثبت پرداخت دستی" })).toBeNull());
  fireEvent.click(await screen.findByRole("button", { name: "تأیید پرداخت" }));
  const approve = await screen.findByRole("alertdialog", { name: "تأیید پرداخت دستی" });
  fireEvent.click(within(approve).getByRole("button", { name: "تأیید پرداخت" }));
  await waitFor(() => expect(screen.getByText("تایید شده", { exact: true })).toBeTruthy());
  expect(screen.queryByRole("button", { name: "ثبت پرداخت دستی" })).toBeNull();
  const body = JSON.parse(mocks.api.mock.calls.find(([path]) => path === "/admin/manual-payments")![1].body);
  expect(body).toMatchObject({ reservationId: 42, amount: 200, currency: "IRR", method: "BankTransfer" });
});

it.each([false, undefined])("never invents a capability when the API sends %s", async capability => {
  details.canPrepareManualPayment = capability;
  render(<AdminReservationDetailsPage />);
  await screen.findByRole("heading", { level: 1, name: /R-TEST/ });
  expect(screen.queryByRole("button", { name: "آماده‌سازی برای پرداخت" })).toBeNull();
  expect(mocks.api.mock.calls.some(([path]) => path.endsWith("/prepare-payment"))).toBe(false);
});

it("keeps preparation independent of the separate ManagePayments permission", async () => {
  mocks.role = "AdminAssistant";
  mocks.permissions = ["ManageReservations"];
  render(<AdminReservationDetailsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "آماده‌سازی برای پرداخت" }));
  const confirmation = await screen.findByRole("alertdialog", { name: "آماده‌سازی برای پرداخت" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "آماده‌سازی برای پرداخت" }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/admin/reservations/42/prepare-payment", { method: "PUT" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.queryByRole("button", { name: "ثبت پرداخت دستی" })).toBeNull();
  expect(mocks.api.mock.calls.some(([path]) => path.startsWith("/admin/manual-payments"))).toBe(false);
});
