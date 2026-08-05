import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchProperties: vi.fn(),
  fetchSettings: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/components/KoochDatePicker", () => ({
  KoochDatePicker: () => <div>انتخاب تاریخ</div>,
}));
vi.mock("@/components/GuestSelector", () => ({
  GuestSelector: () => <div>انتخاب مهمان</div>,
}));
vi.mock("@/lib/public-properties", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-properties")>();
  return { ...actual, fetchPublicApi: mocks.fetchProperties };
});
vi.mock("@/lib/site-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/site-settings")>();
  return { ...actual, fetchPublicSiteSettings: mocks.fetchSettings };
});

import HomePage from "@/app/page";
import { AccommodationSearchBox } from "@/components/AccommodationSearchBox";

describe("public property visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchSettings.mockResolvedValue({});
  });

  it("does not send an implicit city when the user leaves destination empty", () => {
    render(<AccommodationSearchBox redirectToResults />);

    fireEvent.click(screen.getByRole("button", { name: "جستجوی اقامتگاه" }));

    expect(mocks.push).toHaveBeenCalledOnce();
    const destination = mocks.push.mock.calls[0][0] as string;
    expect(destination).toMatch(/^\/properties\?/);
    expect(destination).not.toContain("city=");
  });

  it("shows the API error instead of replacing it with sample properties", async () => {
    mocks.fetchProperties.mockRejectedValueOnce(new Error("offline"));

    render(<HomePage />);

    expect(
      await screen.findByText("دریافت اقامتگاه‌ها انجام نشد. لطفاً کمی بعد دوباره تلاش کنید."),
    ).toBeTruthy();
    expect(screen.queryByText("خانه حیاط دار کاشان")).toBeNull();
  });

  it("shows a real empty state instead of sample properties", async () => {
    mocks.fetchProperties.mockResolvedValueOnce([]);

    render(<HomePage />);

    expect(await screen.findByText("هنوز اقامتگاهی منتشر نشده است")).toBeTruthy();
    expect(screen.queryByText("خانه حیاط دار کاشان")).toBeNull();
    await waitFor(() => expect(mocks.fetchProperties).toHaveBeenCalledWith("/properties"));
  });
});
