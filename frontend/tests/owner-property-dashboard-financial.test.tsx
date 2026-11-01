import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  propertyStatus: "PendingReview",
  propertyId: "17",
  routePropertyIsValid: true,
  canEditProperties: true,
  canEditPricing: true,
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: mocks.propertyId }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, loading: false, workspaces: ["owner"] }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  OwnerLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({
  useOwnerProperty: () => ({
    routePropertyIsValid: mocks.routePropertyIsValid,
    effectivePermissions: {
      Properties: { edit: mocks.canEditProperties },
      Pricing: { edit: mocks.canEditPricing },
    },
  }),
}));
vi.mock("@/lib/owner-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(),
  apiRequest: (...args: unknown[]) => mocks.apiRequest(...args),
}));

import OwnerPropertyDashboardPage from "@/app/owner/properties/[id]/dashboard/page";
import { ApiRequestError } from "@/lib/owner-api";
import { propertyCompletionHref } from "@/lib/property-completion";

const missingSections = [
  { key: "basic", label: "اطلاعات پایه", actionTarget: "basic", status: "Incomplete", missingItems: ["نام فارسی"] },
  { key: "descriptions", label: "توضیحات اقامتگاه", actionTarget: "descriptions", status: "Incomplete", missingItems: ["توضیحات اقامتگاه"] },
  { key: "images", label: "تصاویر", actionTarget: "images", status: "Incomplete", missingItems: ["حداقل یک تصویر"] },
];

function setup(sections: typeof missingSections = missingSections) {
  mocks.apiRequest.mockImplementation((path: string) => Promise.resolve(
    path.endsWith("/completion") ? { propertyId: Number(mocks.propertyId), canActivate: sections.length === 0, completionPercentage: 67, sections }
      : path.endsWith("/room-types") ? []
      : { id: Number(mocks.propertyId), name: "اقامتگاه", slug: "test-property", status: mocks.propertyStatus },
  ));
}

