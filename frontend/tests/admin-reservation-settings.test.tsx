import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerApi = vi.hoisted(() => ({ request: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const authSession = vi.hoisted(() => ({
  authenticated: true,
  loading: false,
  workspaces: ["admin"],
}));

vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => authSession,
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/owner-api", () => ({ apiRequest: ownerApi.request }));

import AdminReservationSettingsPage from "@/app/admin/reservation-settings/page";

const childSettings = {
  freeChildMaxAge: 6,
  halfPriceChildMinAge: 7,
  halfPriceChildMaxAge: 12,
  halfPriceChildRate: 50,
};

const deadlineSettings = {
  paymentWindowMinutes: 10,
  ownerApprovalWindowMinutes: 20,
  ownerApprovalReminderIntervalMinutes: 3,
};

describe("Admin Reservation Settings", () => {
  beforeEach(() => {
    ownerApi.request.mockReset();
    notifications.error.mockReset();
    notifications.success.mockReset();
    ownerApi.request.mockImplementation(
      async (path: string, options?: RequestInit) => {
        if (path === "/admin/reservation-settings/deadlines") {
          return options?.method === "PUT"
            ? JSON.parse(String(options.body))
            : deadlineSettings;
        }

        if (path === "/admin/reservation-settings") {
          return options?.method === "PUT"
            ? JSON.parse(String(options.body))
            : childSettings;
        }

        throw new Error(`Unexpected request: ${path}`);
      },
    );
  });

  it("loads independent child-pricing and deadline sections from their dedicated endpoints", async () => {
    render(<AdminReservationSettingsPage />);

    expect(
      await screen.findByRole("heading", { name: "قوانین قیمت‌گذاری کودک" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "مهلت‌های رزرو" }),
    ).toBeTruthy();
    expect(ownerApi.request).toHaveBeenCalledWith("/admin/reservation-settings");
    expect(ownerApi.request).toHaveBeenCalledWith(
      "/admin/reservation-settings/deadlines",
    );
    expect(input("مهلت پرداخت").value).toBe("10");
    expect(input("مهلت تأیید مالک").value).toBe("20");
    expect(input("فاصله یادآوری تأیید مالک").value).toBe("3");
    expect(screen.getAllByText(/دقیقه/).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("paymentWindowMinutes")).toBeNull();
    expect(screen.queryByText("ownerApprovalWindowMinutes")).toBeNull();
    expect(
      screen.queryByText("ownerApprovalReminderIntervalMinutes"),
    ).toBeNull();
  });

  it("keeps child-pricing and deadline drafts independent", async () => {
    render(<AdminReservationSettingsPage />);
    await screen.findByRole("heading", { name: "مهلت‌های رزرو" });

    fireEvent.change(input("مهلت پرداخت"), { target: { value: "45" } });
    fireEvent.change(input("حداکثر سن کودک رایگان"), {
      target: { value: "5" },
    });

    expect(input("مهلت پرداخت").value).toBe("45");
    expect(input("حداکثر سن کودک رایگان").value).toBe("5");

    submit("ذخیره مهلت‌ها");
    await waitFor(() => expect(deadlinePutCalls()).toHaveLength(1));

    expect(JSON.parse(String(deadlinePutCalls()[0][1]?.body))).toEqual({
      paymentWindowMinutes: 45,
      ownerApprovalWindowMinutes: 20,
      ownerApprovalReminderIntervalMinutes: 3,
    });
    expect(childPutCalls()).toHaveLength(0);
    expect(input("حداکثر سن کودک رایگان").value).toBe("5");
  });

  it("saves all deadlines in one request and syncs the returned current values", async () => {
    ownerApi.request.mockImplementation(
      async (path: string, options?: RequestInit) => {
        if (path === "/admin/reservation-settings/deadlines") {
          return options?.method === "PUT"
            ? {
                paymentWindowMinutes: 41,
                ownerApprovalWindowMinutes: 91,
                ownerApprovalReminderIntervalMinutes: 16,
              }
            : deadlineSettings;
        }
        return childSettings;
      },
    );
    render(<AdminReservationSettingsPage />);
    await screen.findByRole("heading", { name: "مهلت‌های رزرو" });

    fireEvent.change(input("مهلت پرداخت"), { target: { value: "40" } });
    fireEvent.change(input("مهلت تأیید مالک"), { target: { value: "90" } });
    fireEvent.change(input("فاصله یادآوری تأیید مالک"), {
      target: { value: "15" },
    });
    submit("ذخیره مهلت‌ها");

    await waitFor(() => expect(input("مهلت پرداخت").value).toBe("41"));
    expect(input("مهلت تأیید مالک").value).toBe("91");
    expect(input("فاصله یادآوری تأیید مالک").value).toBe("16");
    expect(deadlinePutCalls()).toHaveLength(1);
    expect(notifications.success).toHaveBeenCalledWith(
      "مهلت‌های رزرو ذخیره شد",
    );
  });

  it.each([
    ["0", "مقدار باید یک عدد صحیح بین ۱ تا ۱۰۰۸۰ دقیقه باشد"],
    ["10081", "مقدار باید یک عدد صحیح بین ۱ تا ۱۰۰۸۰ دقیقه باشد"],
    ["1.5", "مقدار باید یک عدد صحیح بین ۱ تا ۱۰۰۸۰ دقیقه باشد"],
    ["", "این مقدار الزامی است"],
  ])("rejects invalid deadline value %p near the field", async (value, message) => {
    render(<AdminReservationSettingsPage />);
    await screen.findByRole("heading", { name: "مهلت‌های رزرو" });

    fireEvent.change(input("مهلت پرداخت"), { target: { value } });
    submit("ذخیره مهلت‌ها");

    expect(await screen.findByText(message)).toBeTruthy();
    expect(input("مهلت پرداخت").getAttribute("aria-invalid")).toBe("true");
    expect(deadlinePutCalls()).toHaveLength(0);
  });

  it("keeps the deadline draft and section open when the backend save fails", async () => {
    ownerApi.request.mockImplementation(
      async (path: string, options?: RequestInit) => {
        if (
          path === "/admin/reservation-settings/deadlines" &&
          options?.method === "PUT"
        ) {
          throw new Error("مقدار مهلت معتبر نیست");
        }
        return path === "/admin/reservation-settings/deadlines"
          ? deadlineSettings
          : childSettings;
      },
    );
    render(<AdminReservationSettingsPage />);
    await screen.findByRole("heading", { name: "مهلت‌های رزرو" });

    fireEvent.change(input("مهلت پرداخت"), { target: { value: "40" } });
    submit("ذخیره مهلت‌ها");

    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "مقدار مهلت معتبر نیست",
      ),
    );
    expect(input("مهلت پرداخت").value).toBe("40");
    expect(input("مهلت تأیید مالک").value).toBe("20");
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it("keeps child-pricing save behavior independent and unchanged", async () => {
    render(<AdminReservationSettingsPage />);
    await screen.findByRole("heading", { name: "قوانین قیمت‌گذاری کودک" });

    fireEvent.change(input("درصد کودک نیم‌بها"), {
      target: { value: "45" },
    });
    submit("ذخیره تنظیمات");

    await waitFor(() => expect(childPutCalls()).toHaveLength(1));
    expect(JSON.parse(String(childPutCalls()[0][1]?.body))).toEqual({
      freeChildMaxAge: 6,
      halfPriceChildMinAge: 7,
      halfPriceChildMaxAge: 12,
      halfPriceChildRate: 45,
    });
    expect(deadlinePutCalls()).toHaveLength(0);
    expect(input("مهلت پرداخت").value).toBe("10");
  });

  it("keeps child-pricing usable when deadline loading fails", async () => {
    ownerApi.request.mockImplementation(async (path: string) => {
      if (path === "/admin/reservation-settings/deadlines") {
        throw new Error("مهلت‌ها در دسترس نیست");
      }
      return childSettings;
    });

    render(<AdminReservationSettingsPage />);

    expect(
      await screen.findByRole("heading", { name: "قوانین قیمت‌گذاری کودک" }),
    ).toBeTruthy();
    expect(input("حداکثر سن کودک رایگان").value).toBe("6");
    expect(notifications.error).toHaveBeenCalledWith("مهلت‌ها در دسترس نیست");
  });
});

function input(label: string) {
  return screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;
}

function submit(buttonName: string) {
  const form = screen.getByRole("button", { name: buttonName }).closest("form");
  if (!form) throw new Error(`Form not found for ${buttonName}`);
  fireEvent.submit(form);
}

function deadlinePutCalls() {
  return ownerApi.request.mock.calls.filter(
    ([path, options]) =>
      path === "/admin/reservation-settings/deadlines" &&
      options?.method === "PUT",
  );
}

function childPutCalls() {
  return ownerApi.request.mock.calls.filter(
    ([path, options]) =>
      path === "/admin/reservation-settings" && options?.method === "PUT",
  );
}
