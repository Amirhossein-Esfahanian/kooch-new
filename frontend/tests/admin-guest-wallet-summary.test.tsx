import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuestManagement } from "@/components/guests/GuestManagement";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  role: "SuperAdmin" as string,
  permissions: [] as string[],
  userId: 7 as number | null,
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.api }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ platformRole: mocks.role, platformPermissions: mocks.permissions }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const guest = {
  id: 12, userId: 7, firstName: "مهمان", lastName: "نمونه", fullName: "مهمان نمونه",
  mobile: "09120000000", email: null, nationalCode: null, passportNumber: null,
  nationality: null, birthDate: null, gender: null, address: null, notes: null,
};

beforeEach(() => {
  mocks.api.mockReset();
  mocks.role = "SuperAdmin";
  mocks.permissions = [];
  mocks.userId = 7;
  mocks.push.mockReset();
  mocks.api.mockImplementation(async (path: string) => {
    if (path === "/admin/guests") return [{ ...guest, userId: mocks.userId }];
    if (path === "/admin/wallet/withdrawals/users/7/balances") return [
      { currency: "IRR", balance: 85, withdrawableBalance: 70, nonWithdrawableBalance: 15, heldBalance: 25, reservedBalance: 30 },
      { currency: "USD", balance: 50, withdrawableBalance: 50, nonWithdrawableBalance: 0, heldBalance: 0, reservedBalance: 0 },
    ];
    if (path === "/admin/wallet/withdrawals/users/7/transactions?currency=IRR&page=1&pageSize=5") return { items: [
      { id: 1, amount: 20, direction: "Credit", currency: "IRR", createdAtUtc: "2026-10-01T12:00:00Z" },
      { id: 2, amount: 5, direction: "Debit", currency: "IRR", createdAtUtc: "2026-09-30T12:00:00Z" },
    ] };
    if (path === "/admin/wallet/withdrawals/users/7/transactions?currency=USD&page=1&pageSize=5") return { items: [] };
    throw new Error(`Unexpected API: ${path}`);
  });
});

async function openGuest() {
  render(<GuestManagement />);
  fireEvent.click(await screen.findByRole("button", { name: "ویرایش" }));
  return screen.findByRole("dialog", { name: "ویرایش مهمان" });
}

describe("Admin Guest wallet summary", () => {
  it("links a canonical User to the existing Admin withdrawal flow", async () => {
    const dialog = await openGuest();
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست برداشت" }));
    expect(mocks.push).toHaveBeenCalledWith("/admin/wallet/withdrawals?userId=7");
    expect(mocks.api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("shows recent backend-signed transactions only for the linked User and keeps currencies separate", async () => {
    const dialog = await openGuest();
    expect(await within(dialog).findByText("افزایش موجودی")).not.toBeNull();
    expect(within(dialog).getByText("کاهش موجودی")).not.toBeNull();
    expect(within(dialog).getByText((text) => text.startsWith("+") && text.endsWith("IRR"))).not.toBeNull();
    expect(within(dialog).getByText((text) => text.startsWith("−") && text.endsWith("IRR"))).not.toBeNull();
    expect(within(dialog).getByText("هنوز تراکنشی در این کیف پول ثبت نشده است.")).not.toBeNull();
    expect(mocks.api).toHaveBeenCalledWith("/admin/wallet/withdrawals/users/7/transactions?currency=IRR&page=1&pageSize=5");
    expect(mocks.api).toHaveBeenCalledWith("/admin/wallet/withdrawals/users/7/transactions?currency=USD&page=1&pageSize=5");
    expect(mocks.api).not.toHaveBeenCalledWith(expect.stringContaining("users/12/transactions"));
  });
  it("shows canonical User balances per currency with no frontend aggregation or wallet actions", async () => {
    const dialog = await openGuest();
    expect(await within(dialog).findByText("خلاصه کیف پول")).not.toBeNull();
    await waitFor(() => expect(within(dialog).getAllByText("رزروشده برای برداشت")).toHaveLength(2));
    expect(mocks.api).toHaveBeenCalledWith("/admin/wallet/withdrawals/users/7/balances");
    expect(within(dialog).getAllByText("قابل برداشت")).toHaveLength(2);
    expect(within(dialog).getAllByText("غیرقابل برداشت")).toHaveLength(2);
    expect(within(dialog).getAllByText("در نگه‌داشت")).toHaveLength(2);
    expect(within(dialog).getAllByText("قابل استفاده")).toHaveLength(2);
    expect(within(dialog).getAllByText("IRR").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("USD").length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "ثبت درخواست برداشت" })).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: /اعتبار|واریز/ })).toBeNull();
  });

  it("shows an empty state for an unlinked Guest without querying another user's wallet", async () => {
    mocks.userId = null;
    const dialog = await openGuest();
    expect(within(dialog).getByText(/این مهمان به حساب کاربری متصل نیست/)).not.toBeNull();
    expect(mocks.api).not.toHaveBeenCalledWith(expect.stringContaining("/balances"));
    expect(mocks.api).not.toHaveBeenCalledWith(expect.stringContaining("/transactions"));
    expect(within(dialog).queryByRole("button", { name: "ثبت درخواست برداشت" })).toBeNull();
  });

  it("shows an empty state when a linked User has no wallet account", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/admin/guests") return [guest];
      if (path === "/admin/wallet/withdrawals/users/7/balances") return [];
      throw new Error(`Unexpected API: ${path}`);
    });
    const dialog = await openGuest();
    expect(await within(dialog).findByText("کیف پولی برای این کاربر ثبت نشده است.")).not.toBeNull();
  });

  it("does not expose wallet data without ManagePayments", async () => {
    mocks.role = "AdminAssistant";
    const dialog = await openGuest();
    expect(within(dialog).queryByText("خلاصه کیف پول")).toBeNull();
    expect(mocks.api).not.toHaveBeenCalledWith("/admin/wallet/withdrawals/users/7/balances");
    expect(mocks.api).not.toHaveBeenCalledWith(expect.stringContaining("/transactions"));
    expect(within(dialog).queryByRole("button", { name: "ثبت درخواست برداشت" })).toBeNull();
  });
});
