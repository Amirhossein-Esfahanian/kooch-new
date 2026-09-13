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
  canActivate: boolean;
  canSuspend: boolean;
  canDeactivate: boolean;
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
  updateIdentity = (_path, options) => {
    const payload = JSON.parse(String(options?.body));
    return Promise.resolve({ id: 20, ...payload });
  },
  updateMembership = () => Promise.resolve({}),
}: {
  directory?: (path: string) => Promise<unknown>;
  properties?: (path: string) => Promise<unknown>;
  updateIdentity?: (path: string, options?: RequestInit) => Promise<unknown>;
  updateMembership?: (path: string, options?: RequestInit) => Promise<unknown>;
} = {}) {
  ownerApi.apiRequest.mockImplementation(
    (path: string, options?: RequestInit) => {
      if (path.startsWith("/admin/property-members/properties?")) {
        return properties(path);
      }
      if (
        options?.method === "PUT" &&
        /\/(activate|suspend|deactivate)$/.test(path)
      ) {
        return updateMembership(path, options);
      }
      if (options?.method === "PUT") return updateIdentity(path, options);
      return directory(path);
    },
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

function identityUpdateRequests() {
  return ownerApi.apiRequest.mock.calls.filter(
    ([path, options]) =>
      String(path).startsWith("/admin/property-members/") &&
      options?.method === "PUT",
  );
}

function membershipUpdateRequests() {
  return ownerApi.apiRequest.mock.calls.filter(
    ([path, options]) =>
      /\/admin\/properties\/\d+\/users\/\d+\/(activate|suspend|deactivate)$/.test(
        String(path),
      ) && options?.method === "PUT",
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
        canActivate: false,
        canSuspend: true,
        canDeactivate: true,
      },
      {
        propertyId: 102,
        propertyName: "اقامتگاه یزد",
        role: "Reception",
        status: "Suspended",
        isActive: false,
        isOwner: false,
        canActivate: true,
        canSuspend: false,
        canDeactivate: true,
      },
      {
        propertyId: 103,
        propertyName: "خانه شیراز",
        role: "Manager",
        status: "Active",
        isActive: true,
        isOwner: false,
        canActivate: false,
        canSuspend: false,
        canDeactivate: false,
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

async function openIdentityEdit() {
  fireEvent.click(screen.getByRole("button", { name: "ویرایش" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  return screen.getByRole("dialog", {
    name: "ویرایش اطلاعات کاربر",
  });
}

function identityInput(
  field: "first-name" | "last-name" | "mobile" | "email",
) {
  return document.getElementById(
    `property-member-identity-${field}`,
  ) as HTMLInputElement;
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
              canActivate: false,
              canSuspend: false,
              canDeactivate: false,
            },
            {
              propertyId: 102,
              propertyName: "اقامتگاه یزد",
              role: "Reception",
              status: "Suspended",
              isActive: false,
              isOwner: false,
              canActivate: true,
              canSuspend: false,
              canDeactivate: true,
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
    expect(toggle.textContent).toContain("⌄");
    expect(toggle.textContent).not.toContain("+");
    expect(toggle.textContent).not.toContain("−");
    const parentOperations = within(toggle.closest("tr")!.cells[5]);
    expect(
      parentOperations.getByRole("button", { name: "ویرایش" }),
    ).toBeTruthy();
    expect(
      parentOperations.queryByRole("button", { name: "مشاهده جزئیات" }),
    ).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toContain("⌃");
    expect(
      parentOperations.queryByRole("button", { name: "بستن جزئیات" }),
    ).toBeNull();
    const details = screen.getByRole("region", {
      name: "عضویت‌های سارا محمدی",
    });
    const detailQueries = within(details);
    const detailHeader = details.querySelector('[aria-hidden="true"]');
    expect(detailHeader?.children).toHaveLength(4);
    expect(detailQueries.getByText("اقامتگاه")).toBeTruthy();
    expect(detailQueries.getByText("نقش")).toBeTruthy();
    expect(detailQueries.getByText("وضعیت عضویت")).toBeTruthy();
    expect(detailQueries.getByText("عملیات")).toBeTruthy();
    expect(detailQueries.queryByText("فعال بودن عضویت")).toBeNull();
    expect(detailQueries.getByText("خانه کاشان")).toBeTruthy();
    expect(detailQueries.getByText("اقامتگاه یزد")).toBeTruthy();
    expect(detailQueries.getByText("مالک اقامتگاه")).toBeTruthy();
    expect(detailQueries.getByText("پذیرش")).toBeTruthy();
    expect(detailQueries.getByText("مالک اصلی")).toBeTruthy();
    expect(detailQueries.getByText("تعلیق‌شده")).toBeTruthy();
    expect(detailQueries.queryByText("غیرفعال")).toBeNull();
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

  it("renders only backend-provided membership status capabilities", async () => {
    mockApiRequests({
      directory: () =>
        Promise.resolve(
          directoryResponse([
            member({
              memberships: [
                {
                  propertyId: 101,
                  propertyName: "خانه کاشان",
                  role: "Manager",
                  status: "Pending",
                  isActive: true,
                  isOwner: false,
                  canActivate: true,
                  canSuspend: false,
                  canDeactivate: true,
                },
                {
                  propertyId: 102,
                  propertyName: "اقامتگاه یزد",
                  role: "Reception",
                  status: "Active",
                  isActive: true,
                  isOwner: false,
                  canActivate: false,
                  canSuspend: true,
                  canDeactivate: false,
                },
                {
                  propertyId: 103,
                  propertyName: "خانه شیراز",
                  role: "PropertyOwner",
                  status: "Active",
                  isActive: true,
                  isOwner: true,
                  canActivate: false,
                  canSuspend: false,
                  canDeactivate: false,
                },
              ],
            }),
          ]),
        ),
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.click(screen.getByRole("button", { name: /سارا محمدی/ }));

    const details = screen.getByRole("region", {
      name: "عضویت‌های سارا محمدی",
    });
    const memberships = within(details).getAllByRole("listitem");

    expect(
      within(memberships[0]).getAllByRole("button").map((item) => item.textContent),
    ).toEqual(["فعال‌سازی", "غیرفعال‌سازی", "مدیریت"]);
    expect(
      within(memberships[1]).getAllByRole("button").map((item) => item.textContent),
    ).toEqual(["تعلیق", "مدیریت"]);
    expect(within(memberships[2]).getByText("مالک اصلی")).toBeTruthy();
    expect(
      within(memberships[2]).getAllByRole("button").map((item) => item.textContent),
    ).toEqual(["مدیریت"]);
  });

  it.each([
    ["activate", "فعال‌سازی", 102],
    ["suspend", "تعلیق", 101],
  ] as const)(
    "calls the existing %s endpoint once and refreshes the current directory state",
    async (action, label, targetPropertyId) => {
      const mutation = deferred<unknown>();
      let mutationCompleted = false;
      mockApiRequests({
        directory: (path) => {
          const requestedPage = Number(
            new URLSearchParams(path.split("?")[1]).get("page"),
          );
          const current = member({
            memberships: [
              {
                propertyId: targetPropertyId,
                propertyName:
                  targetPropertyId === 101 ? "خانه کاشان" : "اقامتگاه یزد",
                role: "Manager",
                status: mutationCompleted ? "Active" : "Suspended",
                isActive: mutationCompleted,
                isOwner: false,
                canActivate: !mutationCompleted && action === "activate",
                canSuspend: mutationCompleted || action === "suspend",
                canDeactivate: false,
              },
            ],
          });
          return Promise.resolve(
            directoryResponse([current], {
              page: requestedPage,
              totalCount: 40,
              totalPages: 2,
            }),
          );
        },
        updateMembership: () => mutation.promise,
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
        target: { value: "Manager" },
      });
      await flushRequests();
      fireEvent.change(screen.getByLabelText("وضعیت عضویت"), {
        target: { value: "Suspended" },
      });
      await flushRequests();
      fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
      await flushRequests();
      fireEvent.click(screen.getByRole("button", { name: /سارا محمدی/ }));

      const actionButton = screen.getByRole("button", { name: label });
      fireEvent.click(actionButton);
      fireEvent.click(actionButton);
      expect(membershipUpdateRequests()).toHaveLength(1);
      expect(membershipUpdateRequests()[0]).toEqual([
        `/admin/properties/${targetPropertyId}/users/20/${action}`,
        { method: "PUT" },
      ]);

      const requestBeforeRefresh = directoryRequests().at(-1)?.[0];
      mutationCompleted = true;
      await act(async () => {
        mutation.resolve({});
        await mutation.promise;
      });
      await flushRequests();

      expect(directoryRequests().at(-1)?.[0]).toBe(requestBeforeRefresh);
      expect(directoryRequests().length).toBeGreaterThan(3);
      expect(
        screen.getByRole("region", { name: "عضویت‌های سارا محمدی" }),
      ).toBeTruthy();
      expect(screen.getByPlaceholderText("نام، شماره تماس یا ایمیل...")).toHaveProperty(
        "value",
        "سارا",
      );
      expect(screen.getByLabelText("نقش")).toHaveProperty("value", "Manager");
      expect(
        screen.getByRole("button", { name: "اقامتگاه" }).textContent,
      ).toContain("خانه کاشان");
      expect(screen.getByLabelText("وضعیت عضویت")).toHaveProperty(
        "value",
        "Suspended",
      );
      expect(screen.getByText("صفحه ۲ از ۲")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "فعال‌سازی" })).toBeNull();
      expect(screen.getByRole("button", { name: "تعلیق" })).toBeTruthy();
    },
  );

  it("confirms membership deactivation before calling its existing endpoint", async () => {
    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.click(screen.getByRole("button", { name: /سارا محمدی/ }));

    const details = screen.getByRole("region", {
      name: "عضویت‌های سارا محمدی",
    });
    const firstMembership = within(details).getAllByRole("listitem")[0];
    fireEvent.click(
      within(firstMembership).getByRole("button", { name: "غیرفعال‌سازی" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(membershipUpdateRequests()).toHaveLength(0);
    const confirmation = screen.getByRole("alertdialog", {
      name: "غیرفعال‌سازی عضویت",
    });
    expect(
      within(confirmation).getByText(
        "غیرفعال‌سازی فقط عضویت این کاربر در همین اقامتگاه را غیرفعال می‌کند و حساب اصلی کاربر در Kooch غیرفعال نمی‌شود.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "غیرفعال‌سازی عضویت",
      }),
    );
    await flushRequests();

    expect(membershipUpdateRequests()).toHaveLength(1);
    expect(membershipUpdateRequests()[0]).toEqual([
      "/admin/properties/101/users/20/deactivate",
      { method: "PUT" },
    ]);
  });

  it("keeps membership state and expansion unchanged when a status request fails", async () => {
    mockApiRequests({
      updateMembership: () => Promise.reject(new Error("تغییر وضعیت مجاز نیست")),
    });
    render(<AdminPropertyMembersPage />);
    await flushRequests();
    fireEvent.click(screen.getByRole("button", { name: /سارا محمدی/ }));
    const directoryRequestCount = directoryRequests().length;

    fireEvent.click(screen.getByRole("button", { name: "تعلیق" }));
    await flushRequests();

    const details = screen.getByRole("region", {
      name: "عضویت‌های سارا محمدی",
    });
    const unchangedMembership = within(details)
      .getByText("خانه کاشان")
      .closest("li")!;
    expect(within(unchangedMembership).getByText("فعال")).toBeTruthy();
    expect(
      within(unchangedMembership).getByRole("button", { name: "تعلیق" }),
    ).toBeTruthy();
    expect(directoryRequests()).toHaveLength(directoryRequestCount);
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

  it("opens an identity-only edit dialog with canonical mobile behavior", async () => {
    render(<AdminPropertyMembersPage />);
    await flushRequests();

    const dialog = await openIdentityEdit();
    const dialogQueries = within(dialog);
    const firstName = identityInput("first-name");
    const lastName = identityInput("last-name");
    const mobile = identityInput("mobile");
    const email = identityInput("email");

    expect(firstName.value).toBe("سارا");
    expect(lastName.value).toBe("محمدی");
    expect(mobile.value).toBe("09121234567");
    expect(email.value).toBe("sara@example.test");
    expect(dialogQueries.getAllByRole("textbox")).toHaveLength(4);
    expect(mobile.inputMode).toBe("numeric");
    expect(mobile.maxLength).toBe(11);
    expect(dialogQueries.queryByRole("combobox")).toBeNull();
    expect(dialogQueries.queryByLabelText(/password|رمز|نقش|وضعیت|دسترسی/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /فعال‌سازی|غیرفعال‌سازی/ })).toBeNull();

    fireEvent.change(mobile, { target: { value: "۰۹۱۲۳۴۵۶۷۸۹" } });
    expect(mobile.value).toBe("09123456789");
  });

  it("blocks invalid mobile before sending the identity update", async () => {
    render(<AdminPropertyMembersPage />);
    await flushRequests();
    const dialog = await openIdentityEdit();

    fireEvent.change(identityInput("mobile"), {
      target: { value: "0912" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));

    expect(within(dialog).getByText(/۱۱ رقم/)).toBeTruthy();
    expect(identityUpdateRequests()).toHaveLength(0);
  });

  it("updates only canonical identity while preserving directory and expanded state", async () => {
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
      updateIdentity: () =>
        Promise.resolve({
          id: 20,
          firstName: "سارینا",
          lastName: "احمدی",
          phoneNumber: "09123456789",
          email: "updated@example.test",
        }),
    });

    render(<AdminPropertyMembersPage />);
    await flushRequests();
    const searchInput = screen.getByPlaceholderText("نام، شماره تماس یا ایمیل...");
    fireEvent.change(searchInput, { target: { value: "سارا" } });
    await runSearchDebounce();
    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    fireEvent.click(screen.getByRole("button", { name: "خانه کاشان" }));
    await flushRequests();
    fireEvent.change(screen.getByLabelText("نقش"), {
      target: { value: "Manager" },
    });
    await flushRequests();
    fireEvent.change(screen.getByLabelText("وضعیت عضویت"), {
      target: { value: "Active" },
    });
    await flushRequests();
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await flushRequests();
    fireEvent.click(screen.getByRole("button", { name: /سارا محمدی/ }));
    const directoryRequestCountBeforeUpdate = directoryRequests().length;
    const directoryRequestBeforeUpdate = directoryRequests().at(-1)?.[0];

    const dialog = await openIdentityEdit();
    fireEvent.change(identityInput("first-name"), {
      target: { value: "سارینا" },
    });
    fireEvent.change(identityInput("last-name"), {
      target: { value: "احمدی" },
    });
    fireEvent.change(identityInput("mobile"), {
      target: { value: "09123456789" },
    });
    fireEvent.change(identityInput("email"), {
      target: { value: "updated@example.test" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));
    await flushRequests();

    expect(identityUpdateRequests()).toHaveLength(1);
    const [path, options] = identityUpdateRequests()[0];
    expect(path).toBe("/admin/property-members/20");
    expect(JSON.parse(String(options.body))).toEqual({
      firstName: "سارینا",
      lastName: "احمدی",
      phoneNumber: "09123456789",
      email: "updated@example.test",
    });
    expect(directoryRequests()).toHaveLength(directoryRequestCountBeforeUpdate);
    expect(directoryRequests().at(-1)?.[0]).toBe(directoryRequestBeforeUpdate);
    expect(
      screen.queryByRole("dialog", { name: "ویرایش اطلاعات کاربر" }),
    ).toBeNull();
    expect(screen.getByText("سارینا احمدی")).toBeTruthy();
    expect(screen.getByText("updated@example.test")).toBeTruthy();
    expect(screen.getByText("09123456789")).toBeTruthy();
    expect(screen.getByPlaceholderText("نام، شماره تماس یا ایمیل...")).toHaveProperty(
      "value",
      "سارا",
    );
    expect(screen.getByLabelText("نقش")).toHaveProperty("value", "Manager");
    expect(screen.getByLabelText("وضعیت عضویت")).toHaveProperty(
      "value",
      "Active",
    );
    expect(screen.getByText("صفحه ۲ از ۲")).toBeTruthy();
    const details = screen.getByRole("region", {
      name: "عضویت‌های سارینا احمدی",
    });
    expect(within(details).getByText("خانه کاشان")).toBeTruthy();
    expect(within(details).getByText("اقامتگاه یزد")).toBeTruthy();
    expect(within(details).getByText("خانه شیراز")).toBeTruthy();
  });

  it.each([
    ["Phone number already exists.", "این شماره موبایل قبلاً ثبت شده است."],
    ["Duplicate email address.", "این ایمیل قبلاً ثبت شده است."],
  ])("keeps the dialog open for identity conflict: %s", async (message, expected) => {
    const request = deferred<unknown>();
    mockApiRequests({ updateIdentity: () => request.promise });
    render(<AdminPropertyMembersPage />);
    await flushRequests();
    const dialog = await openIdentityEdit();
    const form = document.getElementById("property-member-identity-form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(identityUpdateRequests()).toHaveLength(1);

    await act(async () => {
      request.reject(new Error(message));
      try {
        await request.promise;
      } catch {
        // The dialog renders the canonical API error and remains open.
      }
    });

    const openDialog = screen.getByRole("dialog", {
      name: "ویرایش اطلاعات کاربر",
    });
    expect(within(openDialog).getByText(expected)).toBeTruthy();
    expect(identityInput("first-name")).toHaveProperty(
      "value",
      "سارا",
    );
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
