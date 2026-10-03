import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", () => ({ apiRequest: api }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: { children: ReactNode; requiredPlatformPermission: string }) =>
    <div data-permission={requiredPlatformPermission}>{children}</div>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import Page from "@/app/admin/wallet/withdrawals/page";

type WithdrawalFixture = { id: number; guestName: string; currency: string; amount: number; status: string;
  requestedAtUtc: string; processedAtUtc: string | null; paidAtUtc: string | null;
  payoutMethod: string | null; payoutReferenceNumber: string | null; payoutNote: string | null };
const pending: WithdrawalFixture = { id: 41, guestName: "مهمان نمونه", currency: "IRR", amount: 1250000,
  status: "Pending", requestedAtUtc: "2026-10-03T08:00:00Z", processedAtUtc: null,
  paidAtUtc: null, payoutMethod: null, payoutReferenceNumber: null, payoutNote: null };
const paged = (items: unknown[], page = 1, totalPages = 1) => ({ items, page, pageSize: 20, totalCount: 21, totalPages });
let current = { ...pending };
const mutationCalls = () => api.mock.calls.filter(([, init]) => init?.method === "PUT");

beforeEach(() => {
  current = { ...pending };
  api.mockReset();
  api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const action = path.split("/").at(-1);
      current = { ...current, status: action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Paid" };
      if (action === "paid") current = { ...current, paidAtUtc: "2026-10-03T10:00:00Z", payoutMethod: "BankTransfer",
        payoutReferenceNumber: "BANK-42", payoutNote: "ثبت شد" };
      return current;
    }
    if (path === "/admin/wallet/withdrawals/41") return current;
    if (path.startsWith("/admin/wallet/withdrawals?")) return paged([current], Number(new URLSearchParams(path.split("?")[1]).get("page")), 2);
    throw new Error(`Unexpected API: ${path}`);
  });
});

async function openDetails() {
  render(<Page />);
  fireEvent.click(await screen.findByRole("button", { name: "جزئیات" }));
  return await screen.findByRole("dialog", { name: "جزئیات درخواست برداشت" });
}

