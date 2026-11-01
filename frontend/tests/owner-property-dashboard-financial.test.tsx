import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  propertyStatus: "PendingReview",
  canEditProperties: true,
  canEditPricing: true,
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "17" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, loading: false, workspaces: ["owner"] }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  OwnerLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({
  useOwnerProperty: () => ({
    routePropertyIsValid: true,
    effectivePermissions: {
      Properties: { edit: mocks.canEditProperties },
      Pricing: { edit: mocks.canEditPricing },
    },
  }),
}));
vi.mock("@/lib/owner-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(),
  apiRequest: (...args: unknown[]) => mocks.apiRequest(...args),
}));

import OwnerPropertyDashboardPage from "@/app/owner/properties/[id]/dashboard/page";

const missingSections = [
  { key: "basic", label: "اطلاعات پایه", actionTarget: "basic", status: "Incomplete", missingItems: ["نام فارسی"] },
  { key: "descriptions", label: "توضیحات اقامتگاه", actionTarget: "descriptions", status: "Incomplete", missingItems: ["توضیحات اقامتگاه"] },
  { key: "images", label: "تصاویر", actionTarget: "images", status: "Incomplete", missingItems: ["حداقل یک تصویر"] },
];

function setup(sections: typeof missingSections = missingSections) {
  mocks.apiRequest.mockImplementation((path: string) => Promise.resolve(
    path.endsWith("/completion") ? { completionPercentage: 67, sections }
      : path.endsWith("/room-types") ? []
      : { id: 17, name: "اقامتگاه", slug: "test-property", status: mocks.propertyStatus },
  ));
}

describe("Owner Property dashboard completion guidance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.propertyStatus = "PendingReview";
    mocks.canEditProperties = true;
    mocks.canEditPricing = true;
    setup();
  });

  it("links each actual missing item to its existing edit destination", async () => {
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" });
    expect(within(section).getByRole("link", { name: "نام فارسی" }).getAttribute("href")).toBe("/owner/properties/17?step=0");
    expect(within(section).getByRole("link", { name: "توضیحات اقامتگاه" }).getAttribute("href")).toBe("/owner/properties/17?step=5");
    expect(within(section).getByRole("link", { name: "حداقل یک تصویر" }).getAttribute("href")).toBe("/owner/properties/17?step=4");
  });

  it("hides setup guidance for an approved Property even when completion reports gaps", async () => {
    mocks.propertyStatus = "Approved";
    render(<OwnerPropertyDashboardPage />);
    await screen.findByRole("heading", { name: "اقامتگاه" });
    expect(screen.queryByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" })).toBeNull();
  });

  it("omits an empty checklist", async () => {
    setup([]);
    render(<OwnerPropertyDashboardPage />);
    await screen.findByRole("heading", { name: "اقامتگاه" });
    expect(screen.queryByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" })).toBeNull();
  });

  it("shows missing items without unauthorized edit links", async () => {
    mocks.canEditProperties = false;
    mocks.canEditPricing = false;
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" });
    expect(within(section).getByRole("list").textContent).toContain("حداقل یک تصویر");
    expect(within(section).queryAllByRole("link")).toHaveLength(0);
  });
});
