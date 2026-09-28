import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
const permissions = vi.hoisted(() => ({ current: { Financial: { view: true } } as Record<string, { view: boolean }> }));
const route = vi.hoisted(() => ({ id: "8" }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: api }));
vi.mock("next/navigation", () => ({ useParams: () => route }));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({
  useOwnerProperty: () => ({ propertyName: "اقامتگاه نمونه", effectivePermissions: permissions.current }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  OwnerLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
import Page from "@/app/owner/properties/[id]/settlements/page";

const paid = {
  settlementNumber: "S-583214", status: "Paid", totalAmount: 246.9, currency: "XYZ",
  itemCount: 2, createdAtUtc: "2026-09-27T12:00:00Z", oldestPayableDueDate: "2026-09-26",
  paidAtUtc: "2026-09-28T12:00:00Z", canViewReceipt: true,
};
const pending = { ...paid, settlementNumber: "S-271946", status: "Pending", canViewReceipt: false, paidAtUtc: null };
const paged = (items: unknown[], page = 1, totalPages = 1) => ({ items, totalCount: 42, page, pageSize: 20, totalPages });

beforeEach(() => {
  route.id = "8";
  permissions.current = { Financial: { view: true } };
  api.mockReset();
  api.mockImplementation(async (path: string) => {
    if (path === "/owner/properties/8/settlements/S-583214") return {
      ...paid, payment: { paymentMethod: "BankTransfer", referenceNumber: "REF-123", paidAtUtc: paid.paidAtUtc },
      items: [{ reservationNumber: "R-100001", payableDueDate: "2026-09-26", amount: 123.45 },
        { reservationNumber: null, payableDueDate: "2026-09-27", amount: 123.45 }],
    };
    return paged([paid, pending]);
  });
});

describe("Owner settlement history", () => {
  it("does not fetch or expose history without financial.view", () => {
    permissions.current = { Financial: { view: false } };
    render(<Page />);
    expect(screen.getByRole("alert").textContent).toContain("دسترسی مشاهده تسویه");
    expect(api).not.toHaveBeenCalled();
  });

  it("renders S references, persisted currency, statuses and only capable receipt links", async () => {
    render(<Page />);
    expect(await screen.findByRole("table", { name: "سوابق تسویه" })).toBeTruthy();
    expect(api).toHaveBeenCalledWith("/owner/properties/8/settlements?page=1&pageSize=20");
    expect(screen.getByText("S-583214")).toBeTruthy();
    expect(screen.getByText("S-271946")).toBeTruthy();
    expect(screen.getAllByText(/XYZ/).length).toBeGreaterThan(0);
    expect(screen.getByText("در انتظار سررسید")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "مشاهده رسید" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/owner/properties/8/settlements/S-583214/receipt");
    expect(screen.queryByRole("button", { name: /ثبت تسویه|لغو تسویه|ایجاد تسویه/ })).toBeNull();
  });

  it("loads property-safe detail from S reference and never reconstructs a missing R snapshot", async () => {
    render(<Page />);
    await screen.findByText("S-583214");
    fireEvent.click(screen.getAllByRole("button", { name: "جزئیات" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "جزئیات تسویه" });
    expect(api).toHaveBeenCalledWith("/owner/properties/8/settlements/S-583214");
    expect(within(dialog).getByText("R-100001")).toBeTruthy();
    expect(within(dialog).getByText("شماره رزرو در سوابق موجود نیست")).toBeTruthy();
    expect(within(dialog).getByText("REF-123")).toBeTruthy();
    expect(within(dialog).queryByText(/یادداشت|لغو تسویه|ثبت تسویه/)).toBeNull();
  });

  it("closes old details when permission or Property scope changes", async () => {
    const view = render(<Page />);
    await screen.findByText("S-583214");
    fireEvent.click(screen.getAllByRole("button", { name: "جزئیات" })[0]);
    expect(await screen.findByRole("dialog", { name: "جزئیات تسویه" })).toBeTruthy();
    permissions.current = { Financial: { view: false } };
    view.rerender(<Page />);
    expect(screen.queryByRole("dialog", { name: "جزئیات تسویه" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("دسترسی مشاهده تسویه");

    permissions.current = { Financial: { view: true } };
    view.rerender(<Page />);
    await screen.findByText("S-583214");
    fireEvent.click(screen.getAllByRole("button", { name: "جزئیات" })[0]);
    expect(await screen.findByRole("dialog", { name: "جزئیات تسویه" })).toBeTruthy();
    route.id = "9";
    view.rerender(<Page />);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/owner/properties/9/settlements?page=1&pageSize=20"));
    expect(screen.queryByRole("dialog", { name: "جزئیات تسویه" })).toBeNull();
  });

  it("applies server-side search, status and sort, then keeps filters during pagination", async () => {
    api.mockImplementation(async (path: string) => paged([paid], Number(new URLSearchParams(path.split("?")[1]).get("page")), 3));
    render(<Page />);
    await screen.findByText("S-583214");
    fireEvent.click(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تسویه‌ها" }));
    const dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی تسویه‌ها" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "شماره تسویه یا رزرو" }), { target: { value: " R-100001 " } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "وضعیت" }), { target: { value: "Paid" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "مرتب‌سازی بر اساس" }), { target: { value: "DueDate" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "ترتیب" }), { target: { value: "Asc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/owner/properties/8/settlements?page=1&pageSize=20&search=R-100001&status=Paid&sortBy=DueDate&sortDirection=Asc"));
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/owner/properties/8/settlements?page=2&pageSize=20&search=R-100001&status=Paid&sortBy=DueDate&sortDirection=Asc"));
  });
});
