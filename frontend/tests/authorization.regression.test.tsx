import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  pathname: "/",
  router: {
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  },
}));

const ownerApi = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  clearToken: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => navigation.pathname,
  useRouter: () => navigation.router,
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return {
    ...actual,
    apiRequest: ownerApi.apiRequest,
    clearToken: ownerApi.clearToken,
    getToken: ownerApi.getToken,
  };
});

import {
  AuthSessionProvider,
  resolveSessionDestination,
  useAuthSession,
  type AuthPropertyMembership,
  type AuthWorkspace,
  type PlatformRole,
  type PropertyPermissionMatrix,
} from "@/components/auth/AuthSessionProvider";
import { AdminLayout, OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { OwnerPropertyProvider } from "@/components/owner/OwnerPropertyProvider";

type SessionResponse = {
  userId: number;
  firstName: string;
  lastName: string;
  guestId: number | null;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  platformRole: PlatformRole;
  isActive: boolean;
  workspaces: AuthWorkspace[];
  propertyMemberships: AuthPropertyMembership[];
  defaultWorkspace: AuthWorkspace | null;
  defaultPropertyId: number | null;
};

const permissionActions = (view: boolean) => ({
  view,
  create: view,
  edit: view,
  delete: view,
  export: view,
});

function permissionMatrix(
  visibleGroups: string[] = [],
): PropertyPermissionMatrix {
  return Object.fromEntries(
    [
      "Dashboard",
      "Properties",
      "Rooms",
      "Pricing",
      "Inventory",
      "Bookings",
      "Reviews",
      "Users",
      "Financial",
      "Reports",
      "Settings",
    ].map((group) => [group, permissionActions(visibleGroups.includes(group))]),
  );
}

function membership(
  propertyId: number,
  options: Partial<AuthPropertyMembership> = {},
): AuthPropertyMembership {
  return {
    propertyId,
    propertyName: `Property ${propertyId}`,
    propertyRole: "PropertyOwner",
    membershipStatus: "Active",
    isActive: true,
    effectivePermissions: permissionMatrix([
      "Properties",
      "Rooms",
      "Pricing",
      "Inventory",
      "Bookings",
      "Reviews",
      "Users",
      "Financial",
      "Reports",
      "Settings",
    ]),
    ...options,
  };
}

function session(
  options: Partial<SessionResponse> = {},
): SessionResponse {
  return {
    userId: 1,
    firstName: "Test",
    lastName: "User",
    guestId: null,
    fullName: "Test User",
    email: "test@example.com",
    phoneNumber: null,
    platformRole: "Client",
    isActive: true,
    workspaces: ["account"],
    propertyMemberships: [],
    defaultWorkspace: "account",
    defaultPropertyId: null,
    ...options,
  };
}

function SessionReady() {
  const { loading } = useAuthSession();
  return <span data-testid="session-state">{loading ? "loading" : "ready"}</span>;
}

function renderWithSession(
  response: SessionResponse,
  children: ReactNode,
  options: { params?: Record<string, string>; pathname?: string } = {},
) {
  navigation.pathname = options.pathname ?? "/";
  navigation.params = options.params ?? {};
  ownerApi.getToken.mockReturnValue("test-token");
  ownerApi.apiRequest.mockImplementation((path: string) => {
    if (path === "/auth/me") return Promise.resolve(response);
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });

  return render(
    <AuthSessionProvider>
      <OwnerPropertyProvider>
        <SessionReady />
        {children}
      </OwnerPropertyProvider>
    </AuthSessionProvider>,
  );
}

async function waitForSession() {
  await waitFor(() => {
    expect(screen.getByTestId("session-state").textContent).toBe("ready");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.pathname = "/";
  navigation.params = {};
});

describe("platform workspace authorization", () => {
  it("allows a SuperAdmin with the admin workspace", async () => {
    renderWithSession(
      session({
        platformRole: "SuperAdmin",
        workspaces: ["admin"],
        defaultWorkspace: "admin",
      }),
      <AdminLayout>
        <div data-testid="admin-content">admin</div>
      </AdminLayout>,
      { pathname: "/admin" },
    );

    expect(await screen.findByTestId("admin-content")).toBeTruthy();
  });

  it("allows an AdminAssistant only when the session exposes admin access", async () => {
    renderWithSession(
      session({
        platformRole: "AdminAssistant",
        workspaces: ["admin"],
        defaultWorkspace: "admin",
      }),
      <AdminLayout>
        <div data-testid="assistant-admin-content">admin</div>
      </AdminLayout>,
      { pathname: "/admin" },
    );

    expect(await screen.findByTestId("assistant-admin-content")).toBeTruthy();
  });

  it("denies an AdminAssistant when admin access is absent", async () => {
    renderWithSession(
      session({ platformRole: "AdminAssistant" }),
      <AdminLayout>
        <div data-testid="denied-admin-content">admin</div>
      </AdminLayout>,
      { pathname: "/admin" },
    );

    await waitForSession();
    await waitFor(() =>
      expect(navigation.router.replace).toHaveBeenCalledWith("/account"),
    );
    expect(screen.queryByTestId("denied-admin-content")).toBeNull();
  });

  it("keeps an account-only guest out of admin and owner destinations", () => {
    const guest = session();

    expect(resolveSessionDestination(guest)).toBe("/account");
    expect(guest.workspaces).toEqual(["account"]);
  });
});

describe("property workspace authorization", () => {
  it("opens the single active property for an owner", async () => {
    const ownerMembership = membership(11);
    renderWithSession(
      session({
        workspaces: ["owner", "account"],
        propertyMemberships: [ownerMembership],
        defaultWorkspace: "owner",
        defaultPropertyId: 11,
      }),
      <OwnerLayout>
        <div data-testid="owner-content">owner</div>
      </OwnerLayout>,
      { pathname: "/owner/properties/11", params: { id: "11" } },
    );

    expect(await screen.findByTestId("owner-content")).toBeTruthy();
    expect(screen.getByText("Property 11")).toBeTruthy();
  });

  it("sends a multi-property owner without a saved property to the first active property", () => {
    const memberships = [membership(11), membership(22)];
    const owner = session({
      workspaces: ["owner"],
      propertyMemberships: memberships,
      defaultWorkspace: "owner",
    });

    expect(resolveSessionDestination(owner)).toBe("/owner/properties/11");
  });

  it("restores a valid saved property and rejects a stale saved property", () => {
    const owner = session({
      workspaces: ["owner", "account"],
      propertyMemberships: [membership(11), membership(22)],
      defaultWorkspace: "owner",
      defaultPropertyId: 11,
    });

    localStorage.setItem("kooch_workspace", "owner");
    localStorage.setItem("kooch_owner_property_id", "22");
    expect(resolveSessionDestination(owner)).toBe("/owner/properties/22");

    localStorage.setItem("kooch_owner_property_id", "999");
    expect(resolveSessionDestination(owner)).toBe("/owner/properties/11");
    expect(localStorage.getItem("kooch_owner_property_id")).toBeNull();
  });

  it("rejects a property route outside the active memberships", async () => {
    renderWithSession(
      session({
        workspaces: ["owner"],
        propertyMemberships: [membership(11)],
        defaultWorkspace: "owner",
        defaultPropertyId: 11,
      }),
      <OwnerLayout>
        <div data-testid="invalid-property-content">owner</div>
      </OwnerLayout>,
      { pathname: "/owner/properties/999/rooms", params: { id: "999" } },
    );

    await waitForSession();
    await waitFor(() =>
      expect(navigation.router.replace).toHaveBeenCalledWith(
        "/owner/properties/11",
      ),
    );
    expect(screen.queryByTestId("invalid-property-content")).toBeNull();
  });

  it("does not treat a suspended membership as active", async () => {
    renderWithSession(
      session({
        workspaces: ["owner"],
        propertyMemberships: [
          membership(11, {
            membershipStatus: "Suspended",
            isActive: false,
          }),
        ],
        defaultWorkspace: "owner",
        defaultPropertyId: 11,
      }),
      <OwnerLayout>
        <div data-testid="suspended-content">owner</div>
      </OwnerLayout>,
      { pathname: "/owner/properties/11", params: { id: "11" } },
    );

    await waitForSession();
    expect(screen.queryByTestId("suspended-content")).toBeNull();
  });

  it("filters the sidebar for a limited property assistant", async () => {
    const assistant = membership(11, {
      propertyRole: "Reception",
      effectivePermissions: permissionMatrix(["Rooms"]),
    });
    renderWithSession(
      session({
        workspaces: ["owner"],
        propertyMemberships: [assistant],
        defaultWorkspace: "owner",
        defaultPropertyId: 11,
      }),
      <OwnerLayout>
        <div data-testid="assistant-owner-content">owner</div>
      </OwnerLayout>,
      { pathname: "/owner/properties/11", params: { id: "11" } },
    );

    expect(await screen.findByTestId("assistant-owner-content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "داشبورد" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "اتاق‌ها" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "رزروها" })).toBeNull();
    expect(screen.queryByRole("link", { name: "کاربران" })).toBeNull();
  });

  it("switches only between properties in the active session", async () => {
    renderWithSession(
      session({
        workspaces: ["owner"],
        propertyMemberships: [membership(11), membership(22)],
        defaultWorkspace: "owner",
        defaultPropertyId: 11,
      }),
      <OwnerLayout>
        <div data-testid="multi-property-content">owner</div>
      </OwnerLayout>,
      { pathname: "/owner/properties/11", params: { id: "11" } },
    );

    expect(await screen.findByTestId("multi-property-content")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "22" },
    });

    expect(navigation.router.push).toHaveBeenCalledWith("/owner/properties/22");
  });
});

describe("legacy storage regression", () => {
  it("does not grant admin authority from the cached role", async () => {
    localStorage.setItem("kooch_user_role", "SuperAdmin");
    renderWithSession(
      session(),
      <AdminLayout>
        <div data-testid="cached-role-content">admin</div>
      </AdminLayout>,
      { pathname: "/admin" },
    );

    await waitForSession();
    await waitFor(() =>
      expect(navigation.router.replace).toHaveBeenCalledWith("/account"),
    );
    expect(screen.queryByTestId("cached-role-content")).toBeNull();
  });

  it("restores only an authorized Workspace and discards stale values", () => {
    const multiWorkspaceSession = session({
      platformRole: "SuperAdmin",
      workspaces: ["admin", "account"],
      defaultWorkspace: "admin",
    });

    expect(resolveSessionDestination(multiWorkspaceSession)).toBe(
      "/choose-workspace",
    );

    localStorage.setItem("kooch_workspace", "account");
    expect(resolveSessionDestination(multiWorkspaceSession)).toBe("/account");

    localStorage.setItem("kooch_workspace", "owner");
    expect(resolveSessionDestination(multiWorkspaceSession)).toBe(
      "/choose-workspace",
    );
    expect(localStorage.getItem("kooch_workspace")).toBeNull();
  });
});
