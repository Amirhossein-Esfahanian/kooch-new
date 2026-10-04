import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/account/reservations/[reservationNumber]/page";
import { formatDateTime } from "@/lib/account-reservations";

const api = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({ number: "R-100001", replace: vi.fn(), push: vi.fn() }));
const accountSession = vi.hoisted(() => ({ authenticated: true, loading: false, workspaces: ["account"] }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: api, ApiRequestError: class extends Error {} }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ reservationNumber: navigation.number }),
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  resolveSessionDestination: () => "/",
  useAuthSession: () => accountSession,
}));
vi.mock("@/lib/currency", async () => ({
  ...await vi.importActual<typeof import("@/lib/currency")>("@/lib/currency"),
  useSiteCurrencyLabel: () => "تومان",
}));

const reservation = (number = "R-100001") => ({
  reservationId: number === "R-100001" ? 1 : 2,
  reservationNumber: number, propertyName: `اقامتگاه ${number}`, roomTypeName: "اتاق دو نفره",
  checkInDate: "2026-10-03", checkOutDate: "2026-10-05", nightsCount: 2,
  adults: 2, children: 0, roomCount: 1, totalPrice: 1000000, finalAmount: 1000000,
  paidAmount: 1000000, remainingAmount: 0, currency: "IRR", status: "Paid",
  createdAtUtc: "2026-10-01T08:00:00Z",
});
const pending = {
  status: "Pending", amount: 123456, currency: "IRR",
  eligibleAtUtc: "2026-10-05T12:00:00Z", grantedAtUtc: null, expiresAtUtc: null,
};
const granted = {
  ...pending, status: "Granted", grantedAtUtc: "2026-10-06T09:00:00Z",
  expiresAtUtc: "2026-11-05T09:00:00Z",
};
const cashbackPath = (number = navigation.number) =>
  `/account/reservations/${encodeURIComponent(number)}/cashback`;

function mockCashback(value: unknown) {
  api.mockImplementation(async (path: string) => {
    if (path.endsWith("/cancellation-request")) return null;
    if (path.endsWith("/cashback")) return { cashback: value };
    if (path.startsWith("/account/reservations/")) return reservation(decodeURIComponent(path.split("/")[3]));
    throw new Error(`Unexpected request: ${path}`);
  });
}

