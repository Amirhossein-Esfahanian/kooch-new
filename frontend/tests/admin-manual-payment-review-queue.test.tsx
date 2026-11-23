import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/owner-api", async original => ({ ...(await original<typeof import("@/lib/owner-api")>()), apiRequest: mocks.request }));
import { ManualPaymentReviewQueue, type ManualPaymentReviewItem } from "@/components/reservations/ManualPaymentReviewQueue";

const receipt: ManualPaymentReviewItem = { paymentId: 1, reservationId: 37, reservationNumber: "R-37", orderCode: "O-12",
  propertyId: 3, propertyName: "اقامتگاه آزمون", guestName: "مهمان آزمون", amount: 5000000, currency: "IRR", method: "BankTransfer",
  createdAtUtc: "2026-11-20T12:00:00Z", paymentExpiresAtUtc: "2026-11-21T12:00:00Z",
  reviewProtectionExpiresAtUtc: "2026-11-22T12:00:00Z", reservationStatus: "ApprovedAwaitingPayment", reviewState: "Protected" };
const response = (items = [receipt], page = 1, totalCount = 21) => ({ items, page, pageSize: 20, totalCount, totalPages: Math.ceil(totalCount / 20) });

describe("pending manual receipt queue", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.request.mockResolvedValue(response()); });
  it("renders authoritative dates, references, currency and financial-tab navigation with list context", async () => {
    render(<ManualPaymentReviewQueue propertyId={3} returnTo="/admin/reservations?propertyId=3&page=4" />);
    const link = await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    const url = new URL(link.getAttribute("href")!, "https://test.invalid");
    expect(url.pathname).toBe("/admin/reservations/37"); expect(url.searchParams.get("tab")).toBe("financial");
    expect(url.searchParams.get("returnTo")).toBe("/admin/reservations?propertyId=3&page=4");
    const disclosure = screen.getByText("اطلاعات بیشتر", { selector: "summary" }).closest("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(screen.getByText("اطلاعات بیشتر", { selector: "summary" }));
    expect(disclosure.open).toBe(true);
    expect(screen.getByText("O-12")).toBeTruthy(); expect(screen.getByText(/۵٬۰۰۰٬۰۰۰ ریال/)).toBeTruthy();
    for (const label of ["زمان ثبت رسید", "مهلت اصلی پرداخت", "پایان حفاظت بررسی", "وضعیت رزرو"]) expect(screen.getByText(label)).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledWith("/admin/manual-payments/pending?page=1&pageSize=20&propertyId=3", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.queryByRole("button", { name: "تأیید پرداخت" })).toBeNull();
  });
  it("distinguishes protected, approaching, expired and unprotected financial follow-up receipts", async () => {
    mocks.request.mockResolvedValue(response((["Protected", "ExpiringSoon", "ProtectionExpired", "FinancialFollowUp"] as const)
      .map((reviewState, i) => ({ ...receipt, paymentId: i, reviewState, reviewProtectionExpiresAtUtc: i === 3 ? null : receipt.reviewProtectionExpiresAtUtc }))));
    render(<ManualPaymentReviewQueue />);
    for (const label of ["در انتظار بررسی؛ حفاظت فعال", "نزدیک پایان حفاظت", "حفاظت پایان یافته؛ نیازمند پیگیری مالی", "بدون حفاظت؛ نیازمند پیگیری مالی"])
      expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.getByText("فاقد حفاظت معتبر")).toBeTruthy();
  });
  it("paginates on the server without fetching every page and refreshes after review invalidation", async () => {
    mocks.request.mockImplementation(async (path: string) => response([receipt], path.includes("page=2") ? 2 : 1));
    const view = render(<ManualPaymentReviewQueue refreshKey={0} />);
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(mocks.request).toHaveBeenLastCalledWith("/admin/manual-payments/pending?page=2&pageSize=20", expect.anything()));
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    view.rerender(<ManualPaymentReviewQueue refreshKey={1} />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    expect((screen.getByRole("button", { name: "بعدی" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("keeps loading, failed endpoint and empty history distinct and supports retry", async () => {
    mocks.request.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response([], 1, 0));
    render(<ManualPaymentReviewQueue />);
    expect(screen.getByRole("status").textContent).toContain("در حال دریافت");
    await screen.findByText("دریافت پرداخت‌های در انتظار بررسی انجام نشد.");
    expect(screen.queryByText("رسیدی در انتظار بررسی نیست.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByText("رسیدی در انتظار بررسی نیست.")).toBeTruthy();
  });
  it("returns to a valid server page when review removes the last item on the current page", async () => {
    let total = 21;
    mocks.request.mockImplementation(async (path: string) => response(path.includes("page=2") && total === 20 ? [] : [receipt], path.includes("page=2") ? 2 : 1, total));
    const view = render(<ManualPaymentReviewQueue refreshKey={0} />);
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    total = 20;
    view.rerender(<ManualPaymentReviewQueue refreshKey={1} />);
    await waitFor(() => expect(mocks.request).toHaveBeenLastCalledWith("/admin/manual-payments/pending?page=1&pageSize=20", expect.anything()));
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    expect(screen.queryByText("رسیدی در انتظار بررسی نیست.")).toBeNull();
  });
  it("refreshes on returning focus after review in a separate tab", async () => {
    render(<ManualPaymentReviewQueue />);
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    fireEvent.focus(window);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  });
  it("uses the same scoped endpoint total for the compact dashboard count", async () => {
    render(<ManualPaymentReviewQueue summaryOnly />);
    await screen.findByText("پرداخت‌های در انتظار بررسی · ۲۱");
    expect(mocks.request).toHaveBeenCalledWith("/admin/manual-payments/pending?page=1&pageSize=1", expect.anything());
    expect(screen.getByRole("link", { name: "بررسی پرداخت‌ها" }).getAttribute("href")).toBe("/admin/reservations?tab=payments");
    expect(screen.queryByText("R-37")).toBeNull();
  });
});
