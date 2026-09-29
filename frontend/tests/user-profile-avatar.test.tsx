import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KoochUserProfileDialog } from "@/components/KoochUserProfileDialog";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(() => "session-token"),
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
  useAuthSession: () => ({ user: mocks.user }),
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