beforeEach(() => {
  api.mockReset();
  navigation.number = "R-100001";
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

describe("Guest Reservation Cashback presentation", () => {
  it("hides the lifecycle section for a legitimate null response", async () => {
    mockCashback(null);
    render(<Page />);
    await screen.findAllByText("اقامتگاه R-100001");
    await waitFor(() => expect(api).toHaveBeenCalledWith(cashbackPath()));
    await waitFor(() => expect(screen.queryByRole("region", { name: "کش‌بک رزرو" })).toBeNull());
    expect(screen.queryByText(/بدون کش‌بک/)).toBeNull();
  });

  it("shows Pending snapshot amount, exact API currency and eligibility without implying Wallet credit", async () => {
    mockCashback(pending);
    render(<Page />);
    const card = await screen.findByRole("region", { name: "کش‌بک رزرو" });
    await within(card).findByText("در انتظار");
    expect(within(card).getByText(/۱۲۳٬۴۵۶/)).toBeTruthy();
    expect(within(card).getByText("IRR")).toBeTruthy();
    expect(within(card).queryByText("تومان")).toBeNull();
    expect(within(card).getByText(/هنوز به کیف پول شما اضافه نشده است/)).toBeTruthy();
    expect(within(card).getByText(/در صورت لغو نشدن رزرو/)).toBeTruthy();
    expect(within(card).getByText(/اعتبار غیرقابل‌برداشت/)).toBeTruthy();
    const time = within(card).getByText(formatDateTime(pending.eligibleAtUtc));
    expect(time.getAttribute("datetime")).toBe(pending.eligibleAtUtc);
    expect(within(card).queryByRole("link", { name: "مشاهده کیف پول" })).toBeNull();
  });

  it("shows Granted credit, authoritative grant and expiry times, and a Wallet link", async () => {
    mockCashback(granted);
    render(<Page />);
    const card = await screen.findByRole("region", { name: "کش‌بک رزرو" });
    await within(card).findByText("اضافه‌شده به کیف پول");
    expect(within(card).getByText(/۱۲۳٬۴۵۶/)).toBeTruthy();
    expect(within(card).getByText(/اعتبار غیرقابل‌برداشت/)).toBeTruthy();
    expect(within(card).queryByText(/قابل برداشت به‌صورت نقدی/)).toBeNull();
    expect(within(card).getByText(formatDateTime(granted.grantedAtUtc)).getAttribute("datetime"))
      .toBe(granted.grantedAtUtc);
    expect(within(card).getByText(formatDateTime(granted.expiresAtUtc)).getAttribute("datetime"))
      .toBe(granted.expiresAtUtc);
    expect(within(card).getByRole("link", { name: "مشاهده کیف پول" }).getAttribute("href"))
      .toBe("/account/wallet");
  });

  it("keeps Voided historical cashback visible without claiming Wallet reversal", async () => {
    mockCashback({ ...pending, status: "Voided" });
    render(<Page />);
    const card = await screen.findByRole("region", { name: "کش‌بک رزرو" });
    await within(card).findByText("لغوشده / اعطا نشده");
    expect(within(card).getByText(/به دلیل لغو رزرو پیش از اعطا/)).toBeTruthy();
    expect(within(card).queryByText(/برداشت|بازپس‌گیری|بازگردانده/)).toBeNull();
    expect(within(card).queryByRole("link", { name: "مشاهده کیف پول" })).toBeNull();
  });

  it("handles an unknown backend status as a local error, not a fabricated lifecycle state", async () => {
    mockCashback({ ...pending, status: "Expired" });
    render(<Page />);
    const card = await screen.findByRole("region", { name: "کش‌بک رزرو" });
    await within(card).findByRole("alert");
    expect(within(card).getByText("وضعیت کش‌بک این رزرو قابل نمایش نیست.")).toBeTruthy();
    expect(within(card).queryByText("منقضی‌شده")).toBeNull();
    expect(screen.getAllByText("اقامتگاه R-100001").length).toBeGreaterThan(0);
  });

  it("loads Cashback locally without blocking Reservation details", async () => {
    let resolve!: (value: { cashback: typeof pending }) => void;
    const waiting = new Promise<{ cashback: typeof pending }>((done) => { resolve = done; });
    api.mockImplementation(async (path: string) => {
      if (path.endsWith("/cancellation-request")) return null;
      if (path.endsWith("/cashback")) return waiting;
      return reservation();
    });
    render(<Page />);
    expect((await screen.findAllByText("اقامتگاه R-100001")).length).toBeGreaterThan(0);
    expect(screen.getByText("در حال دریافت وضعیت کش‌بک…")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "اقامت" })).toBeTruthy();
    resolve({ cashback: pending });
    await screen.findByText("در انتظار");
  });

  it("keeps Reservation details usable on Cashback failure and retries only the current read endpoint", async () => {
    let attempts = 0;
    api.mockImplementation(async (path: string) => {
      if (path.endsWith("/cancellation-request")) return null;
      if (path.endsWith("/cashback")) {
        attempts++;
        if (attempts === 1) throw new Error("دریافت کش‌بک ناموفق بود");
        return { cashback: pending };
      }
      return reservation();
    });
    render(<Page />);
    const card = await screen.findByRole("region", { name: "کش‌بک رزرو" });
    await within(card).findByRole("alert");
    expect(screen.getAllByText("اقامتگاه R-100001").length).toBeGreaterThan(0);
    fireEvent.click(within(card).getByRole("button", { name: "تلاش دوباره برای کش‌بک" }));
    await within(card).findByText("در انتظار");
    expect(api.mock.calls.filter(([path]) => path === cashbackPath())).toHaveLength(2);
  });

  it("never shows Reservation A Cashback while Reservation B is loading or failed", async () => {
    api.mockImplementation(async (path: string) => {
      if (path.endsWith("/cancellation-request")) return null;
      if (path.endsWith("/cashback")) {
        if (path === cashbackPath("R-100001")) return { cashback: pending };
        throw new Error("وضعیت رزرو دوم در دسترس نیست");
      }
      return reservation(decodeURIComponent(path.split("/")[3]));
    });
    const view = render(<Page />);
    await screen.findByText("در انتظار");
    navigation.number = "R-100002";
    view.rerender(<Page />);
    expect(screen.queryByText("در انتظار")).toBeNull();
    await screen.findAllByText("اقامتگاه R-100002");
    const card = await screen.findByRole("region", { name: "کش‌بک رزرو" });
    await within(card).findByRole("alert");
    expect(within(card).queryByText(/۱۲۳٬۴۵۶/)).toBeNull();
    expect(api).toHaveBeenCalledWith(cashbackPath("R-100002"));
  });

  it("makes no Cashback calculation, settings read or Wallet mutation requests", async () => {
    mockCashback(granted);
    render(<Page />);
    await screen.findByText("اضافه‌شده به کیف پول");
    expect(api.mock.calls.some(([path, init]) =>
      path.includes("cashback/settings") || path.includes("properties/") ||
      path.startsWith("/account/wallet") || init?.method === "POST" || init?.method === "PUT"))
      .toBe(false);
    expect(api).toHaveBeenCalledWith(cashbackPath());
  });
});
