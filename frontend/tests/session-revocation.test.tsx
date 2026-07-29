import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  router: {
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  },
}));

const sonner = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/account",
  useRouter: () => navigation.router,
}));

vi.mock("sonner", () => sonner);

import {
  AuthSessionProvider,
  useAuthSession,
  type AuthSession,
} from "@/components/auth/AuthSessionProvider";
import {
  apiRequest,
  ApiRequestError,
  getToken,
  ownerPropertyKey,
  setToken,
} from "@/lib/owner-api";
import { resetSessionRevocationStateForTests } from "@/lib/auth-session";

function authSessionResponse(): AuthSession {
  return {
    user: {
      userId: 7,
      firstName: "Session",
      lastName: "User",
      guestId: null,
      fullName: "Session User",
      email: "session@example.com",
      phoneNumber: null,
      isActive: true,
    },
    platformRole: "Client",
    platformPermissions: [],
    workspaces: ["account"],
    propertyMemberships: [],
    defaultWorkspace: "account",
    defaultPropertyId: null,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function SessionProbe() {
  const session = useAuthSession();

  return (
    <div>
      <span data-testid="loading">{session.loading ? "loading" : "ready"}</span>
      <span data-testid="authenticated">
        {session.authenticated ? "yes" : "no"}
      </span>
      <span data-testid="user-email">{session.user?.email ?? "none"}</span>
    </div>
  );
}

async function renderLoadedProvider(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce(jsonResponse(authSessionResponse()));

  render(
    <AuthSessionProvider>
      <SessionProbe />
    </AuthSessionProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("loading").textContent).toBe("ready");
    expect(screen.getByTestId("authenticated").textContent).toBe("yes");
  });
}

async function expectApiError(
  request: Promise<unknown>,
  status: number,
  sessionRevoked: boolean,
) {
  try {
    await request;
    throw new Error("Expected request to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(status);
    expect((error as ApiRequestError).sessionRevoked).toBe(sessionRevoked);
  }
}

describe("canonical session revocation handling", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetSessionRevocationStateForTests();
    setToken("access-token");
    localStorage.setItem("kooch_workspace", "owner");
    localStorage.setItem(ownerPropertyKey, "42");
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("clears provider state, token, workspace selection, redirects, and shows one message for a body-coded revoked API response", async () => {
    await renderLoadedProvider(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { code: "session_revoked", message: "Your session was revoked." },
        { status: 401 },
      ),
    );

    await act(async () => {
      await expectApiError(apiRequest("/owner/properties"), 401, true);
    });

    await waitFor(() => {
      expect(screen.getByTestId("authenticated").textContent).toBe("no");
      expect(getToken()).toBeNull();
      expect(localStorage.getItem("kooch_workspace")).toBeNull();
      expect(localStorage.getItem(ownerPropertyKey)).toBeNull();
      expect(navigation.router.replace).toHaveBeenCalledTimes(1);
      expect(navigation.router.replace).toHaveBeenCalledWith("/login");
      expect(sonner.toast.error).toHaveBeenCalledTimes(1);
      expect(sonner.toast.error).toHaveBeenCalledWith("Your session was revoked.");
    });
  });

  it("uses the same invalidation flow for the session_revoked response header", async () => {
    await renderLoadedProvider(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { message: "Header revoked." },
        {
          status: 401,
          headers: { "X-Kooch-Auth-Error": "session_revoked" },
        },
      ),
    );

    await act(async () => {
      await expectApiError(apiRequest("/account/profile"), 401, true);
    });

    await waitFor(() => {
      expect(screen.getByTestId("authenticated").textContent).toBe("no");
      expect(getToken()).toBeNull();
      expect(navigation.router.replace).toHaveBeenCalledTimes(1);
      expect(sonner.toast.error).toHaveBeenCalledTimes(1);
      expect(sonner.toast.error).toHaveBeenCalledWith("Header revoked.");
    });
  });

  it("deduplicates concurrent revoked responses", async () => {
    await renderLoadedProvider(fetchMock);
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          { code: "session_revoked", message: "Concurrent revocation." },
          { status: 401 },
        ),
      ),
    );

    await act(async () => {
      await Promise.allSettled([
        apiRequest("/owner/properties"),
        apiRequest("/admin/dashboard"),
      ]);
    });

    await waitFor(() => {
      expect(getToken()).toBeNull();
      expect(screen.getByTestId("authenticated").textContent).toBe("no");
      expect(navigation.router.replace).toHaveBeenCalledTimes(1);
      expect(sonner.toast.error).toHaveBeenCalledTimes(1);
    });
  });

  it("does not log out on ordinary 403 permission denial", async () => {
    await renderLoadedProvider(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Forbidden." }, { status: 403 }),
    );

    await act(async () => {
      await expectApiError(apiRequest("/admin/dashboard"), 403, false);
    });

    expect(screen.getByTestId("authenticated").textContent).toBe("yes");
    expect(getToken()).toBe("access-token");
    expect(navigation.router.replace).not.toHaveBeenCalled();
    expect(sonner.toast.error).not.toHaveBeenCalled();
  });

  it("does not use canonical logout for ordinary non-auth/me 401 responses without the revocation signal", async () => {
    await renderLoadedProvider(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Unauthorized." }, { status: 401 }),
    );

    await act(async () => {
      await expectApiError(apiRequest("/owner/properties"), 401, false);
    });

    expect(screen.getByTestId("authenticated").textContent).toBe("yes");
    expect(getToken()).toBe("access-token");
    expect(navigation.router.replace).not.toHaveBeenCalled();
    expect(sonner.toast.error).not.toHaveBeenCalled();
  });

  it("handles /auth/me 401 through the same canonical invalidation mechanism", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Current session is invalid." }, { status: 401 }),
    );

    render(
      <AuthSessionProvider>
        <SessionProbe />
      </AuthSessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("ready");
      expect(screen.getByTestId("authenticated").textContent).toBe("no");
      expect(getToken()).toBeNull();
      expect(navigation.router.replace).toHaveBeenCalledTimes(1);
      expect(navigation.router.replace).toHaveBeenCalledWith("/login");
      expect(sonner.toast.error).toHaveBeenCalledTimes(1);
      expect(sonner.toast.error).toHaveBeenCalledWith(
        "Current session is invalid.",
      );
    });
  });
});
