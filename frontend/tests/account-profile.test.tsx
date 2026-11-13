import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), push: vi.fn(), replace: vi.fn(), success: vi.fn(), error: vi.fn(), pathname: "/account/profile",
  session: { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 9, fullName: "مینا احمدی", firstName: "مینا", lastName: "احمدی", email: "mina@example.test" }, refreshSession: vi.fn(), clearSession: vi.fn() },
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session, resolveSessionDestination: () => "/owner" }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.api, getToken: () => "isolated-profile-fixture" }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/components/Header", async () => {
  const { KoochUserMenu } = await import("@/components/KoochUserMenu");
  return { Header: () => <header aria-label="هدر عمومی"><KoochUserMenu /></header> };
});
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/reviews/GuestReviewInvitation", () => ({ GuestReviewInvitation: () => null }));
import ProfilePage, { metadata } from "@/app/account/profile/page";
import { PublicSiteShell } from "@/components/PublicSiteShell";
import { KoochUserProfileDialog } from "@/components/KoochUserProfileDialog";

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.pathname = "/account/profile";
  mocks.session = { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 9, fullName: "مینا احمدی", firstName: "مینا", lastName: "احمدی", email: "mina@example.test" }, refreshSession: vi.fn(), clearSession: vi.fn() };
  mocks.api.mockResolvedValue({ firstName: "نام تازه", lastName: "احمدی" });
  mocks.session.refreshSession.mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false }));
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn().mockReturnValue("blob:profile"), revokeObjectURL: vi.fn() }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const nameInput = () => screen.getByRole("textbox", { name: /^نام\*?$/ });

it("initializes names exclusively from the session, never fullName or legacy browser drafts", () => {
  localStorage.setItem("kooch_user_profile", JSON.stringify({ name: "پیش‌نویس قدیمی" }));
  mocks.session.user.fullName = "نام کامل متفاوت";
  render(<ProfilePage />);
  expect(nameInput()).toHaveProperty("value", "مینا");
  expect(screen.getByRole("textbox", { name: /^نام خانوادگی\*?$/ })).toHaveProperty("value", "احمدی");
  expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
  expect(metadata?.robots).toEqual({ index: false, follow: false });
  expect(mocks.api).not.toHaveBeenCalled();
});

it("sends only the two names on explicit save and refreshes session after success", async () => {
  render(<ProfilePage />);
  fireEvent.change(nameInput(), { target: { value: "  نام تازه  " } });
  expect(mocks.api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
  await waitFor(() => expect(mocks.session.refreshSession).toHaveBeenCalledTimes(1));
  expect(mocks.api).toHaveBeenCalledExactlyOnceWith("/auth/me/profile", { method: "PATCH", body: JSON.stringify({ firstName: "نام تازه", lastName: "احمدی" }) });
  expect(nameInput()).toHaveProperty("value", "نام تازه");
  expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
  expect(localStorage.getItem("kooch_user_profile")).toBeNull();
  fireEvent.change(nameInput(), { target: { value: "ویرایش دوم" } });
  fireEvent.click(screen.getByRole("button", { name: "انصراف" }));
  expect(nameInput()).toHaveProperty("value", "نام تازه");
});

it("reverting or cancelling restores the names baseline without requests", () => {
  render(<ProfilePage />);
  fireEvent.change(nameInput(), { target: { value: "دیگر" } });
  expect(screen.getByRole("button", { name: "ذخیره تغییرات" })).toBeTruthy();
  fireEvent.change(nameInput(), { target: { value: "مینا" } });
  expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: /^نام خانوادگی\*?$/ }), { target: { value: "دیگر" } });
  fireEvent.click(screen.getByRole("button", { name: "انصراف" }));
  expect(screen.getByRole("textbox", { name: /^نام خانوادگی\*?$/ })).toHaveProperty("value", "احمدی");
  expect(mocks.api).not.toHaveBeenCalled();
});

