import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => ({ request: vi.fn(), setToken: vi.fn() }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ refreshSession: vi.fn() }),
  resolveSessionDestination: () => "/account",
}));
vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: authApi.request, setToken: authApi.setToken };
});

import { AuthPage } from "@/components/auth/AuthPage";

function openRegistration() {
  render(<AuthPage />);
  fireEvent.click(screen.getByRole("button", { name: "ثبت‌نام" }));
}

function fillRegistration(nationalCode: string) {
  fireEvent.change(screen.getByLabelText(/^نام\s*\*/), { target: { value: "مینا" } });
  fireEvent.change(screen.getByLabelText(/نام خانوادگی/), { target: { value: "کریمی" } });
  fireEvent.change(screen.getByLabelText(/شماره موبایل/), { target: { value: "09121234567" } });
  fireEvent.change(screen.getByLabelText(/کد ملی/), { target: { value: nationalCode } });
  fireEvent.change(screen.getByLabelText(/^رمز عبور/), { target: { value: "password1" } });
  fireEvent.change(screen.getByLabelText(/تکرار رمز عبور/), { target: { value: "password1" } });
}

function submitRegistration() {
  fireEvent.click(screen.getByText("ثبت‌نام", { selector: "button[type=submit]" }));
}

describe("AuthPage registration NationalId", () => {
  beforeEach(() => {
    authApi.request.mockReset();
    authApi.setToken.mockReset();
    navigation.push.mockReset();
  });

  it("keeps NationalId out of password and OTP login", async () => {
    authApi.request.mockResolvedValueOnce({ sent: true, expiresAtUtc: "2026-10-26T10:00:00Z" });
    render(<AuthPage />);
    expect(screen.queryByLabelText(/کد ملی/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "پیامک" }));
    expect(screen.queryByLabelText(/کد ملی/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/شماره موبایل/), { target: { value: "09121234567" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال رمز یکبار مصرف" }));
    await waitFor(() => expect(authApi.request).toHaveBeenCalledTimes(1));
    expect(JSON.parse((authApi.request.mock.calls[0][1] as RequestInit).body as string)).not.toHaveProperty("nationalCode");
  });

  it("sends the normalized backend nationalCode only for new registration", async () => {
    authApi.request.mockResolvedValueOnce({ sent: true, expiresAtUtc: "2026-10-26T10:00:00Z" });
    openRegistration();
    fillRegistration("۱۲۳۴۵۶۷۸۹۱");
    submitRegistration();

    await waitFor(() => expect(authApi.request).toHaveBeenCalledTimes(1));
    expect(authApi.request.mock.calls[0][0]).toBe("/auth/register");
    expect(JSON.parse((authApi.request.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      nationalCode: "1234567891",
      mobile: "09121234567",
    });
  });

  it("blocks an invalid checksum with an associated field error", () => {
    openRegistration();
    fillRegistration("1234567890");
    submitRegistration();

    const input = screen.getByLabelText(/کد ملی/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("کد ملی معتبر نیست.")).toBeTruthy();
    expect(authApi.request).not.toHaveBeenCalled();
  });
});