describe("Admin wallet withdrawals", () => {
  it("loads list, uses ManagePayments, and does not expose internal wallet IDs", async () => {
    render(<Page />);
    expect(await screen.findByText("مهمان نمونه")).not.toBeNull();
    expect(api).toHaveBeenCalledWith("/admin/wallet/withdrawals?page=1&pageSize=20");
    expect(document.querySelector('[data-permission="ManagePayments"]')).not.toBeNull();
    expect(screen.queryByText(/WalletAccountId|WalletLotId|WalletEntryId|UserId/)).toBeNull();
    expect(screen.getByText("IRR")).not.toBeNull();
  });

  it("filters on the server, resets page, and paginates", async () => {
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/wallet/withdrawals?page=2&pageSize=20"));
    fireEvent.change(screen.getByRole("combobox", { name: "وضعیت" }), { target: { value: "Approved" } });
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/wallet/withdrawals?page=1&pageSize=20&status=Approved"));
  });

  it("opens authoritative detail and confirms approval without presenting payout as completed", async () => {
    const dialog = await openDetails();
    expect(api).toHaveBeenCalledWith("/admin/wallet/withdrawals/41");
    expect(within(dialog).getByText("مهمان نمونه")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "رد درخواست" })).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید درخواست" }));
    expect(within(dialog).getByText(/وجه همچنان رزرو می‌ماند/)).not.toBeNull();
    expect(mutationCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید درخواست" }));
    await waitFor(() => expect(mutationCalls()).toHaveLength(1));
    expect(mutationCalls()[0][0]).toBe("/admin/wallet/withdrawals/41/approve");
    expect(mutationCalls()[0][1]).toEqual({ method: "PUT" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "ثبت پرداخت" })).not.toBeNull());
    expect(within(dialog).queryByText("پرداخت‌شده")).toBeNull();
    expect(api.mock.calls.filter(([path]) => path === "/admin/wallet/withdrawals/41")).toHaveLength(2);
    expect(api.mock.calls.filter(([path]) => path.startsWith("/admin/wallet/withdrawals?"))).toHaveLength(2);
  });

  it("rejects with no unsupported note payload and becomes read-only", async () => {
    const dialog = await openDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: "رد درخواست" }));
    expect(within(dialog).getByText(/قوانین انقضای کیف پول/)).not.toBeNull();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "رد درخواست" }));
    await waitFor(() => expect(within(dialog).getByText("ردشده")).not.toBeNull());
    expect(mutationCalls()[0]).toEqual(["/admin/wallet/withdrawals/41/reject", { method: "PUT" }]);
    expect(within(dialog).queryByRole("button", { name: "ثبت پرداخت" })).toBeNull();
  });

  it("shows paid form and final authoritative amount, then sends only backend fields", async () => {
    current = { ...pending, status: "Approved" };
    const dialog = await openDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت پرداخت" }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: /روش پرداخت/ }), { target: { value: "BankTransfer" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /شماره\/مرجع پرداخت/ }), { target: { value: "BANK-42" } });
    fireEvent.change(within(dialog).getByLabelText(/زمان واقعی پرداخت/), { target: { value: "2026-10-03T10:00" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "یادداشت پرداخت" }), { target: { value: "ثبت شد" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "بررسی نهایی" }));
    expect(within(dialog).getByText(/مبلغ پرداختی:/)).not.toBeNull();
    expect(mutationCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت نهایی پرداخت" }));
    await waitFor(() => expect(mutationCalls()).toHaveLength(1));
    expect(mutationCalls()[0][0]).toBe("/admin/wallet/withdrawals/41/paid");
    expect(JSON.parse(mutationCalls()[0][1].body)).toEqual({ payoutMethod: "BankTransfer", referenceNumber: "BANK-42",
      paidAtUtc: new Date("2026-10-03T10:00").toISOString(), note: "ثبت شد" });
    await waitFor(() => expect(within(dialog).getByText("پرداخت‌شده")).not.toBeNull());
    expect(within(dialog).getByText("BANK-42")).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: "ثبت پرداخت" })).toBeNull();
    expect(api.mock.calls.filter(([path]) => path === "/admin/wallet/withdrawals/41")).toHaveLength(2);
    expect(api.mock.calls.filter(([path]) => path.startsWith("/admin/wallet/withdrawals?"))).toHaveLength(2);
  });

  it("keeps backend state on mutation failure", async () => {
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new Error("خطای سرور");
      return path === "/admin/wallet/withdrawals/41" ? current : paged([current]);
    });
    const dialog = await openDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید درخواست" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید درخواست" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("خطای سرور");
    expect(within(dialog).getByText("در انتظار بررسی")).not.toBeNull();
  });

  it("does not expose stale actions if authoritative detail refetch fails after approval", async () => {
    let detailReads = 0;
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "PUT") return { ...current, status: "Approved" };
      if (path === "/admin/wallet/withdrawals/41") {
        detailReads += 1;
        if (detailReads > 1) throw new Error("دریافت جزئیات ناموفق بود");
        return current;
      }
      return paged([current]);
    });
    const dialog = await openDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید درخواست" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید درخواست" }));
    expect(await within(dialog).findByRole("alert")).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: "تأیید درخواست" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "رد درخواست" })).toBeNull();
  });

  it("prevents duplicate submissions while a mutation is pending", async () => {
    let release: (() => void) | undefined;
    const pendingMutation = new Promise<void>(resolve => { release = resolve; });
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "PUT") { await pendingMutation; current = { ...current, status: "Approved" }; return current; }
      return path === "/admin/wallet/withdrawals/41" ? current : paged([current]);
    });
    const dialog = await openDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید درخواست" }));
    const confirm = within(dialog).getByRole("button", { name: "تأیید درخواست" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mutationCalls()).toHaveLength(1);
    release?.();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "ثبت پرداخت" })).not.toBeNull());
  });
});
