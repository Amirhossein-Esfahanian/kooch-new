import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), push: vi.fn(), replace: vi.fn(), success: vi.fn(), error: vi.fn(), pathname: "/account/profile",
  session: { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 9, fullName: "مینا احمدی", firstName: "مینا", lastName: "احمدی", email: "mina@example.test" }, clearSession: vi.fn() },
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
  mocks.session = { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 9, fullName: "مینا احمدی", firstName: "مینا", lastName: "احمدی", email: "mina@example.test" }, clearSession: vi.fn() };
  mocks.api.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false }));
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn().mockReturnValue("blob:profile"), revokeObjectURL: vi.fn() }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const nameInput = () => screen.getByRole("textbox", { name: /نام و نام خانوادگی/ });

it("reuses every existing profile section and local save behavior on the private page, without pretending it updates server identity", async () => {
  const view = render(<ProfilePage />);
  expect(screen.getByRole("heading", { name: "پروفایل من" })).toBeTruthy();
  expect(nameInput()).toHaveProperty("value", "مینا احمدی");
  expect(screen.getByRole("textbox", { name: "ایمیل" })).toHaveProperty("type", "email");
  expect(screen.getByRole("heading", { name: "امنیت حساب" })).toBeTruthy();
  expect(screen.getByText(/فقط در همین مرورگر ذخیره می‌شوند/)).toBeTruthy();
  expect(metadata?.robots).toEqual({ index: false, follow: false });
  fireEvent.change(nameInput(), { target: { value: "  نام تازه  " } });
  fireEvent.change(screen.getByRole("textbox", { name: "شماره موبایل" }), { target: { value: "09120000000" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "پیامک" }));
  fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("تنظیمات پروفایل در این مرورگر ذخیره شد."));
  expect(JSON.parse(localStorage.getItem("kooch_user_profile")!)).toMatchObject({ name: "نام تازه", mobile: "09120000000", smsNotifications: false });
  expect(mocks.api).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
  expect(screen.queryByRole("button", { name: "انصراف" })).toBeNull();
  view.unmount();
  const close = vi.fn();
  render(<KoochUserProfileDialog open onOpenChange={close} />);
  await waitFor(() => expect(nameInput()).toHaveProperty("value", "نام تازه"));
  fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
});

it("preserves required-name validation and persistence failures with entered values intact", async () => {
  const view = render(<ProfilePage />);
  fireEvent.change(nameInput(), { target: { value: " " } });
  fireEvent.submit(view.container.querySelector("form")!);
  expect(mocks.error).toHaveBeenCalledWith("نام کاربر را وارد کنید.");
  expect(localStorage.getItem("kooch_user_profile")).toBeNull();
  fireEvent.change(nameInput(), { target: { value: "نام ذخیره‌نشده" } });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("fixture storage failure"); });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("ذخیره تنظیمات پروفایل انجام نشد."));
  expect(nameInput()).toHaveProperty("value", "نام ذخیره‌نشده");
  expect(screen.getByRole("button", { name: "ذخیره تغییرات" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "انصراف" })).toBeTruthy();
  expect(mocks.push).not.toHaveBeenCalled();
});

it("cancels page edits by restoring saved fields and preferences without saving or navigating", () => {
  render(<ProfilePage />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  fireEvent.change(nameInput(), { target: { value: "ذخیره نشود" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "پیامک" }));
  fireEvent.click(screen.getByRole("button", { name: "انصراف" }));
  expect(nameInput()).toHaveProperty("value", "مینا احمدی");
  expect(screen.getByRole("checkbox", { name: "پیامک" })).toHaveProperty("checked", true);
  expect(screen.queryByRole("button", { name: "انصراف" })).toBeNull();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(localStorage.getItem("kooch_user_profile")).toBeNull();
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

it("shows page actions only while fields differ from the loaded baseline", () => {
  render(<ProfilePage />);
  expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
  expect(screen.queryByRole("button", { name: "انصراف" })).toBeNull();
  for (const [label, original, edited] of [
    [/نام و نام خانوادگی/, "مینا احمدی", "نام دیگر"],
    ["شماره موبایل", "", "09120000000"],
    ["ایمیل", "mina@example.test", "other@example.test"],
  ] as const) {
    const input = screen.getByRole("textbox", { name: label });
    fireEvent.change(input, { target: { value: edited } });
    expect(screen.getByRole("button", { name: "ذخیره تغییرات" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "انصراف" })).toBeTruthy();
    fireEvent.change(input, { target: { value: original } });
    expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
  }
  expect(mocks.success).not.toHaveBeenCalled();
});

it("uses the latest successful save as the new cancel and dirty baseline", () => {
  render(<ProfilePage />);
  fireEvent.change(nameInput(), { target: { value: "نام ذخیره‌شده" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
  expect(screen.queryByRole("button", { name: "ذخیره تغییرات" })).toBeNull();
  fireEvent.change(nameInput(), { target: { value: "ویرایش دوم" } });
  fireEvent.click(screen.getByRole("button", { name: "انصراف" }));
  expect(nameInput()).toHaveProperty("value", "نام ذخیره‌شده");
  expect(screen.queryByRole("button", { name: "انصراف" })).toBeNull();
  expect(JSON.parse(localStorage.getItem("kooch_user_profile")!).name).toBe("نام ذخیره‌شده");
  expect(mocks.success).toHaveBeenCalledTimes(1);
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
  mocks.session.authenticated = state !== "anonymous";
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
