import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();

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
  useOwnerProperty: () => ({ routePropertyIsValid: true, effectivePermissions: {} }),
}));
vi.mock("@/components/property/PropertyCompletionCard", () => ({
  PropertyCompletionCard: () => null,
}));
vi.mock("@/lib/owner-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(),
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

import OwnerPropertyDashboardPage from "@/app/owner/properties/[id]/dashboard/page";

describe("Owner Property dashboard financial warning", () => {
  beforeEach(() => apiRequest.mockReset());

  it.each([
    [null, true],
    [0, false],
  ])("uses loaded RoomTypes when extra price is %s", async (extraGuestPrice, warns) => {
    apiRequest.mockImplementation((path?: string) => Promise.resolve(
      typeof path === "string" && path.endsWith("/room-types")
        ? [{ isActive: true, allowExtraGuest: true, maxExtraGuests: 2 }]
        : typeof path === "string" && path.endsWith("/completion")
          ? { completionPercentage: 100 }
          : { id: 17, name: "اقامتگاه", slug: "test-property", childPrice: null, extraGuestPrice },
    ));

    render(<OwnerPropertyDashboardPage />);

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/owner/properties/17/room-types"));
    if (warns) {
      expect(await screen.findByText("نرخ نفر اضافه برای این اقامتگاه تعریف نشده است.")).toBeTruthy();
    } else {
      expect(screen.queryByText("نرخ نفر اضافه برای این اقامتگاه تعریف نشده است.")).toBeNull();
    }
    expect(screen.queryByText("نرخ کودک برای این اقامتگاه تعریف نشده است.")).toBeNull();
  });
});
