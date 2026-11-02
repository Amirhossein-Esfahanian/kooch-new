import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KoochUserProfileDialog } from "@/components/KoochUserProfileDialog";
import { KoochUserMenu } from "@/components/KoochUserMenu";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(() => "session-token"),
  pathname: "/admin",
  push: vi.fn(), clearSession: vi.fn(),
  user: {
    userId: 17, firstName: "الهه", lastName: "رحیم‌زاده",
    fullName: "الهه رحیم‌زاده", email: "user@example.com",
  },
}));

vi.mock("@/lib/owner-api", () => ({
  apiRequest: mocks.apiRequest,
  getToken: mocks.getToken,
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ user: mocks.user, workspaces: ["admin", "owner"], clearSession: mocks.clearSession }),
  resolveSessionDestination: (_session: unknown, workspace: string) => `/${workspace}`,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

function missingAvatar() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false }));
}

function existingAvatar() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    status: 200, ok: true, blob: async () => new Blob(["webp"], { type: "image/webp" }),
  }));
}

beforeEach(() => {
  localStorage.clear();
  mocks.apiRequest.mockReset().mockResolvedValue(undefined);
  mocks.getToken.mockReturnValue("session-token");
  mocks.pathname = "/admin";
  mocks.push.mockReset(); mocks.clearSession.mockReset();
  mocks.user = {
    userId: 17, firstName: "الهه", lastName: "رحیم‌زاده",
    fullName: "الهه رحیم‌زاده", email: "user@example.com",
  };
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn().mockReturnValue("blob:avatar-1"),
    revokeObjectURL: vi.fn(),
  }));
  missingAvatar();
});

describe("Sidebar profile avatar", () => {
  function trigger() { return screen.getByRole("button", { name: /منوی کاربر/ }); }

  it("loads after Strict Mode effect remounts", async () => {
    existingAvatar();
    render(<StrictMode><KoochUserMenu variant="sidebar" /></StrictMode>);
    expect((await within(trigger()).findByRole("img")).getAttribute("src")).toBe("blob:avatar-1");
  });

  it.each(["/admin", "/owner/properties/11/dashboard"])("renders the authenticated image in %s, including collapsed mode", async (pathname) => {
    mocks.pathname = pathname;
    existingAvatar();
    const view = render(<KoochUserMenu variant="sidebar" />);
    const image = await within(trigger()).findByRole("img", { name: "تصویر پروفایل" });
    expect(image.getAttribute("src")).toBe("blob:avatar-1");
    expect(image.getAttribute("width")).toBe("32");
    expect(image.className).toContain("object-cover");
    expect(trigger().className).toContain("min-h-11");
    view.rerender(<KoochUserMenu collapsed variant="sidebar" />);
    expect(trigger().getAttribute("title")).toBe(mocks.user.fullName);
    expect(within(trigger()).getByRole("img")).toBe(image);
  });

  it("keeps initials for missing or failed images", async () => {
    const view = render(<KoochUserMenu variant="sidebar" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(within(trigger()).queryByRole("img")).toBeNull();
    expect(within(trigger()).getByText("ا")).toBeTruthy();
    view.unmount();
    existingAvatar();
    render(<KoochUserMenu variant="sidebar" />);
    fireEvent.error(await within(trigger()).findByRole("img"));
    expect(within(trigger()).queryByRole("img")).toBeNull();
    expect(within(trigger()).getByText("ا")).toBeTruthy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar-1");
  });

  it("shares upload/delete updates with the dialog without duplicate lookups and preserves logout", async () => {
    existingAvatar();
    vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:old").mockReturnValueOnce("blob:new");
    render(<KoochUserMenu variant="sidebar" />);
    await within(trigger()).findByRole("img");
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "تنظیمات حساب" }));
    await screen.findByRole("dialog");
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("انتخاب تصویر پروفایل"), {
      target: { files: [new File(["image"], "photo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(within(trigger()).getByRole("img").getAttribute("src")).toBe("blob:new"));
    expect(within(screen.getByRole("dialog")).getByRole("img").getAttribute("src")).toBe("blob:new");
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "حذف تصویر" }));
    await waitFor(() => expect(within(trigger()).queryByRole("img")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "انصراف" }));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "خروج" }));
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/login");
  });

  it("reloads the persisted photo across navigation and Admin/Owner remounts", async () => {
    existingAvatar();
    const view = render(<KoochUserMenu variant="sidebar" />);
    await within(trigger()).findByRole("img");
    view.unmount();
    mocks.pathname = "/owner/properties/11/dashboard";
    render(<KoochUserMenu variant="sidebar" />);
    expect((await within(trigger()).findByRole("img")).getAttribute("src")).toBe("blob:avatar-1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("silently falls back for lookup failures or absent credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const view = render(<KoochUserMenu variant="sidebar" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(within(trigger()).queryByRole("img")).toBeNull();
    view.unmount();
    vi.mocked(fetch).mockClear();
    mocks.getToken.mockReturnValue("");
    render(<KoochUserMenu variant="sidebar" />);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not replace the previous avatar when upload fails", async () => {
    existingAvatar();
    mocks.apiRequest.mockRejectedValueOnce(new Error("upload failed"));
    render(<KoochUserMenu variant="sidebar" />);
    await within(trigger()).findByRole("img");
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "تنظیمات حساب" }));
    fireEvent.change(await screen.findByLabelText("انتخاب تصویر پروفایل"), {
      target: { files: [new File(["image"], "photo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
    expect(within(trigger()).getByRole("img").getAttribute("src")).toBe("blob:avatar-1");
  });

  it("discards stale avatar requests when the authenticated User changes", async () => {
    let finishOld!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finishOld = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending).mockResolvedValue({
      status: 200, ok: true, blob: async () => new Blob(["new-user"], { type: "image/webp" }),
    }));
    const view = render(<KoochUserMenu variant="sidebar" />);
    mocks.user = { ...mocks.user, userId: 18, fullName: "کاربر دیگر" };
    view.rerender(<KoochUserMenu variant="sidebar" />);
    await within(trigger()).findByRole("img");
    await act(async () => { finishOld(new Response("old-user")); });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(within(trigger()).getByRole("img").getAttribute("src")).toBe("blob:avatar-1");
  });
});