it("keeps failed PATCH edits and actions with an error; cancel restores server names", async () => {
  mocks.api.mockRejectedValue(new Error("ذخیره انجام نشد"));
  render(<ProfilePage />);
  fireEvent.change(nameInput(), { target: { value: "نام تازه" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "ذخیره انجام نشد");
  expect(nameInput()).toHaveProperty("value", "نام تازه");
  expect(screen.getByRole("button", { name: "ذخیره تغییرات" })).toBeTruthy();
  expect(mocks.session.refreshSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "انصراف" }));
  expect(nameInput()).toHaveProperty("value", "مینا");
});

it.each(["", " ", "x".repeat(101)])("validates required names and the API length limit (%s)", value => {
  render(<ProfilePage />);
  fireEvent.change(nameInput(), { target: { value } });
  fireEvent.submit(screen.getByRole("form", { name: "نام حساب کاربری" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(mocks.api).not.toHaveBeenCalled();
});

it("does not misreport a successful PATCH when session refresh fails", async () => {
  mocks.session.refreshSession.mockRejectedValue(new Error("refresh failure"));
  render(<ProfilePage />);
  fireEvent.change(nameInput(), { target: { value: "نام تازه" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("نام ذخیره شد؛ تازه‌سازی اطلاعات حساب انجام نشد."));
  expect(mocks.success).toHaveBeenCalledWith("نام و نام خانوادگی ذخیره شد.");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
});

it("updates the header after refresh without remounting the editor or losing browser-setting edits", async () => {
  let finishRefresh!: () => void;
  mocks.session.refreshSession.mockImplementationOnce(() => new Promise(resolve => {
    mocks.session.loading = true;
    finishRefresh = () => {
      mocks.session.loading = false;
      mocks.session.user.firstName = "نام تازه";
      mocks.session.user.fullName = "نام تازه احمدی";
      resolve({});
    };
  }));
  const view = render(<PublicSiteShell><ProfilePage /></PublicSiteShell>);
  fireEvent.change(screen.getByRole("textbox", { name: "شماره موبایل" }), { target: { value: "09120000000" } });
  fireEvent.change(nameInput(), { target: { value: "نام تازه" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
  await waitFor(() => expect(mocks.session.refreshSession).toHaveBeenCalledTimes(1));
  view.rerender(<PublicSiteShell><ProfilePage /></PublicSiteShell>);
  expect(nameInput()).toHaveProperty("value", "نام تازه");
  finishRefresh();
  await waitFor(() => expect(nameInput()).toHaveProperty("disabled", false));
  view.rerender(<PublicSiteShell><ProfilePage /></PublicSiteShell>);
  expect(screen.getByRole("button", { name: "منوی کاربر نام تازه احمدی" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "شماره موبایل" })).toHaveProperty("value", "09120000000");
  expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
  expect(screen.getByRole("button", { name: "ذخیره تنظیمات مرورگر" })).toBeTruthy();
});

it("saves browser-only preferences separately without PATCH or importing names", async () => {
  render(<ProfilePage />);
  fireEvent.change(screen.getByRole("textbox", { name: "شماره موبایل" }), { target: { value: "09120000000" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "پیامک" }));
  expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات مرورگر" }));
  await waitFor(() => expect(mocks.success).toHaveBeenCalled());
  expect(JSON.parse(localStorage.getItem("kooch_user_profile")!)).toMatchObject({ mobile: "09120000000", smsNotifications: false });
  expect(mocks.api).not.toHaveBeenCalled();
});

it("shares the actual avatar provider between public header and profile page for immediate upload/removal updates", async () => {
  vi.mocked(fetch).mockResolvedValue({ status: 200, ok: true, blob: async () => new Blob(["fixture"], { type: "image/png" }) } as Response);
  vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:old").mockReturnValueOnce("blob:new");
  render(<PublicSiteShell><ProfilePage /></PublicSiteShell>);
  const trigger = screen.getByRole("button", { name: "منوی کاربر مینا احمدی" });
  expect((await within(trigger).findByRole("img")).getAttribute("src")).toBe("blob:old");
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("انتخاب تصویر پروفایل"), { target: { files: [new File(["fixture"], "avatar.png", { type: "image/png" })] } });
  await waitFor(() => expect(within(trigger).getByRole("img").getAttribute("src")).toBe("blob:new"));
  expect(mocks.api).toHaveBeenCalledWith("/account/profile/avatar", expect.objectContaining({ method: "PUT", body: expect.any(FormData) }));
  const form = screen.getByRole("button", { name: "حذف تصویر" }).closest("form")!;
  expect(within(form).getByRole("img").getAttribute("src")).toBe("blob:new");
  fireEvent.click(trigger);
  expect(within(screen.getByRole("menu")).getByRole("img", { name: "تصویر پروفایل" }).getAttribute("src")).toBe("blob:new");
  const profile = screen.getByRole("menuitem", { name: "پروفایل من" });
  expect(profile.getAttribute("href")).toBe("/account/profile"); expect(profile.getAttribute("aria-current")).toBe("page");
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "حذف تصویر" }));
  await waitFor(() => expect(within(trigger).queryByRole("img")).toBeNull());
  fireEvent.click(trigger);
  expect(screen.getByRole("menu").querySelector('img[src="/svgs/account/account.svg"]')).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(mocks.api).toHaveBeenCalledWith("/account/profile/avatar", { method: "DELETE" });
  expect(localStorage.getItem("kooch_user_profile")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old");
  expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
  expect(screen.queryByRole("button", { name: "انصراف" })).toBeNull();
});

it("keeps both dialog actions available when pristine and cancel still closes it", async () => {
  const close = vi.fn();
  render(<KoochUserProfileDialog open onOpenChange={close} />);
  const cancel = await screen.findByRole("button", { name: "انصراف" });
  expect(screen.getByRole("button", { name: "ذخیره تغییرات" })).toBeTruthy();
  fireEvent.click(cancel);
  expect(close).toHaveBeenCalledWith(false);
  expect(localStorage.getItem("kooch_user_profile")).toBeNull();
});

it("keeps avatar errors visible and the previous image intact after a failed removal", async () => {
  vi.mocked(fetch).mockResolvedValue({ status: 200, ok: true, blob: async () => new Blob(["fixture"]) } as Response);
  mocks.api.mockRejectedValue(new Error("حذف انجام نشد"));
  render(<ProfilePage />);
  fireEvent.click(await screen.findByRole("button", { name: "حذف تصویر" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("حذف انجام نشد"));
  expect(screen.getByRole("img", { name: "تصویر پروفایل" }).getAttribute("src")).toBe("blob:profile");
});

it.each(["loading", "anonymous", "wrong-workspace"])("guards profile editing and avatar access for %s sessions", state => {
  mocks.session.loading = state === "loading";
  mocks.session.authenticated = state !== "anonymous" && state !== "loading";
  if (state === "wrong-workspace") mocks.session.workspaces = ["owner"];
  render(<ProfilePage />);
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(fetch).not.toHaveBeenCalled(); expect(mocks.api).not.toHaveBeenCalled();
  if (state !== "loading") expect(mocks.replace).toHaveBeenCalledWith(state === "anonymous" ? "/login?returnTo=%2Faccount%2Fprofile" : "/owner");
});

it("keeps Property Direct outside the shared public avatar scope", () => {
  mocks.pathname = "/book/fixture-property";
  render(<PublicSiteShell><p>Property content</p></PublicSiteShell>);
  expect(screen.queryByRole("banner")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps profile layout scoped and responsive and reuses reduced-motion skeletons", () => {
  const css = readFileSync(resolve("components/account/GuestProfilePage.module.css"), "utf8");
  expect(css).toContain("min-width: 0"); expect(css).toContain(":focus-visible");
  expect(css).toContain("var(--primary) 7%, var(--card)");
  expect(css).not.toMatch(/#[\da-f]{3,8}\b|100vw|:global|animation:/i);
});
