import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettlementReceiptView } from "@/components/settlements/SettlementReceiptView";
import { ApiRequestError } from "@/lib/owner-api";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(), apiRequest: request,
}));

const receipt = {
  settlementNumber: "S-583214", propertyName: "اقامتگاه نمونه", totalAmount: 246.9, currency: "XYZ",
  paidAtUtc: "2026-09-27T12:00:00Z", paymentMethod: "BankTransfer", referenceNumber: "123-REF",
  itemCount: 2, recordedAtUtc: "2026-09-27T12:01:00Z", note: "یادداشت خصوصی",
  items: [
    { reservationNumber: "R-100001", payableDueDate: "2026-09-27", amount: 123.45 },
    { reservationNumber: "R-100002", payableDueDate: "2026-09-26", amount: 123.45 },
  ],
};

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue(receipt);
});

describe("Settlement receipt", () => {
  it("uses the Admin endpoint and renders persisted payment, batch and item facts", async () => {
    render(<SettlementReceiptView settlementNumber="S-583214" />);
    const article = await screen.findByRole("article", { name: "رسید تسویه" });
    expect(request).toHaveBeenCalledWith("/admin/settlements/S-583214/receipt", { signal: expect.any(AbortSignal) });
    expect(within(article).getAllByText("S-583214").length).toBeGreaterThan(0);
    expect(within(article).getByText("R-100001")).toBeTruthy();
    expect(within(article).getByText("R-100002")).toBeTruthy();
    expect(within(article).getByText("اقامتگاه نمونه")).toBeTruthy();
    expect(within(article).getByText("123-REF")).toBeTruthy();
    expect(within(article).getByText("یادداشت خصوصی")).toBeTruthy();
    expect(within(article).getByText("زمان ثبت در سیستم")).toBeTruthy();
    expect(within(article).getAllByText(/XYZ/).length).toBeGreaterThan(0);
    expect(within(article).queryByText(/تومان/)).toBeNull();
  });

  it("uses the Property endpoint and excludes Admin-only fields", async () => {
    render(<SettlementReceiptView propertyId={8} settlementNumber="S-583214" />);
    const article = await screen.findByRole("article", { name: "رسید تسویه" });
    expect(request).toHaveBeenCalledWith("/owner/properties/8/settlements/S-583214/receipt",
      { signal: expect.any(AbortSignal) });
    expect(within(article).getByText("R-100001")).toBeTruthy();
    expect(within(article).queryByText("یادداشت خصوصی")).toBeNull();
    expect(within(article).queryByText("زمان ثبت در سیستم")).toBeNull();
  });

  it("prints the shared document through the browser and does not issue a mutation", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<SettlementReceiptView settlementNumber="S-583214" />);
    await screen.findByRole("article", { name: "رسید تسویه" });
    fireEvent.click(screen.getByRole("button", { name: "چاپ رسید" }));
    expect(print).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.querySelector("[data-settlement-receipt-print]")).not.toBeNull());
    expect(request).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("explains unavailable legacy receipts instead of fabricating missing history", async () => {
    request.mockRejectedValue(new ApiRequestError("Not found", 404, null, false));
    render(<SettlementReceiptView settlementNumber="S-583214" />);
    expect(await screen.findByText("اطلاعات تاریخی لازم برای صدور رسید این تسویه در سوابق موجود نیست.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "چاپ رسید" })).toBeNull();
  });

  it("keeps forbidden Property receipts out of view", async () => {
    request.mockRejectedValue(new ApiRequestError("Forbidden", 403, null, false));
    render(<SettlementReceiptView propertyId={8} settlementNumber="S-583214" />);
    await waitFor(() => expect(screen.getByText("شما اجازه مشاهده این رسید تسویه را ندارید.")).toBeTruthy());
    expect(screen.queryByRole("article", { name: "رسید تسویه" })).toBeNull();
  });
});
