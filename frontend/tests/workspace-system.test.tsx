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
  resolveSessionDestination,
  type AuthPropertyMembership,
  type AuthWorkspace,
  type PlatformRole,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { KoochUserMenu } from "@/components/KoochUserMenu";
import {
  clearRememberedWorkspace,
  getRememberedWorkspace,
  getToken,
  ownerPropertyKey,
  saveRememberedWorkspace,
  setToken,
  workspaceKey,
} from "@/lib/auth-session";
import { safeInternalReturnTo } from "@/lib/safe-return-to";

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
  it("shows only authorized Workspaces and switches without changing the remembered preference", async () => {
    setToken("stable-token");
    saveRememberedWorkspace(7, "admin");
    const rememberedPreference = localStorage.getItem(workspaceKey);
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

    expect(localStorage.getItem(workspaceKey)).toBe(rememberedPreference);
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

  it("logout clears session data but preserves the remembered workspace", async () => {
    setToken("stable-token");
    saveRememberedWorkspace(7, "account");
    const rememberedPreference = localStorage.getItem(workspaceKey);
    localStorage.setItem(ownerPropertyKey, "11");
    renderWithSession(session(), <KoochUserMenu />);
    await waitForSession();

    fireEvent.click(screen.getByRole("button", { name: /منوی کاربر/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "خروج" }));

    expect(getToken()).toBeNull();
    expect(localStorage.getItem(workspaceKey)).toBe(rememberedPreference);
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

  it("redirects a single Workspace directly without creating a preference", async () => {
    renderWithSession(session(), <ChooseWorkspacePage />);
    await waitForSession();

    await waitFor(() => {
      expect(navigation.router.replace).toHaveBeenCalledWith("/account");
    });
    expect(localStorage.getItem(workspaceKey)).toBeNull();
  });

  it("shows authorized choices for multiple Workspaces without implicitly remembering selection", async () => {
    navigation.pathname = "/choose-workspace";
    saveRememberedWorkspace(7, "account");
    renderWithSession(
      session({
        platformRole: "SuperAdmin",
        workspaces: ["admin", "account"],
        defaultWorkspace: "admin",
      }),
      <ChooseWorkspacePage />,
    );
    await waitForSession();

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: /محیط مهمان/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /پنل مدیریت/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /پنل اقامتگاه‌ها/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /پنل مدیریت/ }));
    expect(localStorage.getItem(workspaceKey)).toBeNull();
    expect(navigation.router.push).toHaveBeenCalledWith("/admin");
  });

  it("keeps the mandatory chooser open for Escape and backdrop clicks", async () => {
    navigation.pathname = "/choose-workspace";
    renderWithSession(
      session({
        platformRole: "SuperAdmin",
        workspaces: ["admin", "account"],
      }),
      <ChooseWorkspacePage />,
    );
    await waitForSession();

    const dialog = await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "بستن" })).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBe(dialog);

    const backdrop = screen.getByRole("button", { name: "بستن دیالوگ" });
    expect((backdrop as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(backdrop);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(navigation.router.push).not.toHaveBeenCalled();
  });

  it("saves the selected Workspace only when remember choice is checked", async () => {
    navigation.pathname = "/choose-workspace";
    renderWithSession(
      session({
        platformRole: "SuperAdmin",
        workspaces: ["admin", "account"],
      }),
      <ChooseWorkspacePage />,
    );
    await waitForSession();

    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "انتخاب من را به خاطر بسپار",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /پنل مدیریت/ }));

    expect(getRememberedWorkspace(7, ["admin", "account"])).toBe("admin");
    expect(navigation.router.push).toHaveBeenCalledWith("/admin");
  });

  it.each([
    ["محیط مهمان", "/account"],
    ["پنل مدیریت", "/admin"],
    ["پنل اقامتگاه‌ها", "/owner/properties/22"],
  ])("navigates %s through the existing destination resolver", async (label, destination) => {
    navigation.pathname = "/choose-workspace";
    localStorage.setItem(ownerPropertyKey, "22");
    renderWithSession(
      session({
        platformRole: "SuperAdmin",
        workspaces: ["admin", "owner", "account"],
        propertyMemberships: [membership(11), membership(22)],
      }),
      <ChooseWorkspacePage />,
    );
    await waitForSession();

    fireEvent.click(await screen.findByRole("button", { name: new RegExp(label) }));

    expect(navigation.router.push).toHaveBeenCalledWith(destination);
  });

  it("supports keyboard-originated activation through native option buttons", async () => {
    navigation.pathname = "/choose-workspace";
    renderWithSession(
      session({
        platformRole: "SuperAdmin",
        workspaces: ["admin", "account"],
      }),
      <ChooseWorkspacePage />,
    );
    await waitForSession();

    const accountOption = await screen.findByRole("button", {
      name: /محیط مهمان/,
    });
    accountOption.focus();
    expect(document.activeElement).toBe(accountOption);

    fireEvent.click(accountOption, { detail: 0 });
    expect(navigation.router.push).toHaveBeenCalledWith("/account");
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

describe("remembered Workspace preference", () => {
  it("stores and returns a valid preference scoped to the current user", () => {
    saveRememberedWorkspace(7, "owner");

    expect(getRememberedWorkspace(7, ["owner", "account"])).toBe("owner");
    expect(JSON.parse(localStorage.getItem(workspaceKey) ?? "null")).toEqual({
      userId: 7,
      workspace: "owner",
    });
  });

  it("does not allow another user to inherit the preference", () => {
    saveRememberedWorkspace(7, "admin");

    expect(getRememberedWorkspace(8, ["admin", "account"])).toBeNull();
    expect(localStorage.getItem(workspaceKey)).toBeNull();
  });

  it("removes a preference when its Workspace is no longer authorized", () => {
    saveRememberedWorkspace(7, "owner");

    expect(getRememberedWorkspace(7, ["account"])).toBeNull();
    expect(localStorage.getItem(workspaceKey)).toBeNull();
  });

  it("removes legacy unscoped raw Workspace values", () => {
    localStorage.setItem(workspaceKey, "account");

    expect(getRememberedWorkspace(7, ["account"])).toBeNull();
    expect(localStorage.getItem(workspaceKey)).toBeNull();
  });

  it("clears only the current user's remembered preference", () => {
    saveRememberedWorkspace(7, "account");

    clearRememberedWorkspace(8);
    expect(getRememberedWorkspace(7, ["account"])).toBe("account");

    clearRememberedWorkspace(7);
    expect(localStorage.getItem(workspaceKey)).toBeNull();
  });

  it("does not overwrite a remembered preference during route navigation", async () => {
    saveRememberedWorkspace(7, "owner");
    const rememberedPreference = localStorage.getItem(workspaceKey);
    navigation.pathname = "/account";

    renderWithSession(
      session({
        workspaces: ["owner", "account"],
        propertyMemberships: [membership(11)],
      }),
      <AccountPage />,
    );
    await waitForSession();

    expect(localStorage.getItem(workspaceKey)).toBe(rememberedPreference);
  });

  it("keeps a valid internal returnTo ahead of the remembered preference", () => {
    saveRememberedWorkspace(7, "admin");
    const currentSession = session({
      platformRole: "SuperAdmin",
      workspaces: ["admin", "account"],
    });
    const routingSession = {
      ...currentSession,
      user: { userId: currentSession.userId },
    };

    expect(
      safeInternalReturnTo("/account/orders") ??
        resolveSessionDestination(routingSession),
    ).toBe("/account/orders");
  });
});
