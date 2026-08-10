import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerApi = vi.hoisted(() => ({ request: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("sonner", () => ({ toast: notifications }));

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({
    authenticated: true,
    loading: false,
    workspaces: ["admin"],
  }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/SharedUploader", () => ({
  SharedUploader: () => null,
}));
vi.mock("@/lib/owner-api", () => ({
  apiRequest: ownerApi.request,
  getToken: () => null,
}));

import AdminSiteSettingsPage from "@/app/admin/site-settings/page";

describe("reservation deadline settings", () => {
  beforeEach(() => {
    ownerApi.request.mockReset();
    notifications.error.mockReset();
    notifications.success.mockReset();
    ownerApi.request.mockResolvedValue([
      setting(
        1,
        "reservation.paymentWindowMinutes",
        "مهلت پرداخت رزرو",
        "مدت پرداخت پس از تأیید رزرو، بر حسب دقیقه.",
      ),
      setting(
        2,
        "reservation.ownerApprovalWindowMinutes",
        "مهلت پاسخ مالک به رزرو استعلامی",
        "اگر اقامتگاه تا پایان این زمان درخواست رزرو را تأیید یا رد نکند، درخواست به‌صورت خودکار رد می‌شود.",
      ),
      setting(
        3,
        "reservation.ownerApprovalReminderIntervalMinutes",
        "فاصله یادآوری رزروهای در انتظار تأیید",
        "تا زمانی که رزرو استعلامی بدون پاسخ مانده است، افراد مسئول می‌توانند با این فاصله زمانی یادآوری دریافت کنند.",
        "3",
      ),
    ]);
  });

  it("shows all editable reservation timing settings in minutes", async () => {
    render(<AdminSiteSettingsPage />);

    expect(await screen.findByText("مهلت پرداخت رزرو")).toBeTruthy();
    expect(screen.getByText("مهلت پاسخ مالک به رزرو استعلامی")).toBeTruthy();
    expect(screen.getByText("فاصله یادآوری رزروهای در انتظار تأیید")).toBeTruthy();
    expect(screen.getAllByText("دقیقه")).toHaveLength(3);
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(3);
    expect(inputs.every((input) => input.getAttribute("min") === "1")).toBe(true);
    expect(inputs.every((input) => input.getAttribute("max") === "10080")).toBe(true);
    expect((inputs[2] as HTMLInputElement).value).toBe("3");
  });

  it("rejects a reminder interval outside the supported range before saving", async () => {
    render(<AdminSiteSettingsPage />);

    const inputs = await screen.findAllByRole("spinbutton");
    fireEvent.change(inputs[2], { target: { value: "0" } });
    fireEvent.click(screen.getAllByRole("button", { name: "ذخیره" })[2]);

    expect(notifications.error).toHaveBeenCalledWith(
      "مهلت رزرو باید یک عدد صحیح بین ۱ دقیقه و ۷ روز باشد",
    );
    expect(
      ownerApi.request.mock.calls.filter(([, options]) => options?.method === "PUT"),
    ).toHaveLength(0);
  });
});

function setting(
  id: number,
  key: string,
  label: string,
  description: string,
  value = "10",
) {
  return {
    id,
    key,
    value,
    type: "Number",
    group: "Reservation",
    label,
    description,
    sortOrder: id,
    isActive: true,
    createdAtUtc: "2026-08-07T00:00:00Z",
    updatedAtUtc: null,
  };
}
