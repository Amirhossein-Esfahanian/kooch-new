import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ownerApi = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  current: {
    authenticated: true,
    loading: false,
    platformRole: "SuperAdmin" as "SuperAdmin" | "AdminAssistant",
    platformPermissions: [] as string[],
    workspaces: ["admin"] as string[],
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: ownerApi.apiRequest };
});

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => auth.current,
}));

vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({
    children,
    requiredPlatformPermission,
  }: {
    children: ReactNode;
    requiredPlatformPermission?: string;
  }) => (
    <div data-required-permission={requiredPlatformPermission}>{children}</div>
  ),
}));

import AdminPropertyMembersPage from "@/app/admin/property-members/page";

type PropertySearchItem = {
  id: number;
  name: string;
  englishName: string | null;
  city: string;
  ownerName: string;
  ownerEmail: string;
};

function searchResponse(items: PropertySearchItem[]) {
  return {
    items,
    totalCount: items.length,
    page: 1,
    pageSize: 10,
    totalPages: items.length > 0 ? 1 : 0,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function runSearchDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  auth.current = {
    authenticated: true,
    loading: false,
    platformRole: "SuperAdmin",
    platformPermissions: [],
    workspaces: ["admin"],
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Admin property members entry page", () => {
  it("selects a property and navigates to canonical member management", async () => {
    ownerApi.apiRequest.mockResolvedValue(
      searchResponse([
        {
          id: 42,
          name: "خانه تاریخی کاشان",
          englishName: "Kashan Historic House",
          city: "کاشان",
          ownerName: "سارا محمدی",
          ownerEmail: "owner@example.test",
        },
      ]),
    );

    render(<AdminPropertyMembersPage />);
    await runSearchDebounce();

    expect(
      screen.getByRole("heading", { name: "اعضای اقامتگاه‌ها", level: 1 }),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-required-permission="ManageUsers"]'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "مالک اقامتگاه از مسیر انتقال مالکیت تعیین می‌شود و از فرم افزودن عضو قابل تغییر نیست.",
      ),
    ).toBeTruthy();
    expect(ownerApi.apiRequest).toHaveBeenCalledWith(
      "/admin/properties/search?search=&page=1&pageSize=10",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "مدیریت / انتقال مالکیت" }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/admin/properties");
    navigation.push.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    fireEvent.click(
      screen.getByRole("button", { name: /خانه تاریخی کاشان/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "مدیریت اعضای اقامتگاه" }),
    );

    expect(navigation.push).toHaveBeenCalledWith(
      "/admin/properties/42/users",
    );
    expect(
      ownerApi.apiRequest.mock.calls.some(
        ([path]) => path === "/admin/properties/42/users",
      ),
    ).toBe(false);
  });

  it("replaces options with server-side search results", async () => {
    ownerApi.apiRequest.mockImplementation((path: string) => {
      if (path.includes("search=%DA%A9%D8%A7%D8%B4%D8%A7%D9%86")) {
        return Promise.resolve(
          searchResponse([
            {
              id: 42,
              name: "خانه تاریخی کاشان",
              englishName: "Kashan Historic House",
              city: "کاشان",
              ownerName: "سارا محمدی",
              ownerEmail: "owner@example.test",
            },
          ]),
        );
      }

      return Promise.resolve(
        searchResponse([
          {
            id: 7,
            name: "اقامتگاه یزد",
            englishName: "Yazd Residence",
            city: "یزد",
            ownerName: "علی رضایی",
            ownerEmail: "yazd@example.test",
          },
        ]),
      );
    });

    render(<AdminPropertyMembersPage />);
    await runSearchDebounce();

    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    expect(
      screen.getByRole("button", { name: /اقامتگاه یزد/ }),
    ).toBeTruthy();

    fireEvent.change(
      screen.getByPlaceholderText("جستجو با نام، شهر یا مالک..."),
      { target: { value: "کاشان" } },
    );
    await runSearchDebounce();

    expect(ownerApi.apiRequest).toHaveBeenLastCalledWith(
      "/admin/properties/search?search=%DA%A9%D8%A7%D8%B4%D8%A7%D9%86&page=1&pageSize=10",
    );
    expect(
      screen.queryByRole("button", { name: /اقامتگاه یزد/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /خانه تاریخی کاشان/ }),
    ).toBeTruthy();
  });

  it("does not let a stale search response replace newer options", async () => {
    const olderSearch = deferred<ReturnType<typeof searchResponse>>();
    const newerSearch = deferred<ReturnType<typeof searchResponse>>();
    ownerApi.apiRequest.mockImplementation((path: string) => {
      if (path.includes("search=old")) return olderSearch.promise;
      if (path.includes("search=new")) return newerSearch.promise;
      return Promise.resolve(searchResponse([]));
    });

    render(<AdminPropertyMembersPage />);
    await runSearchDebounce();

    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    const searchInput = screen.getByPlaceholderText(
      "جستجو با نام، شهر یا مالک...",
    );
    fireEvent.change(searchInput, { target: { value: "old" } });
    await runSearchDebounce();
    fireEvent.change(searchInput, { target: { value: "new" } });
    await runSearchDebounce();

    await act(async () => {
      newerSearch.resolve(
        searchResponse([
          {
            id: 2,
            name: "new lodge",
            englishName: "new lodge",
            city: "Tehran",
            ownerName: "New Owner",
            ownerEmail: "new@example.test",
          },
        ]),
      );
      await newerSearch.promise;
    });
    expect(screen.getByRole("button", { name: /new lodge/ })).toBeTruthy();

    await act(async () => {
      olderSearch.resolve(
        searchResponse([
          {
            id: 1,
            name: "old lodge",
            englishName: "old lodge",
            city: "Shiraz",
            ownerName: "Old Owner",
            ownerEmail: "old@example.test",
          },
        ]),
      );
      await olderSearch.promise;
    });

    expect(screen.queryByRole("button", { name: /old lodge/ })).toBeNull();
    expect(screen.getByRole("button", { name: /new lodge/ })).toBeTruthy();
  });

  it("explains the additional property permission requirement", () => {
    auth.current = {
      authenticated: true,
      loading: false,
      platformRole: "AdminAssistant",
      platformPermissions: ["ManageUsers"],
      workspaces: ["admin"],
    };

    render(<AdminPropertyMembersPage />);

    expect(
      screen.getByText(
        "برای انتخاب اقامتگاه، مجوز مدیریت اقامتگاه‌ها نیز لازم است.",
      ),
    ).toBeTruthy();
    expect(ownerApi.apiRequest).not.toHaveBeenCalled();
  });
});