describe("User profile avatar", () => {
  it("shows the existing authenticated avatar", async () => {
    existingAvatar();
    render(<KoochUserProfileDialog onOpenChange={vi.fn()} open />);
    const image = await screen.findByRole("img", { name: "تصویر پروفایل" });
    expect(image.getAttribute("src")).toBe("blob:avatar-1");
    expect(screen.getByRole("button", { name: "حذف تصویر" })).not.toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/backend/account/profile/avatar", expect.objectContaining({
      headers: { Authorization: "Bearer session-token" }, cache: "no-store",
    }));
  });

  it.each([
    ["الهه رحیم‌زاده", "الهه", "رحیم‌زاده", "ا ر"],
    ["Ali Ahmadi", "Ali", "Ahmadi", "A A"],
    ["علی", "علی", "", "ع"],
  ])("uses separate name parts for %s", async (fullName, firstName, lastName, expected) => {
    mocks.user = { ...mocks.user, fullName, firstName, lastName };
    render(<KoochUserProfileDialog onOpenChange={vi.fn()} open />);
    expect(await screen.findByText(expected)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "حذف تصویر" })).toBeNull();
  });

  it("uploads a file and refreshes the displayed image without saving an avatar URL locally", async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce({ status: 404, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true, blob: async () => new Blob(["new"], { type: "image/webp" }) });
    vi.stubGlobal("fetch", lookup);
    render(<KoochUserProfileDialog onOpenChange={vi.fn()} open />);
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("انتخاب تصویر پروفایل"), {
      target: { files: [new File(["image"], "photo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/account/profile/avatar", expect.objectContaining({ method: "PUT", body: expect.any(FormData) }),
    ));
    expect((await screen.findByRole("img", { name: "تصویر پروفایل" })).getAttribute("src")).toBe("blob:avatar-1");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("kooch_user_profile")).toBeNull();
  });

  it("deletes only after success and returns to initials", async () => {
    existingAvatar();
    render(<KoochUserProfileDialog onOpenChange={vi.fn()} open />);
    await screen.findByRole("img", { name: "تصویر پروفایل" });
    fireEvent.click(screen.getByRole("button", { name: "حذف تصویر" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/account/profile/avatar", { method: "DELETE" },
    ));
    expect(await screen.findByText("ا ر")).not.toBeNull();
    expect(screen.queryByRole("img", { name: "تصویر پروفایل" })).toBeNull();
  });

  it("keeps the current image on delete failure and never uses a legacy local URL", async () => {
    localStorage.setItem("kooch_user_profile", JSON.stringify({ avatar: "https://legacy.example/avatar.png" }));
    existingAvatar();
    mocks.apiRequest.mockRejectedValueOnce(new Error("حذف انجام نشد"));
    render(<KoochUserProfileDialog onOpenChange={vi.fn()} open />);
    await screen.findByRole("img", { name: "تصویر پروفایل" });
    fireEvent.click(screen.getByRole("button", { name: "حذف تصویر" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("img", { name: "تصویر پروفایل" }).getAttribute("src")).toBe("blob:avatar-1");
    expect(screen.queryByDisplayValue("https://legacy.example/avatar.png")).toBeNull();
    expect(screen.queryByText("انتخاب پوسته")).toBeNull();
    expect(screen.queryByText("زبان")).toBeNull();
  });
});
