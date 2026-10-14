import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuestManagement } from "@/components/guests/GuestManagement";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.api }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ platformRole: "SuperAdmin", platformPermissions: [] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const foreignGuest = {
  id: 12, userId: 7, firstName: "مهمان", lastName: "نمونه", fullName: "مهمان نمونه",
  mobile: "09120000000", email: null, nationalCode: null, passportNumber: "AB123",
  nationality: "France", birthDate: null, gender: null, address: null, notes: null,
};

beforeEach(() => {
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/admin/guests" && !init) return [foreignGuest];
    if (path === "/admin/guests" && init?.method === "POST") return { ...foreignGuest, ...JSON.parse(String(init.body)) };
    if (path === "/admin/guests/12" && init?.method === "PUT") return { ...foreignGuest, ...JSON.parse(String(init.body)) };
    throw new Error(`Unexpected API: ${path}`);
  });
});

describe("Admin Guest nationality identity", () => {
  it("creates Iranian identity with NationalId only", async () => {
    render(<GuestManagement />);
    fireEvent.click(await screen.findByRole("button", { name: "افزودن مهمان" }));
    const dialog = await screen.findByRole("dialog", { name: "افزودن مهمان" });
    expect(within(dialog).getByRole("combobox", { name: /نوع هویت/ })).toHaveProperty("value", "Iranian");
    expect(within(dialog).queryByRole("textbox", { name: "شماره پاسپورت" })).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^نام\*/ }), { target: { value: "مهمان" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "موبایل" }), { target: { value: "09120000001" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /کد ملی/ }), { target: { value: "۱۲۳۴۵۶۷۸۹۱" } });
    fireEvent.submit(dialog.querySelector("#guest-management-form")!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/admin/guests", expect.objectContaining({ method: "POST" })));
    const payload = JSON.parse(String(mocks.api.mock.calls.find(([path, init]) => path === "/admin/guests" && init?.method === "POST")?.[1].body));
    expect(payload).toMatchObject({ nationality: "ایران", nationalCode: "۱۲۳۴۵۶۷۸۹۱", passportNumber: null });
  });

  it("hydrates foreign identity, switches immediately, and excludes hidden identifier", async () => {
    render(<GuestManagement />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش" }));
    const dialog = await screen.findByRole("dialog", { name: "ویرایش مهمان" });
    expect(within(dialog).getByRole("textbox", { name: /کشور تابعیت/ })).toHaveProperty("value", "France");
    expect(within(dialog).getByRole("textbox", { name: /شماره پاسپورت/ })).toHaveProperty("value", "AB123");
    expect(within(dialog).queryByRole("textbox", { name: "کد ملی" })).toBeNull();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /نوع هویت/ }), { target: { value: "Iranian" } });
    expect(within(dialog).getByRole("textbox", { name: /کد ملی/ })).not.toBeNull();
    expect(within(dialog).queryByRole("textbox", { name: "شماره پاسپورت" })).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /کد ملی/ }), { target: { value: "1234567891" } });
    fireEvent.submit(dialog.querySelector("#guest-management-form")!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/admin/guests/12", expect.objectContaining({ method: "PUT" })));
    const payload = JSON.parse(String(mocks.api.mock.calls.find(([path, init]) => path === "/admin/guests/12" && init?.method === "PUT")?.[1].body));
    expect(payload).toMatchObject({ nationality: "ایران", nationalCode: "1234567891", passportNumber: null });
  });

  it("sends foreign country and passport without a NationalId", async () => {
    render(<GuestManagement />);
    fireEvent.click(await screen.findByRole("button", { name: "افزودن مهمان" }));
    const dialog = await screen.findByRole("dialog", { name: "افزودن مهمان" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: /نوع هویت/ }), { target: { value: "Foreign" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^نام\*/ }), { target: { value: "مهمان" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "موبایل" }), { target: { value: "09120000001" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /کشور تابعیت/ }), { target: { value: "France" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /شماره پاسپورت/ }), { target: { value: " ab 123 " } });
    fireEvent.submit(dialog.querySelector("#guest-management-form")!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/admin/guests", expect.objectContaining({ method: "POST" })));
    const payload = JSON.parse(String(mocks.api.mock.calls.find(([path, init]) => path === "/admin/guests" && init?.method === "POST")?.[1].body));
    expect(payload).toMatchObject({ nationality: "France", passportNumber: "ab 123", nationalCode: null });
  });
});
