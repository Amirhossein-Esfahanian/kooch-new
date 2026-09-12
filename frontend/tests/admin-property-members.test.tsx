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

type PropertyOption = {
  id: number;
  name: string;
};

function propertyOptionsResponse(items: PropertyOption[]) {
  return {
    items,
    totalCount: items.length,
    page: 1,
    pageSize: 10,
    totalPages: items.length > 0 ? 1 : 0,
  };
}

const defaultPropertyOptions = [
  { id: 101, name: "خانه کاشان" },
  { id: 102, name: "اقامتگاه یزد" },
];

function mockApiRequests({
  directory = () => Promise.resolve(directoryResponse([member()])),
  properties = () => Promise.resolve(propertyOptionsResponse(defaultPropertyOptions)),
}: {
  directory?: (path: string) => Promise<unknown>;
  properties?: (path: string) => Promise<unknown>;
} = {}) {
  ownerApi.apiRequest.mockImplementation((path: string) =>
    path.startsWith("/admin/property-members/properties?")
      ? properties(path)
      : directory(path),
  );
}

function directoryRequests() {
  return ownerApi.apiRequest.mock.calls.filter(([path]) =>
    String(path).startsWith("/admin/property-members?"),
  );
}

function propertyOptionRequests() {
  return ownerApi.apiRequest.mock.calls.filter(([path]) =>
    String(path).startsWith("/admin/property-members/properties?"),
  );
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
  mockApiRequests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Admin property members global directory", () => {
  it("loads the first User page and renders one row with aggregated membership data", async () => {
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

  it("expands and collapses all membership details with accessible button state", async () => {
    mockApiRequests({
      directory: () => Promise.resolve(directoryResponse([
        member({
          memberships: [
            {
              propertyId: 101,
              propertyName: "خانه کاشان",
              role: "PropertyOwner",
              status: "Active",
              isActive: true,
              isOwner: true,
            },
            {
              propertyId: 102,
              propertyName: "اقامتگاه یزد",
              role: "Reception",
              status: "Suspended",
              isActive: false,
              isOwner: false,
            },
          ],
        }),
      ])),
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();

    const toggle = screen.getByRole("button", { name: /سارا محمدی/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(
      "property-member-details-20",
    );

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const details = screen.getByRole("region", {
      name: "عضویت‌های سارا محمدی",
    });
    const detailQueries = within(details);
    expect(detailQueries.getByText("خانه کاشان")).toBeTruthy();
    expect(detailQueries.getByText("اقامتگاه یزد")).toBeTruthy();
    expect(detailQueries.getByText("مالک اقامتگاه")).toBeTruthy();
    expect(detailQueries.getByText("پذیرش")).toBeTruthy();
    expect(detailQueries.getByText("مالک اصلی")).toBeTruthy();
    expect(detailQueries.getByText("تعلیق‌شده")).toBeTruthy();
    expect(detailQueries.getByText("غیرفعال")).toBeTruthy();
    expect(within(toggle.closest("tr")!).getByText("غیرفعال")).toBeTruthy();
    expect(directoryRequests()).toHaveLength(1);

    fireEvent.click(detailQueries.getAllByRole("button", { name: "مدیریت" })[0]);
    expect(navigation.push).toHaveBeenCalledWith(
      "/admin/properties/101/users",
    );
    expect(directoryRequests()).toHaveLength(1);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("region", { name: "عضویت‌های سارا محمدی" }),
    ).toBeNull();
  });

  it("allows multiple User rows to remain expanded", async () => {
    mockApiRequests({
      directory: () => Promise.resolve(directoryResponse([
        member(),
        member({
          id: 21,
          firstName: "علی",
          lastName: "رضایی",
          email: "ali@example.test",
        }),
      ])),
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();

    fireEvent.click(screen.getByRole("button", { name: /سارا محمدی/ }));
    fireEvent.click(screen.getByRole("button", { name: /علی رضایی/ }));

    expect(
      screen.getByRole("region", { name: "عضویت‌های سارا محمدی" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "عضویت‌های علی رضایی" }),
    ).toBeTruthy();
    expect(directoryRequests()).toHaveLength(1);
  });

  it("debounces server search and resets pagination to page one", async () => {
    mockApiRequests({
      directory: (path) => {
        const params = new URLSearchParams(path.split("?")[1]);
        const requestedPage = Number(params.get("page"));
        return Promise.resolve(
          directoryResponse([member()], {
            page: requestedPage,
            totalCount: 40,
            totalPages: 2,
          }),
        );
      },
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await flushRequests();
    expect(directoryRequests().at(-1)?.[0]).toBe(
      "/admin/property-members?page=2&pageSize=20",
    );

    fireEvent.change(
      screen.getByPlaceholderText("نام، شماره تماس یا ایمیل..."),
      { target: { value: "  سارا  " } },
    );
    expect(directoryRequests()).toHaveLength(2);

    await runSearchDebounce();

    expect(directoryRequests().at(-1)?.[0]).toBe(
      "/admin/property-members?page=1&pageSize=20&search=%D8%B3%D8%A7%D8%B1%D8%A7",
    );
  });

  it("requests the selected server page and renders returned metadata", async () => {
    mockApiRequests({
      directory: (path) => {
        const requestedPage = path.includes("page=2") ? 2 : 1;
        return Promise.resolve(
          directoryResponse([member({ id: requestedPage })], {
            page: requestedPage,
            totalCount: 41,
            totalPages: 3,
          }),
        );
      },
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    expect(screen.getByText("صفحه ۱ از ۳")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await flushRequests();

    expect(directoryRequests().at(-1)?.[0]).toBe(
      "/admin/property-members?page=2&pageSize=20",
    );
    expect(screen.getByText("صفحه ۲ از ۳")).toBeTruthy();
  });

  it("loads Property options from the directory-scoped endpoint and searches server-side", async () => {
    render(<AdminPropertyMembersPage />);
    await flushRequests();

    expect(propertyOptionRequests().at(0)?.[0]).toBe(
      "/admin/property-members/properties?page=1&pageSize=10",
    );
    expect(
      ownerApi.apiRequest.mock.calls.some(([path]) =>
        String(path).includes("/admin/properties/search"),
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    fireEvent.change(screen.getByPlaceholderText("جستجوی اقامتگاه..."), {
      target: { value: "  کاشان  " },
    });
    await runSearchDebounce();

    expect(propertyOptionRequests().at(-1)?.[0]).toBe(
      "/admin/property-members/properties?page=1&pageSize=10&search=%DA%A9%D8%A7%D8%B4%D8%A7%D9%86",
    );
  });

  it("keeps the newest Property lookup response when requests resolve out of order", async () => {
    const older = deferred<ReturnType<typeof propertyOptionsResponse>>();
    const newer = deferred<ReturnType<typeof propertyOptionsResponse>>();
    mockApiRequests({
      properties: (path) => {
        const search = new URLSearchParams(path.split("?")[1]).get("search");
        if (search === "خانه") return older.promise;
        if (search === "یزد") return newer.promise;
        return Promise.resolve(propertyOptionsResponse(defaultPropertyOptions));
      },
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    const propertySearch = screen.getByPlaceholderText("جستجوی اقامتگاه...");

    fireEvent.change(propertySearch, { target: { value: "خانه" } });
    await runSearchDebounce();
    fireEvent.change(propertySearch, { target: { value: "یزد" } });
    await runSearchDebounce();

    await act(async () => {
      newer.resolve(propertyOptionsResponse([{ id: 102, name: "اقامتگاه یزد" }]));
      await newer.promise;
    });
    await act(async () => {
      older.resolve(propertyOptionsResponse([{ id: 101, name: "خانه کاشان" }]));
      await older.promise;
    });
    fireEvent.change(propertySearch, { target: { value: "" } });

    expect(screen.getByRole("button", { name: "اقامتگاه یزد" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "خانه کاشان" })).toBeNull();
  });

  it("serializes combined search and membership filters with backend enum values", async () => {
    mockApiRequests({
      directory: (path) => {
        const requestedPage = Number(
          new URLSearchParams(path.split("?")[1]).get("page"),
        );
        return Promise.resolve(
          directoryResponse([member()], {
            page: requestedPage,
            totalCount: 40,
            totalPages: 2,
          }),
        );
      },
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.change(
      screen.getByPlaceholderText("نام، شماره تماس یا ایمیل..."),
      { target: { value: "سارا" } },
    );
    await runSearchDebounce();

    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    fireEvent.click(screen.getByRole("button", { name: "خانه کاشان" }));
    await flushRequests();
    fireEvent.change(screen.getByLabelText("نقش"), {
      target: { value: "Reception" },
    });
    await flushRequests();
    fireEvent.change(screen.getByLabelText("وضعیت عضویت"), {
      target: { value: "Suspended" },
    });
    await flushRequests();

    let params = new URLSearchParams(
      String(directoryRequests().at(-1)?.[0]).split("?")[1],
    );
    expect(params.get("page")).toBe("1");
    expect(params.get("search")).toBe("سارا");
    expect(params.get("propertyId")).toBe("101");
    expect(params.get("role")).toBe("Reception");
    expect(params.get("status")).toBe("Suspended");

    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await flushRequests();
    params = new URLSearchParams(
      String(directoryRequests().at(-1)?.[0]).split("?")[1],
    );
    expect(params.get("page")).toBe("2");
    expect(params.get("search")).toBe("سارا");
    expect(params.get("propertyId")).toBe("101");
    expect(params.get("role")).toBe("Reception");
    expect(params.get("status")).toBe("Suspended");
  });

  it("resets each membership filter to page one and clears filters without clearing search", async () => {
    mockApiRequests({
      directory: (path) => {
        const requestedPage = Number(
          new URLSearchParams(path.split("?")[1]).get("page"),
        );
        return Promise.resolve(
          directoryResponse([member()], {
            page: requestedPage,
            totalCount: 40,
            totalPages: 2,
          }),
        );
      },
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.change(
      screen.getByPlaceholderText("نام، شماره تماس یا ایمیل..."),
      { target: { value: "سارا" } },
    );
    await runSearchDebounce();
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await flushRequests();

    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    fireEvent.click(screen.getByRole("button", { name: "خانه کاشان" }));
    await flushRequests();
    expect(
      new URLSearchParams(
        String(directoryRequests().at(-1)?.[0]).split("?")[1],
      ).get("page"),
    ).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await flushRequests();
    fireEvent.change(screen.getByLabelText("نقش"), {
      target: { value: "Manager" },
    });
    await flushRequests();
    expect(
      new URLSearchParams(
        String(directoryRequests().at(-1)?.[0]).split("?")[1],
      ).get("page"),
    ).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await flushRequests();
    fireEvent.change(screen.getByLabelText("وضعیت عضویت"), {
      target: { value: "Active" },
    });
    await flushRequests();
    expect(
      new URLSearchParams(
        String(directoryRequests().at(-1)?.[0]).split("?")[1],
      ).get("page"),
    ).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "پاک کردن فیلترها" }));
    await flushRequests();
    const cleared = new URLSearchParams(
      String(directoryRequests().at(-1)?.[0]).split("?")[1],
    );
    expect(cleared.get("search")).toBe("سارا");
    expect(cleared.has("propertyId")).toBe(false);
    expect(cleared.has("role")).toBe(false);
    expect(cleared.has("status")).toBe(false);
  });

  it("does not filter expanded memberships again on the client", async () => {
    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    fireEvent.click(screen.getByRole("button", { name: "خانه کاشان" }));
    await flushRequests();
    fireEvent.click(screen.getByRole("button", { name: /سارا محمدی/ }));

    const details = screen.getByRole("region", {
      name: "عضویت‌های سارا محمدی",
    });
    expect(within(details).getByText("خانه کاشان")).toBeTruthy();
    expect(within(details).getByText("اقامتگاه یزد")).toBeTruthy();
    expect(within(details).getByText("خانه شیراز")).toBeTruthy();
  });

  it("shows loading and then the empty state", async () => {
    const request = deferred<ReturnType<typeof directoryResponse>>();
    mockApiRequests({ directory: () => request.promise });

    render(<AdminPropertyMembersPage />);

    expect(screen.getByText("در حال بارگذاری اعضا...")).toBeTruthy();

    await act(async () => {
      request.resolve(directoryResponse([]));
      await request.promise;
    });

    expect(screen.getByText("هنوز عضوی برای نمایش وجود ندارد.")).toBeTruthy();
  });

  it("shows a search-specific empty state", async () => {
    mockApiRequests({
      directory: () => Promise.resolve(directoryResponse([])),
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.change(
      screen.getByPlaceholderText("نام، شماره تماس یا ایمیل..."),
      { target: { value: "ناشناخته" } },
    );
    await runSearchDebounce();

    expect(
      screen.getByText("کاربری مطابق جستجو یا فیلترها پیدا نشد."),
    ).toBeTruthy();
  });

  it("shows the existing alert treatment when loading fails", async () => {
    const request = deferred<ReturnType<typeof directoryResponse>>();
    mockApiRequests({ directory: () => request.promise });

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
