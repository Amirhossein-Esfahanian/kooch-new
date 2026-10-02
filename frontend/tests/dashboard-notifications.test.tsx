import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  resolveSessionDestination: () => "/",
  useAuthSession: () => ({
    authenticated: true,
    loading: false,
    platformPermissions: [],
    platformRole: "SuperAdmin",
    workspaces: ["admin"],
  }),
}));
vi.mock("@/components/KoochUserMenu", () => ({
  KoochUserMenu: () => <button type="button">حساب کاربری</button>,
}));

const unread = {
  id: 17,
  eventType: "ReservationCancellationRequested",
  subject: "درخواست لغو جدید",
  message: "درخواست لغو رزرو دریافت شد.",
  createdAtUtc: "2026-10-02T09:00:00Z",
  readAtUtc: null,
  isRead: false,
  reservationNumber: "R-583214",
  propertyId: 4,
};
const read = {
  ...unread,
  id: 18,
  subject: "درخواست بررسی‌شده",
  message: "این اعلان قبلاً خوانده شده است.",
  isRead: true,
  readAtUtc: "2026-10-02T10:00:00Z",
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

function renderShell() {
  render(<AdminLayout><div>محتوای پنل</div></AdminLayout>);
}

function openInbox() {
  fireEvent.click(screen.getByRole("button", { name: /اعلان‌ها/ }));
}

describe("Dashboard notification inbox", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => vi.clearAllMocks());

  it("loads authoritative unread count and first page, without mock content or deep links", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/unread-count")) return response({ unreadCount: 3 });
      if (path.includes("/account/notifications?page=1&pageSize=20")) {
        return response({ items: [{ ...unread, dataJson: "SECRET_METADATA", recipientUserId: 999, internalLink: "/admin/reservations/999" }, read], totalCount: 2, page: 1, pageSize: 20, totalPages: 1 });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderShell();
    await waitFor(() => expect(screen.getByRole("button", { name: /اعلان‌ها، ۳ خوانده‌نشده/ })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    openInbox();
    await screen.findByText("درخواست لغو جدید");
    expect(screen.getByText("درخواست لغو رزرو دریافت شد.")).toBeTruthy();
    expect(screen.getByText("درخواست بررسی‌شده")).toBeTruthy();
    expect(screen.getByRole("button", { name: /علامت‌گذاری اعلان درخواست لغو جدید/ }).className).toContain("theme-primary-soft");
    expect(screen.getByText("درخواست بررسی‌شده").closest("div")?.className).toContain("bg-card");
    expect(screen.getAllByText("R-583214")).toHaveLength(2);
    expect(document.querySelector('time[datetime="2026-10-02T09:00:00Z"]')).toBeTruthy();
    expect(screen.queryByText("نیاز به تایید تصویر")).toBeNull();
    expect(screen.queryByText(/SECRET_METADATA|999/)).toBeNull();
    expect(screen.getByRole("region", { name: "صندوق اعلان‌ها" }).querySelector("a")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/account/notifications?page=1&pageSize=20",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shows no badge at zero and renders loading then empty inbox", async () => {
    let finishList!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith("/unread-count")) return Promise.resolve(response({ unreadCount: 0 }));
      return new Promise<Response>((resolve) => { finishList = resolve; });
    }));
    renderShell();
    await waitFor(() => expect(screen.getByRole("button", { name: "اعلان‌ها" })).toBeTruthy());
    openInbox();
    expect(screen.getByText("در حال دریافت اعلان‌ها...")).toBeTruthy();
    finishList(response({ items: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 0 }));
    await screen.findByText("اعلانی برای نمایش وجود ندارد.");
    expect(screen.getByRole("button", { name: "همه را خوانده‌شده علامت بزن" }).hasAttribute("disabled")).toBe(true);
  });

  it("retries a failed inbox fetch without showing stale mock notifications", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/unread-count")) return response({ unreadCount: 1 });
      attempts += 1;
      return attempts === 1 ? response({ message: "failure" }, 500) : response({ items: [unread], totalCount: 1, page: 1, pageSize: 20, totalPages: 1 });
    }));
    renderShell();
    openInbox();
    await screen.findByText("دریافت اعلان‌ها انجام نشد.");
    expect(screen.queryByText("درخواست لغو جدید")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    await screen.findByText("درخواست لغو جدید");
    expect(attempts).toBe(2);
  });

  it("marks one notification read, then refreshes list and count from the server", async () => {
    let marked = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/17/read")) {
        expect(init?.method).toBe("PUT");
        marked = true;
        return response(null, 204);
      }
      if (path.endsWith("/unread-count")) return response({ unreadCount: marked ? 0 : 1 });
      return response({ items: [marked ? { ...unread, isRead: true, readAtUtc: "2026-10-02T10:00:00Z" } : unread], totalCount: 1, page: 1, pageSize: 20, totalPages: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderShell();
    openInbox();
    fireEvent.click(await screen.findByRole("button", { name: /علامت‌گذاری اعلان درخواست لغو جدید/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "اعلان‌ها" })).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole("button", { name: /علامت‌گذاری اعلان درخواست لغو جدید/ })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/backend/account/notifications/17/read", expect.objectContaining({ method: "PUT" }));
  });

  it("does not optimistically clear a failed mark-read request", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/unread-count")) return response({ unreadCount: 1 });
      if (path.endsWith("/17/read")) return response({ message: "failure" }, 500);
      return response({ items: [unread], totalCount: 1, page: 1, pageSize: 20, totalPages: 1 });
    }));
    renderShell();
    openInbox();
    fireEvent.click(await screen.findByRole("button", { name: /علامت‌گذاری اعلان درخواست لغو جدید/ }));
    await screen.findByText("ثبت وضعیت اعلان انجام نشد. دوباره تلاش کنید.");
    expect(screen.getByRole("button", { name: /اعلان‌ها، ۱ خوانده‌نشده/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /علامت‌گذاری اعلان درخواست لغو جدید/ })).toBeTruthy();
  });

  it("marks all read through the dedicated endpoint and refreshes authoritative state", async () => {
    let marked = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/read-all")) {
        expect(init?.method).toBe("PUT");
        marked = true;
        return response(null, 204);
      }
      if (path.endsWith("/unread-count")) return response({ unreadCount: marked ? 0 : 1 });
      return response({ items: [{ ...unread, isRead: marked, readAtUtc: marked ? "2026-10-02T10:00:00Z" : null }], totalCount: 1, page: 1, pageSize: 20, totalPages: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderShell();
    openInbox();
    fireEvent.click(await screen.findByRole("button", { name: "همه را خوانده‌شده علامت بزن" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "اعلان‌ها" })).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole("button", { name: /علامت‌گذاری اعلان درخواست لغو جدید/ })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/backend/account/notifications/read-all", expect.objectContaining({ method: "PUT" }));
  });

  it("preserves state when mark-all fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/unread-count")) return response({ unreadCount: 1 });
      if (path.endsWith("/read-all")) return response({ message: "failure" }, 500);
      return response({ items: [unread], totalCount: 1, page: 1, pageSize: 20, totalPages: 1 });
    }));
    renderShell();
    openInbox();
    fireEvent.click(await screen.findByRole("button", { name: "همه را خوانده‌شده علامت بزن" }));
    await screen.findByText("ثبت وضعیت اعلان‌ها انجام نشد. دوباره تلاش کنید.");
    expect(screen.getByRole("button", { name: /اعلان‌ها، ۱ خوانده‌نشده/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /علامت‌گذاری اعلان درخواست لغو جدید/ })).toBeTruthy();
  });

  it("refreshes on reopen without polling and leaves the message drawer unchanged", async () => {
    let listCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/unread-count")) return response({ unreadCount: 1 });
      listCalls += 1;
      return response({ items: [unread], totalCount: 1, page: 1, pageSize: 20, totalPages: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "پیام‌ها" }));
    expect(screen.getByText("پیام‌های اخیر")).toBeTruthy();
    expect(listCalls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /اعلان‌ها/ }));
    await screen.findByText("درخواست لغو جدید");
    expect(listCalls).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /اعلان‌ها/ }));
    fireEvent.click(screen.getByRole("button", { name: /اعلان‌ها/ }));
    await waitFor(() => expect(listCalls).toBe(2));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the layout usable when unread-count loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/unread-count")) return response({ message: "failure" }, 500);
      return response({ items: [unread], totalCount: 1, page: 1, pageSize: 20, totalPages: 1 });
    }));
    renderShell();
    openInbox();
    await screen.findByText("درخواست لغو جدید");
    expect(screen.getByText("شمار اعلان‌های خوانده‌نشده در دسترس نیست.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "اعلان‌ها" })).toBeTruthy();
  });
});
