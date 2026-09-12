import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

type Membership = {
  propertyId: number;
  propertyName: string;
  role:
    | "PropertyOwner"
    | "Manager"
    | "Reception"
    | "Accounting"
    | "Housekeeping"
    | "Custom";
  status: "Pending" | "Active" | "Suspended" | "Inactive";
  isActive: boolean;
  isOwner: boolean;
};

type UserItem = {
  id: number;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  email: string | null;
  isActive: boolean;
  memberships: Membership[];
};

function directoryResponse(
  items: UserItem[],
  overrides: Partial<{
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> = {},
) {
  return {
    items,
    totalCount: overrides.totalCount ?? items.length,
    page: overrides.page ?? 1,
    pageSize: overrides.pageSize ?? 20,
    totalPages: overrides.totalPages ?? (items.length > 0 ? 1 : 0),
  };
}

function member(overrides: Partial<UserItem> = {}): UserItem {
  return {
    id: 20,
    firstName: "سارا",
    lastName: "محمدی",
    phoneNumber: "09121234567",
    email: "sara@example.test",
    isActive: false,
    memberships: [
      {
        propertyId: 101,
        propertyName: "خانه کاشان",
        role: "Manager",
        status: "Active",
        isActive: true,
        isOwner: false,
      },
      {
        propertyId: 102,
        propertyName: "اقامتگاه یزد",
        role: "Reception",
        status: "Suspended",
        isActive: false,
        isOwner: false,
      },
      {
        propertyId: 103,
        propertyName: "خانه شیراز",
        role: "Manager",
        status: "Active",
        isActive: true,
        isOwner: false,
      },
    ],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

async function flushRequests() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function runSearchDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await flushRequests();
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

describe("Admin property members global directory", () => {
  it("loads the first User page and renders one row with aggregated membership data", async () => {
    ownerApi.apiRequest.mockResolvedValue(directoryResponse([member()]));

    render(<AdminPropertyMembersPage />);
    await flushRequests();

    expect(ownerApi.apiRequest).toHaveBeenCalledWith(
      "/admin/property-members?page=1&pageSize=20",
    );
    expect(
      ownerApi.apiRequest.mock.calls.some(([path]) =>
        String(path).includes("/admin/properties/search"),
      ),
    ).toBe(false);
    expect(
      document.querySelector('[data-required-permission="ManageUsers"]'),
    ).toBeTruthy();

    const row = screen.getByText("سارا محمدی").closest("tr");
    expect(row).toBeTruthy();
    const rowQueries = within(row!);
    expect(rowQueries.getByText("۳")).toBeTruthy();
    expect(rowQueries.getAllByText("مدیر")).toHaveLength(1);
    expect(rowQueries.getByText("پذیرش")).toBeTruthy();
    expect(rowQueries.getByText("غیرفعال")).toBeTruthy();
    expect(rowQueries.queryByText("تعلیق‌شده")).toBeNull();
    expect(screen.getAllByText("سارا محمدی")).toHaveLength(1);
  });

  it("debounces server search and resets pagination to page one", async () => {
    ownerApi.apiRequest.mockImplementation((path: string) => {
      const params = new URLSearchParams(path.split("?")[1]);
      const requestedPage = Number(params.get("page"));
      return Promise.resolve(
        directoryResponse([member()], {
          page: requestedPage,
          totalCount: 40,
          totalPages: 2,
        }),
      );
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await flushRequests();
    expect(ownerApi.apiRequest).toHaveBeenLastCalledWith(
      "/admin/property-members?page=2&pageSize=20",
    );

    fireEvent.change(
      screen.getByPlaceholderText("نام، شماره تماس یا ایمیل..."),
      { target: { value: "  سارا  " } },
    );
    expect(ownerApi.apiRequest).toHaveBeenCalledTimes(2);

    await runSearchDebounce();

    expect(ownerApi.apiRequest).toHaveBeenLastCalledWith(
      "/admin/property-members?page=1&pageSize=20&search=%D8%B3%D8%A7%D8%B1%D8%A7",
    );
  });

  it("requests the selected server page and renders returned metadata", async () => {
    ownerApi.apiRequest.mockImplementation((path: string) => {
      const requestedPage = path.includes("page=2") ? 2 : 1;
      return Promise.resolve(
        directoryResponse([member({ id: requestedPage })], {
          page: requestedPage,
          totalCount: 41,
          totalPages: 3,
        }),
      );
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    expect(screen.getByText("صفحه ۱ از ۳")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await flushRequests();

    expect(ownerApi.apiRequest).toHaveBeenLastCalledWith(
      "/admin/property-members?page=2&pageSize=20",
    );
    expect(screen.getByText("صفحه ۲ از ۳")).toBeTruthy();
  });

  it("shows loading and then the empty state", async () => {
    const request = deferred<ReturnType<typeof directoryResponse>>();
    ownerApi.apiRequest.mockReturnValue(request.promise);

    render(<AdminPropertyMembersPage />);

    expect(screen.getByText("در حال بارگذاری اعضا...")).toBeTruthy();

    await act(async () => {
      request.resolve(directoryResponse([]));
      await request.promise;
    });

    expect(screen.getByText("هنوز عضوی برای نمایش وجود ندارد.")).toBeTruthy();
  });

  it("shows a search-specific empty state", async () => {
    ownerApi.apiRequest.mockResolvedValue(directoryResponse([]));

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.change(
      screen.getByPlaceholderText("نام، شماره تماس یا ایمیل..."),
      { target: { value: "ناشناخته" } },
    );
    await runSearchDebounce();

    expect(screen.getByText("کاربری مطابق جستجو پیدا نشد.")).toBeTruthy();
  });

  it("shows the existing alert treatment when loading fails", async () => {
    const request = deferred<ReturnType<typeof directoryResponse>>();
    ownerApi.apiRequest.mockReturnValue(request.promise);

    render(<AdminPropertyMembersPage />);
    await act(async () => {
      request.reject(new Error("دسترسی به فهرست ممکن نیست"));
      try {
        await request.promise;
      } catch {
        // The component renders the rejected request through KoochAlert.
      }
    });

    expect(
      screen.getByText("فهرست اعضای اقامتگاه‌ها بارگذاری نشد"),
    ).toBeTruthy();
    expect(screen.getByText("دسترسی به فهرست ممکن نیست")).toBeTruthy();
    expect(screen.getByText("امکان نمایش اعضا وجود ندارد.")).toBeTruthy();
  });
});