describe("Owner Property dashboard completion guidance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.propertyStatus = "PendingReview";
    mocks.propertyId = "17";
    mocks.routePropertyIsValid = true;
    mocks.canEditProperties = true;
    mocks.canEditPricing = true;
    setup();
  });

  it("links each actual missing item to its existing edit destination", async () => {
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" });
    expect(within(section).getByRole("link", { name: "نام فارسی" }).getAttribute("href")).toBe("/owner/properties/17?step=0");
    expect(within(section).getByRole("link", { name: "توضیحات اقامتگاه" }).getAttribute("href")).toBe("/owner/properties/17?step=5");
    expect(within(section).getByRole("link", { name: "حداقل یک تصویر" }).getAttribute("href")).toBe("/owner/properties/17?step=4");
  });

  it("hides setup guidance for an approved Property even when completion reports gaps", async () => {
    mocks.propertyStatus = "Approved";
    render(<OwnerPropertyDashboardPage />);
    await screen.findByRole("heading", { name: "اقامتگاه" });
    expect(screen.queryByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" })).toBeNull();
  });

  it("omits an empty checklist", async () => {
    setup([]);
    render(<OwnerPropertyDashboardPage />);
    await screen.findByRole("heading", { name: "اقامتگاه" });
    expect(screen.queryByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" })).toBeNull();
  });

  it("shows missing items without unauthorized edit links", async () => {
    mocks.canEditProperties = false;
    mocks.canEditPricing = false;
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" });
    expect(within(section).getByRole("list").textContent).toContain("حداقل یک تصویر");
    expect(within(section).queryAllByRole("link")).toHaveLength(0);
  });

  it.each(["Draft", "Rejected"])("shows backend gaps, not submission, for incomplete %s", async (status) => {
    mocks.propertyStatus = status;
    render(<OwnerPropertyDashboardPage />);
    expect(await screen.findByRole("link", { name: "نام فارسی" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
  });

  it.each(["Draft", "Rejected"])("offers review submission for complete %s", async (status) => {
    mocks.propertyStatus = status;
    setup([]);
    render(<OwnerPropertyDashboardPage />);
    expect(await screen.findByRole("button", { name: status === "Draft" ? "ارسال برای بررسی مدیر" : "ارسال مجدد برای بررسی" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" })).toBeNull();
  });

  it.each(["Approved", "PendingReview", "Suspended"])("never submits from %s", async (status) => {
    mocks.propertyStatus = status;
    setup([]);
    render(<OwnerPropertyDashboardPage />);
    await screen.findByRole("heading", { name: "اقامتگاه" });
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
    if (status === "PendingReview") expect(screen.getByText("اقامتگاه در انتظار بررسی مدیر است")).toBeTruthy();
    if (status === "Suspended") expect(screen.getByText("اقامتگاه تعلیق شده است")).toBeTruthy();
  });

  it("does not submit a complete Property without property.edit", async () => {
    mocks.propertyStatus = "Draft";
    mocks.canEditProperties = false;
    setup([]);
    render(<OwnerPropertyDashboardPage />);
    await screen.findByRole("heading", { name: "اقامتگاه" });
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
  });

  it("uses the financial Wizard step without making finance an approval requirement", async () => {
    setup([{ key: "financial", label: "مالی", actionTarget: "financial", status: "Incomplete", missingItems: ["تنظیمات مالی"] }]);
    render(<OwnerPropertyDashboardPage />);
    expect((await screen.findByRole("link", { name: "تنظیمات مالی" })).getAttribute("href")).toBe("/owner/properties/17?step=8");
    expect(propertyCompletionHref("admin", 17, { key: "financial", label: "", actionTarget: "financial", status: "Incomplete", missingItems: [] }))
      .toBe("/admin/properties/17?step=8");
  });

  it("submits once, disables duplicate clicks, and refreshes Property and completion without approving", async () => {
    mocks.propertyStatus = "Draft";
    setup([]);
    const reads = mocks.apiRequest.getMockImplementation()!;
    let resolve!: (value: unknown) => void;
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => init?.method === "POST"
      ? new Promise((done) => { resolve = done; }) : reads(path));
    render(<OwnerPropertyDashboardPage />);
    const submit = await screen.findByRole("button", { name: "ارسال برای بررسی مدیر" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("در حال ارسال برای بررسی...")).toBeTruthy();
    expect(mocks.apiRequest.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    mocks.propertyStatus = "PendingReview";
    await act(async () => resolve({ id: 17, name: "اقامتگاه", status: "PendingReview" }));
    expect(await screen.findByText("درخواست بررسی ثبت شد. تأیید نهایی فقط توسط مدیر انجام می‌شود.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
    expect(screen.getByText(/وضعیت: در انتظار بررسی/)).toBeTruthy();
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === "/owner/properties/17/completion")).toHaveLength(2);
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === "/owner/properties/17")).toHaveLength(2);
    expect(mocks.apiRequest).toHaveBeenCalledWith("/owner/properties/17/submit-for-review", expect.objectContaining({ method: "POST" }));
  });

  it("handles 403 without permitting another submission", async () => {
    mocks.propertyStatus = "Draft";
    setup([]);
    const reads = mocks.apiRequest.getMockImplementation()!;
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => init?.method === "POST"
      ? Promise.reject(new ApiRequestError("Forbidden", 403)) : reads(path));
    render(<OwnerPropertyDashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ارسال برای بررسی مدیر" }));
    expect(await screen.findByText("اجازه ارسال این اقامتگاه برای بررسی را ندارید.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
  });

  it("refreshes concurrent completion gaps returned in a 409", async () => {
    mocks.propertyStatus = "Draft";
    setup([]);
    const reads = mocks.apiRequest.getMockImplementation()!;
    let failed = false;
    const completion = { propertyId: 17, canActivate: false, sections: missingSections };
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") { failed = true; return Promise.reject(new ApiRequestError("اطلاعات تغییر کرده است", 409, { completion })); }
      if (failed && path.endsWith("/completion")) return Promise.resolve(completion);
      return reads(path);
    });
    render(<OwnerPropertyDashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ارسال برای بررسی مدیر" }));
    expect(await screen.findByText("اطلاعات تغییر کرده است")).toBeTruthy();
    expect(screen.getByRole("link", { name: "حداقل یک تصویر" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
  });

  it("refreshes stale status after a duplicate-submission conflict", async () => {
    mocks.propertyStatus = "Draft";
    setup([]);
    const reads = mocks.apiRequest.getMockImplementation()!;
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") { mocks.propertyStatus = "PendingReview"; return Promise.reject(new ApiRequestError("قبلاً ارسال شده است", 409)); }
      return reads(path);
    });
    render(<OwnerPropertyDashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ارسال برای بررسی مدیر" }));
    expect(await screen.findByText("قبلاً ارسال شده است")).toBeTruthy();
    expect(screen.getByText("اقامتگاه در انتظار بررسی مدیر است")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
  });

  it("fails closed if status refresh fails and allows an explicit refresh", async () => {
    mocks.propertyStatus = "Draft";
    setup([]);
    const reads = mocks.apiRequest.getMockImplementation()!;
    let failed = false;
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") { failed = true; return Promise.reject(new Error("offline")); }
      return failed ? Promise.reject(new Error("offline")) : reads(path);
    });
    render(<OwnerPropertyDashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ارسال برای بررسی مدیر" }));
    const refresh = await screen.findByRole("button", { name: "به‌روزرسانی وضعیت اقامتگاه" });
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
    setup([]);
    fireEvent.click(refresh);
    expect(await screen.findByRole("button", { name: "ارسال برای بررسی مدیر" })).toBeTruthy();
  });

  it("ignores a submission response after switching Properties", async () => {
    mocks.propertyStatus = "Draft";
    setup([]);
    const reads = mocks.apiRequest.getMockImplementation()!;
    let resolve!: (value: unknown) => void;
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => init?.method === "POST"
      ? new Promise((done) => { resolve = done; }) : reads(path));
    const view = render(<OwnerPropertyDashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ارسال برای بررسی مدیر" }));
    mocks.propertyId = "18";
    view.rerender(<OwnerPropertyDashboardPage />);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/owner/properties/18", expect.anything()));
    await act(async () => resolve({ id: 17, name: "قدیمی", status: "PendingReview" }));
    expect(screen.queryByRole("heading", { name: "قدیمی" })).toBeNull();
    expect(screen.queryByText("اقامتگاه در انتظار بررسی مدیر است")).toBeNull();
    expect(screen.getByRole("button", { name: "ارسال برای بررسی مدیر" })).toBeTruthy();
  });

  it("does not infer approval eligibility from percentage or an empty local checklist", async () => {
    mocks.propertyStatus = "Draft";
    setup([]);
    const reads = mocks.apiRequest.getMockImplementation()!;
    mocks.apiRequest.mockImplementation((path: string) => path.endsWith("/completion")
      ? Promise.resolve({ propertyId: 17, canActivate: false, completionPercentage: 100, sections: [] }) : reads(path));
    render(<OwnerPropertyDashboardPage />);
    await screen.findByRole("heading", { name: "اقامتگاه" });
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
  });

  it("retains server-provided gaps even when conflict refresh is unavailable", async () => {
    mocks.propertyStatus = "Draft";
    setup([]);
    const reads = mocks.apiRequest.getMockImplementation()!;
    let failed = false;
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        failed = true;
        return Promise.reject(new ApiRequestError("تصویر الزامی است", 409, {
          completion: { propertyId: 17, canActivate: false, sections: missingSections },
        }));
      }
      return failed ? Promise.reject(new Error("offline")) : reads(path);
    });
    render(<OwnerPropertyDashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ارسال برای بررسی مدیر" }));
    expect(await screen.findByText("تصویر الزامی است")).toBeTruthy();
    expect(screen.getByRole("link", { name: "حداقل یک تصویر" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "به‌روزرسانی وضعیت اقامتگاه" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
  });

  it("keeps the acknowledged server status if the successful submission refresh fails", async () => {
    mocks.propertyStatus = "Draft";
    setup([]);
    const reads = mocks.apiRequest.getMockImplementation()!;
    let submitted = false;
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        submitted = true;
        return Promise.resolve({ id: 17, name: "اقامتگاه", status: "PendingReview" });
      }
      return submitted ? Promise.reject(new Error("offline")) : reads(path);
    });
    render(<OwnerPropertyDashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ارسال برای بررسی مدیر" }));
    await screen.findByRole("button", { name: "به‌روزرسانی وضعیت اقامتگاه" });
    expect(screen.getByText("اقامتگاه در انتظار بررسی مدیر است")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ارسال.*بررسی/ })).toBeNull();
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === "/owner/properties/17/completion")).toHaveLength(2);
  });

  it("does not fetch or display Property approval data for an unauthorized route", async () => {
    mocks.routePropertyIsValid = false;
    render(<OwnerPropertyDashboardPage />);
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "بررسی و تأیید اقامتگاه" })).toBeNull();
    expect(screen.queryByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" })).toBeNull();
  });
});
