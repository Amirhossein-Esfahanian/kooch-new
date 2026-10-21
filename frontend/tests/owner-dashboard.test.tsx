import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthPropertyMembership } from "@/components/auth/AuthSessionProvider";
import type { PropertyResponse } from "@/lib/owner-api";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  memberships: [] as AuthPropertyMembership[],
  allowEmptyMemberships: false,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  OwnerLayout: ({ children, allowEmptyMemberships }: { children: ReactNode; allowEmptyMemberships: boolean }) => {
    mocks.allowEmptyMemberships = allowEmptyMemberships;
    return <>{children}</>;
  },
}));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({
  useOwnerProperty: () => ({ activeMemberships: mocks.memberships }),
}));
vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

import OwnerHomePage from "@/app/owner/page";
import { ApiRequestError } from "@/lib/owner-api";

function membership(propertyId: number, permissions: string[] = []): AuthPropertyMembership {
  return {
    propertyId,
    propertyName: `اقامتگاه ${propertyId}`,
    propertyRole: "PropertyOwner",
    membershipStatus: "Active",
    isActive: true,
    effectivePermissions: Object.fromEntries(
      permissions.map((permission) => [permission, { view: true }]),
    ),
  } as AuthPropertyMembership;
}

function property(id: number, name: string, status = "Approved"): PropertyResponse {
  return { id, name, status, destinationName: "کاشان", city: "کاشان", country: "ایران" } as PropertyResponse;
}

describe("Owner dashboard entry V1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberships = [membership(11, ["Bookings", "Pricing"])];
    mocks.apiRequest.mockResolvedValue([property(11, "خانه سرو")]);
  });

  it("loads the authorized property API and shows a single property's real details and permitted links", async () => {
    render(<OwnerHomePage />);
    expect(screen.getByRole("status").textContent).toContain("در حال دریافت");
    const card = await screen.findByText("خانه سرو");
    expect(mocks.allowEmptyMemberships).toBe(true);
    expect(mocks.apiRequest).toHaveBeenCalledWith("/owner/properties", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(card).toBeTruthy();
    expect(screen.getByText("تأیید شده")).toBeTruthy();
    const links = within(screen.getByRole("navigation", { name: "مدیریت خانه سرو" }));
    expect(links.getByRole("link", { name: "داشبورد اقامتگاه" }).getAttribute("href")).toBe("/owner/properties/11/dashboard");
    expect(links.getByRole("link", { name: "رزروها" }).getAttribute("href")).toBe("/owner/properties/11/reservations");
    expect(links.getByRole("link", { name: "تقویم قیمت‌گذاری" }).getAttribute("href")).toBe("/owner/properties/11/pricing");
    expect(screen.queryByText(/درآمد|پیام‌ها|رزروهای امروز/)).toBeNull();
  });

  it("shows multiple active properties only, with per-property permission links", async () => {
    mocks.memberships = [membership(11, ["Bookings"]), membership(22, ["Pricing"])];
    mocks.apiRequest.mockResolvedValue([property(11, "خانه سرو"), property(22, "خانه بید", "Draft"), property(33, "خانه پنهان")]);
    render(<OwnerHomePage />);
    expect(await screen.findByText("خانه بید")).toBeTruthy();
    expect(screen.queryByText("خانه پنهان")).toBeNull();
    expect(screen.getByText("پیش‌نویس")).toBeTruthy();
    const first = within(screen.getByRole("navigation", { name: "مدیریت خانه سرو" }));
    const second = within(screen.getByRole("navigation", { name: "مدیریت خانه بید" }));
    expect(first.getByRole("link", { name: "رزروها" })).toBeTruthy();
    expect(first.queryByRole("link", { name: "تقویم قیمت‌گذاری" })).toBeNull();
    expect(second.getByRole("link", { name: "تقویم قیمت‌گذاری" })).toBeTruthy();
    expect(second.queryByRole("link", { name: "رزروها" })).toBeNull();
  });

  it("shows an honest empty state without requesting data when no membership is active", () => {
    mocks.memberships = [];
    render(<OwnerHomePage />);
    expect(screen.getByRole("status").textContent).toContain("دسترسی فعال ندارید");
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it("distinguishes an empty API list from a loading or error state", async () => {
    mocks.apiRequest.mockResolvedValue([]);
    render(<OwnerHomePage />);
    expect(await screen.findByText("اقامتگاهی برای نمایش در دسترس نیست.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fails closed on API errors and retries without stale properties", async () => {
    mocks.apiRequest.mockRejectedValueOnce(new Error("offline"));
    render(<OwnerHomePage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("خانه سرو")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByText("خانه سرو")).toBeTruthy();
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
  });

  it("shows a permission denial without a misleading retry", async () => {
    mocks.apiRequest.mockRejectedValue(new ApiRequestError("forbidden", 403));
    render(<OwnerHomePage />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("دسترسی به اقامتگاه‌ها ندارید"));
    expect(screen.queryByRole("button", { name: "تلاش دوباره" })).toBeNull();
    expect(screen.queryByText("خانه سرو")).toBeNull();
  });
});
