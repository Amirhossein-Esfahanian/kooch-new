import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/account",
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
  getToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => navigation.router,
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return {
    ...actual,
    apiRequest: ownerApi.apiRequest,
    getToken: ownerApi.getToken,
  };
});

import AccountPage from "@/app/account/page";
import ChooseWorkspacePage from "@/app/choose-workspace/page";
import {
  AuthSessionProvider,
  type AuthPropertyMembership,
  type AuthWorkspace,
  type PlatformRole,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { KoochUserMenu } from "@/components/KoochUserMenu";
import {
  getToken,
  ownerPropertyKey,
  setToken,
  workspaceKey,
} from "@/lib/auth-session";

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

function membership(propertyId: number): AuthPropertyMembership {
  return {
    propertyId,
    propertyName: `Property ${propertyId}`,
    propertyRole: "Manager",
    membershipStatus: "Active",
    isActive: true,
    effectivePermissions: {},
  };
}

function session(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    userId: 7,
    firstName: "کاربر",
    lastName: "کوچ",
    guestId: null,
    fullName: "کاربر کوچ",
    email: "user@example.test",
    phoneNumber: "09120000000",
    platformRole: "Client",
    isActive: true,
    workspaces: ["account"],
    propertyMemberships: [],
    defaultWorkspace: "account",
    defaultPropertyId: null,
    ...overrides,
  };
}

function SessionReady() {
  const { loading } = useAuthSession();
  return <span data-testid="session-ready">{loading ? "loading" : "ready"}</span>;
}

function renderWithSession(response: SessionResponse, children: ReactNode) {
  ownerApi.getToken.mockReturnValue("stable-token");
  ownerApi.apiRequest.mockImplementation((path: string) => {
    if (path === "/auth/me") return Promise.resolve(response);
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });

  return render(
    <AuthSessionProvider>
      <SessionReady />
      {children}
    </AuthSessionProvider>,
  );
}

async function waitForSession() {
  await waitFor(() => {
    expect(screen.getByTestId("session-ready").textContent).toBe("ready");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  navigation.pathname = "/account";
});

describe("Workspace routing and menu", () => {
  it("shows only authorized Workspaces and switches without replacing the token", async () => {
    setToken("stable-token");
    localStorage.setItem(ownerPropertyKey, "22");
    renderWithSession(
      session({
        platformRole: "SuperAdmin",
        workspaces: ["admin", "owner", "account"],
        propertyMemberships: [membership(11), membership(22)],
        defaultWorkspace: "admin",
        defaultPropertyId: 11,
      }),
      <KoochUserMenu />,
    );
    await waitForSession();

    fireEvent.click(screen.getByRole("button", { name: /منوی کاربر/ }));
    expect(screen.getByRole("menuitem", { name: "محیط مهمان" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "پنل اقامتگاه‌ها" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "پنل مدیریت" })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "پنل اقامتگاه‌ها" }),
    );

    expect(localStorage.getItem(workspaceKey)).toBe("owner");
    expect(navigation.router.push).toHaveBeenCalledWith(
      "/owner/properties/22",
    );
    expect(getToken()).toBe("stable-token");
  });

  it("hides unauthorized Workspace destinations", async () => {
    renderWithSession(session(), <KoochUserMenu />);
    await waitForSession();

    fireEvent.click(screen.getByRole("button", { name: /منوی کاربر/ }));

    expect(screen.getByRole("menuitem", { name: "محیط مهمان" })).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "پنل اقامتگاه‌ها" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "پنل مدیریت" }),
    ).toBeNull();
  });

  it("logout clears the token and both persisted selections", async () => {
    setToken("stable-token");
    localStorage.setItem(workspaceKey, "account");
    localStorage.setItem(ownerPropertyKey, "11");
    renderWithSession(session(), <KoochUserMenu />);
    await waitForSession();

    fireEvent.click(screen.getByRole("button", { name: /منوی کاربر/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "خروج" }));

    expect(getToken()).toBeNull();
    expect(localStorage.getItem(workspaceKey)).toBeNull();
    expect(localStorage.getItem(ownerPropertyKey)).toBeNull();
    expect(navigation.router.push).toHaveBeenCalledWith("/login");
  });
});

describe("Workspace routes", () => {
  it("renders the real Account landing with the existing reservations feature", async () => {
    renderWithSession(session(), <AccountPage />);
    await waitForSession();

    expect(
      screen.getByRole("heading", { name: "حساب کاربری" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "مشاهده رزروهای مستقل" })
        .getAttribute("href"),
    ).toBe("/account/reservations");
    expect(
      screen
        .getByRole("link", { name: "مشاهده سفارش‌های من" })
        .getAttribute("href"),
    ).toBe("/account/orders");
  });

  it("redirects a single Workspace directly and persists it", async () => {
    renderWithSession(session(), <ChooseWorkspacePage />);
    await waitForSession();

    await waitFor(() => {
      expect(navigation.router.replace).toHaveBeenCalledWith("/account");
    });
    expect(localStorage.getItem(workspaceKey)).toBe("account");
  });

  it("shows authorized choices for multiple Workspaces and persists selection", async () => {
    navigation.pathname = "/choose-workspace";
    renderWithSession(
      session({
        platformRole: "SuperAdmin",
        workspaces: ["admin", "account"],
        defaultWorkspace: "admin",
      }),
      <ChooseWorkspacePage />,
    );
    await waitForSession();

    expect(screen.getByRole("button", { name: /محیط مهمان/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /پنل مدیریت/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /پنل اقامتگاه‌ها/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /پنل مدیریت/ }));
    expect(localStorage.getItem(workspaceKey)).toBe("admin");
    expect(navigation.router.push).toHaveBeenCalledWith("/admin");
  });

  it("redirects unauthenticated chooser access to login", async () => {
    ownerApi.getToken.mockReturnValue(null);
    render(
      <AuthSessionProvider>
        <ChooseWorkspacePage />
      </AuthSessionProvider>,
    );

    await waitFor(() => {
      expect(navigation.router.replace).toHaveBeenCalledWith("/login");
    });
  });
});
