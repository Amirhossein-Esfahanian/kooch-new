import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: api }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  resolveSessionDestination: () => "/",
  useAuthSession: () => ({ authenticated: true, loading: false, workspaces: ["account"] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import Page from "@/app/account/wallet/page";
import AccountPage from "@/app/account/page";

const balance = { currency: "IRR", balance: 7000000, withdrawableBalance: 5000000, nonWithdrawableBalance: 2000000 };
const request = { id: 27, currency: "IRR", amount: 1000000, status: "Pending", requestedAtUtc: "2026-10-03T10:00:00Z" };
const paged = (items: unknown[]) => ({ items, totalCount: items.length, page: 1, pageSize: 10, totalPages: 1 });
let currentBalance = { ...balance };
let history = [request];
const postCalls = () => api.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => {
  api.mockReset();
  navigation.replace.mockReset();
  currentBalance = { ...balance };
  history = [request];
  api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") return request;
    if (path === "/account/wallet?currency=IRR") return currentBalance;
    if (path.startsWith("/account/wallet/withdrawals?")) return paged(history);
    throw new Error(`Unexpected API: ${path}`);
  });
});

async function openDialog() {
  render(<Page />);
  fireEvent.click(await screen.findByRole("button", { name: "درخواست برداشت" }));
  return await screen.findByRole("dialog", { name: "درخواست برداشت" });
}

