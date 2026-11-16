import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ManualOrderSettlement } from "@/components/reservations/ManualOrderSettlement";

const mocks = vi.hoisted(() => ({ api: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.api }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, warning: mocks.warning } }));
const balance = { sessionCode: "O-123456", totalAmount: 600, remainingAmount: 400,
  currency: "IRR", canSettle: true, unavailableReason: null };

beforeEach(() => { vi.clearAllMocks(); });
const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "ثبت تسویهٔ کل سفارش" }));
  await screen.findByText("O-123456");
  return screen.findByRole("button", { name: "تأیید دریافت کل مانده و ثبت تسویه" });
};

it("loads authoritative balance, settles only on explicit confirmation, and prevents double clicks", async () => {
  let finish!: () => void;
  mocks.api.mockImplementation((path: string, options?: RequestInit) => options?.method === "POST"
    ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve(balance));
  const onSettled = vi.fn();
  render(<ManualOrderSettlement bookingSessionId={15} onSettled={onSettled} />);
  const confirm = await open();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/کل مانده:/).textContent).toContain("۴۰۰");
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.queryByText("نقدی")).toBeNull();
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  const calls = mocks.api.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("/admin/manual-payments/orders/15/settle");
  expect(JSON.parse(calls[0][1].body)).toMatchObject({ confirmedAmount: 400, currency: "IRR", method: "BankTransfer" });
  expect(Object.keys(JSON.parse(calls[0][1].body))).not.toContain("reservationIds");
  finish();
  await waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
  expect(mocks.success).toHaveBeenCalledOnce();
});

it("preserves a failed request for idempotent retry and permits an explicit balance refresh", async () => {
  mocks.api.mockImplementation(async (_path: string, options?: RequestInit) => {
    if (options?.method === "POST") throw new Error("ماندهٔ سفارش تغییر کرده است");
    return balance;
  });
  render(<ManualOrderSettlement bookingSessionId={15} onSettled={vi.fn()} />);
  const confirm = await open();
  fireEvent.change(screen.getByLabelText("شماره پیگیری (اختیاری)"), { target: { value: "REF-1" } });
  fireEvent.click(confirm);
  await screen.findByText("ماندهٔ سفارش تغییر کرده است");
  fireEvent.click(confirm);
  await waitFor(() => expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(2));
  const calls = mocks.api.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(calls[0][1].body).toBe(calls[1][1].body);
  expect(screen.getByLabelText("شماره پیگیری (اختیاری)").getAttribute("value")).toBe("REF-1");
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "دریافت دوبارهٔ مانده" }));
  await waitFor(() => expect(mocks.api.mock.calls.filter(([, options]) => !options)).toHaveLength(2));
});

it("does not offer settlement for a blocked order and does not turn a read error into zero balance", async () => {
  mocks.api.mockResolvedValueOnce({ ...balance, canSettle: false, unavailableReason: "یک اتاق در انتظار تأیید است" });
  render(<ManualOrderSettlement bookingSessionId={15} onSettled={vi.fn()} />);
  const confirm = await open();
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("یک اتاق در انتظار تأیید است")).toBeTruthy();
  mocks.api.mockRejectedValueOnce(new Error("خطای دریافت مانده"));
  fireEvent.click(screen.getByRole("button", { name: "دریافت دوبارهٔ مانده" }));
  await screen.findByText("خطای دریافت مانده");
  expect(screen.queryByText(/کل مانده:/)).toBeNull();
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
});

it("does not report a committed settlement as failed when list refresh fails", async () => {
  mocks.api.mockImplementation(async (_path: string, options?: RequestInit) => options?.method === "POST" ? {} : balance);
  render(<ManualOrderSettlement bookingSessionId={15} onSettled={() => Promise.reject(new Error("refresh"))} />);
  fireEvent.click(await open());
  await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  expect(mocks.warning).toHaveBeenCalledOnce();
  expect(screen.queryByText("refresh")).toBeNull();
});

it("enables confirmation only after a refreshed server balance becomes eligible, without auto-approval or payment", async () => {
  const reason = "رزرو R-123456 در انتظار تأیید است؛ ابتدا رزرو را تأیید کنید، سپس ماندهٔ سفارش را دوباره دریافت کنید.";
  mocks.api.mockResolvedValueOnce({ ...balance, canSettle: false, unavailableReason: reason });
  render(<ManualOrderSettlement bookingSessionId={15} onSettled={vi.fn()} />);
  const confirm = await open();
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(reason)).toBeTruthy();
  fireEvent.click(confirm);
  expect(mocks.api).toHaveBeenCalledTimes(1);
  mocks.api.mockResolvedValueOnce(balance);
  fireEvent.click(screen.getByRole("button", { name: "دریافت دوبارهٔ مانده" }));
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText(reason)).toBeNull();
  expect(mocks.api.mock.calls.map(([path]) => path)).toEqual([
    "/admin/manual-payments/orders/15", "/admin/manual-payments/orders/15"
  ]);
});

it.each([
  "رزرو R-123456 در وضعیت «در انتظار» است و قابل پرداخت نیست؛ وضعیت و مسیر مجاز آن را در جزئیات رزرو بررسی کنید.",
  "برای رزرو R-123456 مهلت پرداخت ثبت نشده است؛ وضعیت و مهلت را در جزئیات رزرو بررسی کنید.",
  "مهلت پرداخت رزرو R-123456 پایان یافته است؛ وضعیت رزرو را در جزئیات بررسی کنید.",
  "رزرو R-123456 دارای پرداخت جزئی قبلی است و پیش از تسویه نیاز به بررسی مالی دارد.",
])("renders the server's specific block reason unchanged: %s", async reason => {
  mocks.api.mockResolvedValue({ ...balance, canSettle: false, unavailableReason: reason });
  render(<ManualOrderSettlement bookingSessionId={15} onSettled={vi.fn()} />);
  expect(((await open()) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(reason)).toBeTruthy();
  expect(mocks.api).toHaveBeenCalledTimes(1);
});
