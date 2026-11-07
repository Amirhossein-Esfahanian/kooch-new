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

async function openLogin() {
  fireEvent.click(screen.getByRole("button", { name: "منوی اقامتگاه" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "ورود / ثبت‌نام" }));
  return screen.findByRole("dialog");
}

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
    const dialog = await openLogin();
    expect(dialog.className).not.toContain("h-[min(760px,90vh)]");
    expect(dialog.className).toContain("h-auto");
    expect(within(dialog).getByRole("button", { name: "ارسال کد تأیید" }).getAttribute("data-booking-primary")).toBe("true");
    fireEvent.change(within(dialog).getByLabelText(/شماره موبایل/), { target: { value: "09120000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ارسال کد تأیید" }));
    fireEvent.change(await within(dialog).findByLabelText(/کد تأیید/), { target: { value: "123456" } });
    expect(within(dialog).getByRole("button", { name: "تأیید و ادامه" }).getAttribute("data-booking-primary")).toBe("true");
    expect(within(dialog).getByRole("button", { name: "تغییر شماره موبایل" }).hasAttribute("data-booking-primary")).toBe(false);
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
    await openLogin();
    fireEvent.change(screen.getByLabelText(/شماره موبایل/), { target: { value: "09120000000" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));
    expect((await screen.findByRole("button", { name: "ساخت حساب و ارسال کد" })).getAttribute("data-booking-primary")).toBe("true");
    expect(screen.getByLabelText(/^نام خانوادگی/)).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("prompts shared authentication from My Bookings without requesting booking context", async () => {
    render(<PropertyGuestAccount slug="garden" propertyName="خانه باغ" />);
    expect(screen.queryByRole("button", { name: "ورود / ثبت‌نام" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "منوی اقامتگاه" }));
    expect(screen.queryByRole("menuitem", { name: "خروج از حساب" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "رزروهای من" }));
    const dialog = await screen.findByRole("dialog", { name: /خانه باغ.*ورود \/ ثبت‌نام/ });
    expect(within(dialog).getAllByRole("heading")).toHaveLength(1);
    expect(within(dialog).queryByText("ورود به حساب")).toBeNull();
    expect(within(dialog).getByText("برای مشاهده و پیگیری رزروها، شماره موبایل خود را تأیید کنید.")).toBeTruthy();
    expect(within(dialog).getByLabelText(/شماره موبایل/)).toBeTruthy();
    expect(within(dialog).queryByText(/خلاصه رزرو/)).toBeNull();
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps Property links reachable in the compact menu with keyboard navigation", () => {
    render(<PropertyGuestAccount slug="garden" navigation={[{ href: "#booking", label: "رزرو اقامت" }, { href: "#property-introduction", label: "درباره اقامتگاه" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "منوی اقامتگاه" }));
    const booking = screen.getByRole("menuitem", { name: "رزرو اقامت" });
    expect(booking.getAttribute("href")).toBe("#booking");
    expect(document.activeElement).toBe(booking);
    fireEvent.keyDown(booking, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "درباره اقامتگاه" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "رزروهای من" }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    fireEvent.click(booking);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("preserves shared Escape closing and focus restoration without changing authentication", async () => {
    render(<PropertyGuestAccount slug="garden" />);
    const trigger = screen.getByRole("button", { name: "منوی اقامتگاه" });
    trigger.focus(); await openLogin();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("existing-session menu has only Property bookings and real shared logout", async () => {
    mocks.auth.authenticated = true; setToken("isolated-fixture-token");
    const view = render(<PropertyGuestAccount slug="garden" />);
    fireEvent.click(screen.getByRole("button", { name: "منوی اقامتگاه" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "رزروهای من" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "منوی اقامتگاه" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "رزروهای من" }));
    expect(mocks.push).toHaveBeenCalledWith("/book/garden/my-bookings");
    expect(mocks.api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "منوی اقامتگاه" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "خروج از حساب" }));
    expect(mocks.clear).toHaveBeenCalledOnce(); expect(getToken()).toBeNull();
    expect(mocks.push).toHaveBeenLastCalledWith("/book/garden");
    view.rerender(<PropertyGuestAccount slug="garden" />);
    expect(screen.getByRole("button", { name: "منوی اقامتگاه" })).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.body.textContent).not.toMatch(/کیف پول|پنل مدیریت|پنل اقامتگاه‌ها/);
  });
});
