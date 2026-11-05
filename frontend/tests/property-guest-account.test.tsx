import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearToken, getToken, setToken } from "@/lib/auth-session";
import { bookingCartStorageKey } from "@/components/booking/BookingCartProvider";

const mocks = vi.hoisted(() => ({ push: vi.fn(), api: vi.fn(), clear: vi.fn(), refresh: vi.fn(), auth: {
  authenticated: false, loading: false, user: { userId: 7, fullName: "مهمان", firstName: "مینا", lastName: "امینی", phoneNumber: "09120000000" }, workspaces: ["account", "owner"] as string[],
} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => "/book/garden" }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => ({ ...mocks.auth, clearSession: mocks.clear, refreshSession: mocks.refresh }) }));
vi.mock("@/lib/owner-api", async (original) => ({ ...await original<typeof import("@/lib/owner-api")>(), apiRequest: mocks.api }));

import { PropertyGuestAccount } from "@/components/booking/PropertyGuestAccount";

describe("Property guest account", () => {
  beforeEach(() => {
    vi.clearAllMocks(); clearToken();
    mocks.auth.authenticated = false;
    mocks.auth.loading = false;
    mocks.clear.mockImplementation(() => { clearToken(); mocks.auth.authenticated = false; });
    mocks.refresh.mockImplementation(async () => { mocks.auth.authenticated = true; return { user: mocks.auth.user }; });
    mocks.api.mockImplementation(async (path: string) => path === "/auth/request-otp" ? { sent: true, requiresRegistration: false, expiresAtUtc: new Date(Date.now() + 120000).toISOString() } : { token: "isolated-fixture-token" });
  });

  it("opens standalone shared OTP login without a cart and navigates exactly once after authentication", async () => {
    sessionStorage.setItem(bookingCartStorageKey, "existing-selection-fixture");
    render(<PropertyGuestAccount slug="garden" />);
    fireEvent.click(screen.getByRole("button", { name: "ورود / ثبت‌نام" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/شماره موبایل/), { target: { value: "09120000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ارسال کد تأیید" }));
    fireEvent.change(await within(dialog).findByLabelText(/کد تأیید/), { target: { value: "123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید و ادامه" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/book/garden/my-bookings"));
    expect(mocks.api.mock.calls.map(([path]) => path)).toEqual(["/auth/request-otp", "/auth/verify-otp"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getToken()).toBe("isolated-fixture-token");
    expect(sessionStorage.getItem(bookingCartStorageKey)).toBe("existing-selection-fixture");
  });

  it("reuses inline registration for a new mobile number", async () => {
    mocks.api.mockResolvedValueOnce({ sent: false, requiresRegistration: true, expiresAtUtc: null });
    render(<PropertyGuestAccount slug="garden" />);
    fireEvent.click(screen.getByRole("button", { name: "ورود / ثبت‌نام" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/شماره موبایل/), { target: { value: "09120000000" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));
    expect(await screen.findByRole("button", { name: "ساخت حساب و ارسال کد" })).toBeTruthy();
    expect(screen.getByLabelText(/^نام خانوادگی/)).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("preserves shared Escape closing and focus restoration without changing authentication", async () => {
    render(<PropertyGuestAccount slug="garden" />);
    const trigger = screen.getByRole("button", { name: "ورود / ثبت‌نام" });
    trigger.focus(); fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("existing-session menu has only Property bookings and real shared logout", async () => {
    mocks.auth.authenticated = true; setToken("isolated-fixture-token");
    const view = render(<PropertyGuestAccount slug="garden" />);
    fireEvent.click(screen.getByRole("button", { name: "حساب من" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "رزروهای من" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "حساب من" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "رزروهای من" }));
    expect(mocks.push).toHaveBeenCalledWith("/book/garden/my-bookings");
    expect(mocks.api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "حساب من" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "خروج از حساب" }));
    expect(mocks.clear).toHaveBeenCalledOnce(); expect(getToken()).toBeNull();
    expect(mocks.push).toHaveBeenLastCalledWith("/book/garden");
    view.rerender(<PropertyGuestAccount slug="garden" />);
    expect(screen.getByRole("button", { name: "ورود / ثبت‌نام" })).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.body.textContent).not.toMatch(/کیف پول|پنل مدیریت|پنل اقامتگاه‌ها/);
  });
});