describe("Guest account wallet", () => {
  it("links wallet from the existing account landing page", () => {
    render(<AccountPage />);
    expect(screen.getByRole("link", { name: "مشاهده کیف پول" }).getAttribute("href")).toBe("/account/wallet");
  });

  it("shows three authoritative available balances separately and one currency", async () => {
    render(<Page />);
    expect(await screen.findByText("موجودی قابل استفاده")).not.toBeNull();
    expect(screen.getByText("قابل برداشت")).not.toBeNull();
    expect(screen.getByText("اعتبار غیرقابل برداشت")).not.toBeNull();
    expect(screen.getByText(/۷٬۰۰۰٬۰۰۰/)).not.toBeNull();
    expect(screen.getByText(/۵٬۰۰۰٬۰۰۰/)).not.toBeNull();
    expect(within(screen.getByText("اعتبار غیرقابل برداشت").parentElement as HTMLElement).getByText(/۲٬۰۰۰٬۰۰۰/)).not.toBeNull();
    expect(api).toHaveBeenCalledWith("/account/wallet?currency=IRR");
    expect(within(screen.getByRole("region", { name: "خلاصه کیف پول" })).getAllByText("IRR")).toHaveLength(3);
    expect(screen.queryByText(/تومان/)).toBeNull();
  });

  it("hides withdrawal action when only nonwithdrawable funds are available", async () => {
    currentBalance = { currency: "IRR", balance: 2000000, withdrawableBalance: 0, nonWithdrawableBalance: 2000000 };
    render(<Page />);
    await screen.findByText("اعتبار غیرقابل برداشت");
    expect(screen.queryByRole("button", { name: "درخواست برداشت" })).toBeNull();
  });

  it("validates required, positive, and available amount before POST", async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByText(/موجودی قابل برداشت:/)).not.toBeNull();
    const amount = within(dialog).getByRole("spinbutton", { name: /مبلغ درخواستی/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    expect(await within(dialog).findByText("مبلغ درخواست را وارد کنید.")).not.toBeNull();
    fireEvent.change(amount, { target: { value: "-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    expect(await within(dialog).findByText("مبلغ باید بیشتر از صفر باشد.")).not.toBeNull();
    fireEvent.change(amount, { target: { value: "5000001" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    expect(await within(dialog).findByText("مبلغ از موجودی قابل برداشت بیشتر است.")).not.toBeNull();
    expect(postCalls()).toHaveLength(0);
  });

  it("submits only currency and amount, then refetches authoritative balance/history and shows guidance", async () => {
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        currentBalance = { ...balance, balance: 4000000, withdrawableBalance: 2000000 };
        return request;
      }
      return path === "/account/wallet?currency=IRR" ? currentBalance : paged(history);
    });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: /مبلغ درخواستی/ }), { target: { value: "3000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0][0]).toBe("/account/wallet/withdrawals");
    expect(JSON.parse(postCalls()[0][1].body)).toEqual({ currency: "IRR", amount: 3000000 });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "درخواست برداشت" })).toBeNull());
    expect(await screen.findByText(/برای تکمیل فرایند و هماهنگی اطلاعات پرداخت/)).not.toBeNull();
    await waitFor(() => expect(api.mock.calls.filter(([path]) => path === "/account/wallet?currency=IRR")).toHaveLength(2));
    await waitFor(() => expect(api.mock.calls.filter(([path]) => path.startsWith("/account/wallet/withdrawals?"))).toHaveLength(2));
    expect(screen.getByText(/۴٬۰۰۰٬۰۰۰/)).not.toBeNull();
    expect(within(screen.getByText("قابل برداشت").parentElement as HTMLElement).getByText(/۲٬۰۰۰٬۰۰۰/)).not.toBeNull();
  });

  it("prevents duplicate submission while POST is in flight", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") { await pending; return request; }
      return path === "/account/wallet?currency=IRR" ? currentBalance : paged(history);
    });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: /مبلغ درخواستی/ }), { target: { value: "1000000" } });
    const submit = within(dialog).getByRole("button", { name: "ثبت درخواست" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    release?.();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "درخواست برداشت" })).toBeNull());
  });

  it("renders all exact backend statuses without exposing internal IDs", async () => {
    history = (["Pending", "Approved", "Paid", "Rejected", "Cancelled"] as const).map((status, index) =>
      ({ ...request, id: index + 1, status }));
    render(<Page />);
    expect(await screen.findByText("در انتظار بررسی")).not.toBeNull();
    expect(screen.getByText("تأییدشده؛ در انتظار پرداخت")).not.toBeNull();
    expect(screen.getByText("پرداخت‌شده")).not.toBeNull();
    expect(screen.getByText("ردشده")).not.toBeNull();
    expect(screen.getByText("لغوشده")).not.toBeNull();
    expect(screen.queryByText(/WalletAccountId|WalletLotId|WalletEntryId|UserId/)).toBeNull();
    expect(screen.queryByRole("button", { name: /لغو درخواست/ })).toBeNull();
  });

  it("shows a safe empty history state", async () => {
    history = [];
    render(<Page />);
    expect(await screen.findByText("هنوز درخواست برداشتی ثبت نکرده‌اید.")).not.toBeNull();
  });

  it("does not mislabel an unavailable history as empty", async () => {
    api.mockImplementation(async (path: string) => {
      if (path === "/account/wallet?currency=IRR") return currentBalance;
      throw new Error("دریافت تاریخچه ناموفق بود");
    });
    render(<Page />);
    expect(await screen.findByText("تاریخچه در دسترس نیست.")).not.toBeNull();
    expect(screen.queryByText("هنوز درخواست برداشتی ثبت نکرده‌اید.")).toBeNull();
  });

  it("hides stale balance and withdrawal action if an authoritative refetch fails", async () => {
    let reads = 0;
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return request;
      if (path === "/account/wallet?currency=IRR") {
        reads += 1;
        if (reads > 1) throw new Error("دریافت موجودی ناموفق بود");
        return currentBalance;
      }
      return paged(history);
    });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: /مبلغ درخواستی/ }), { target: { value: "1000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    expect(await screen.findByText(/دریافت موجودی ناموفق بود/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "درخواست برداشت" })).toBeNull();
    expect(screen.queryByText(/۵٬۰۰۰٬۰۰۰/)).toBeNull();
  });

  it("preserves the form and refetches balance when the backend rejects stale availability", async () => {
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("موجودی کافی نیست");
      return path === "/account/wallet?currency=IRR" ? currentBalance : paged(history);
    });
    const dialog = await openDialog();
    const amount = within(dialog).getByRole<HTMLInputElement>("spinbutton", { name: /مبلغ درخواستی/ });
    fireEvent.change(amount, { target: { value: "1000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    expect(await within(dialog).findByRole("alert")).not.toBeNull();
    expect(amount.value).toBe("1000000");
    expect(within(dialog).getByText("موجودی کافی نیست")).not.toBeNull();
    await waitFor(() => expect(api.mock.calls.filter(([path]) => path === "/account/wallet?currency=IRR")).toHaveLength(2));
  });
});
