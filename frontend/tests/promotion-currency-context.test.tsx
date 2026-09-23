import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  currencyLabel: "تومان",
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => mocks.currencyLabel };
});

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/components/KoochDatePicker", () => ({
  KoochDatePicker: () => <div data-testid="promotion-date-range" />,
}));

vi.mock("@/components/KoochDialog", () => ({
  KoochDialog: ({
    children,
    footer,
    open,
  }: {
    children: React.ReactNode;
    footer?: React.ReactNode;
    open: boolean;
  }) =>
    open ? (
      <div role="dialog">
        {children}
        {footer}
      </div>
    ) : null,
}));

import { PromotionWorkspace } from "@/components/promotions/PromotionWorkspace";
import { PromotionCards } from "@/components/promotions/PromotionCards";
import type { PromotionResponse } from "@/lib/owner-api";

describe("PromotionWorkspace currency and free-night promotions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currencyLabel = "تومان";
    mocks.apiRequest.mockImplementation(
      (path: string, init?: RequestInit) => {
        if (path === "/admin/properties") return Promise.resolve([]);
        if (path === "/admin/promotions" && init?.method === "POST") {
          return Promise.resolve({ id: 1 });
        }
        if (path === "/admin/promotions") return Promise.resolve([]);
        return Promise.reject(new Error(`Unexpected API request: ${path}`));
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("labels only the fixed discount with configured currency and preserves its payload", async () => {
    mocks.currencyLabel = "ریال آزمایشی";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<PromotionWorkspace admin />);

    fireEvent.click(
      await screen.findByRole("button", { name: /پروموشن جدید/ }),
    );
    expect(screen.getByLabelText("درصد تخفیف")).toBeTruthy();
    expect(screen.queryByText(/ریال آزمایشی/)).toBeNull();

    fireEvent.change(screen.getByLabelText("نوع پروموشن"), {
      target: { value: "LastMinute" },
    });
    expect(screen.getByLabelText("درصد تخفیف")).toBeTruthy();
    expect(screen.queryByText(/ریال آزمایشی/)).toBeNull();

    fireEvent.change(screen.getByLabelText("نوع پروموشن"), {
      target: { value: "FixedAmountDiscount" },
    });

    const amountInput = screen.getByLabelText(
      "مبلغ تخفیف (ریال آزمایشی)",
    );
    expect(screen.queryByLabelText(/درصد تخفیف/)).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /عنوان پروموشن/ }), {
      target: { value: "تخفیف ثابت آزمون" },
    });
    fireEvent.change(amountInput, { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ذخیره" }));

    await waitFor(() =>
      expect(
        mocks.apiRequest.mock.calls.some(
          ([path, init]) =>
            path === "/admin/promotions" && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const [, request] = mocks.apiRequest.mock.calls.find(
      ([path, init]) =>
        path === "/admin/promotions" && init?.method === "POST",
    )!;
    expect(JSON.parse(request.body as string)).toMatchObject({
      amount: 250000,
      percentage: null,
      type: "FixedAmountDiscount",
    });
    expect(JSON.parse(request.body as string)).not.toHaveProperty(
      "currencyLabel",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the canonical fallback for a fixed discount", async () => {
    render(<PromotionWorkspace admin />);

    fireEvent.click(
      await screen.findByRole("button", { name: /پروموشن جدید/ }),
    );
    fireEvent.change(screen.getByLabelText("نوع پروموشن"), {
      target: { value: "FixedAmountDiscount" },
    });

    expect(screen.getByLabelText("مبلغ تخفیف (تومان)")).toBeTruthy();
  });

  it("creates a free-night promotion with a required positive threshold and no configurable benefit", async () => {
    render(<PromotionWorkspace admin />);
    fireEvent.click(await screen.findByRole("button", { name: /پروموشن جدید/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /عنوان پروموشن/ }), {
      target: { value: "اقامت چهار شب" },
    });
    fireEvent.change(screen.getByLabelText("نوع پروموشن"), { target: { value: "StayXGetOneFree" } });
    expect(screen.queryByLabelText("درصد تخفیف")).toBeNull();
    expect(screen.queryByLabelText(/مبلغ تخفیف/)).toBeNull();
    expect(screen.getByText(/حتی در اقامت طولانی‌تر، فقط یک شب رایگان است/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    expect(screen.getByText("حداقل شب اقامت برای یک شب رایگان باید عددی مثبت باشد.")).toBeTruthy();
    const threshold = screen.getByRole("spinbutton", { name: /حداقل شب اقامت/ });
    expect(threshold.getAttribute("min")).toBe("1");
    expect((threshold as HTMLInputElement).required).toBe(true);
    fireEvent.change(threshold, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    expect(threshold.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(threshold, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    expect(within(screen.getByRole("dialog")).getByText(/۴ شب اقامت، ۱ شب رایگان/)).toBeTruthy();
    expect(mocks.apiRequest.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ذخیره" }));
    await waitFor(() => expect(mocks.apiRequest.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const [path, init] = mocks.apiRequest.mock.calls.find(([, request]) => request?.method === "POST")!;
    expect(path).toBe("/admin/promotions");
    const payload = JSON.parse(init.body as string);
    expect(payload).toMatchObject({ type: "StayXGetOneFree", minimumStayNights: 4, amount: null, percentage: null, lastMinuteDays: null });
    expect(payload).not.toHaveProperty("freeNights");
  });

  it.each([true, false])("displays and edits the existing threshold in admin=%s without changing the type", async (admin) => {
    const promotion: PromotionResponse = {
      id: 9, propertyId: admin ? null : 10, propertyName: "اقامتگاه آزمون",
      title: "شب رایگان آزمون", internalDescription: null, publicDescription: null,
      optionalIcon: null, badgeColor: null, minimumStayNights: 4, minimumGuests: null,
      startDate: "2035-02-01", endDate: "2035-03-01", weekdays: ["Thursday"],
      type: "StayXGetOneFree", percentage: null, amount: null, lastMinuteDays: null,
      sortOrder: 0, isActive: true, isPublished: false, source: admin ? "Admin" : "Owner",
      sourcePromotionId: null, isLibraryTemplate: admin, canEdit: true,
      createdByUserId: 1, createdBy: "آزمون", createdAtUtc: "2035-01-01T00:00:00Z",
      roomTypes: [{ id: 20, name: "اتاق آزمون", roomKind: "Double", roomKindCode: "DBL", basePrice: 100 }],
    };
    const apiBase = admin ? "/admin/promotions" : "/owner/properties/10/promotions";
    mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/admin/properties") return Promise.resolve([]);
      if (path === "/owner/properties/10/room-types") return Promise.resolve(promotion.roomTypes);
      if (path === `${apiBase}/9` && init?.method === "PUT") return Promise.resolve(promotion);
      if (path === apiBase) return Promise.resolve([promotion]);
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });
    render(<PromotionWorkspace admin={admin} propertyId={admin ? undefined : 10} />);
    fireEvent.click(await screen.findByRole("button", { name: /شب رایگان آزمون/ }));
    expect(screen.getAllByText(/۴ شب اقامت، ۱ شب رایگان/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "ویرایش" }));
    expect((screen.getByLabelText("نوع پروموشن") as HTMLSelectElement).value).toBe("StayXGetOneFree");
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    const threshold = screen.getByRole("spinbutton", { name: /حداقل شب اقامت/ });
    expect((threshold as HTMLInputElement).value).toBe("4");
    fireEvent.change(threshold, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    fireEvent.click(screen.getByRole("button", { name: "ادامه" }));
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ذخیره" }));
    await waitFor(() => expect(mocks.apiRequest.mock.calls.some(([path, init]) => path === `${apiBase}/9` && init?.method === "PUT")).toBe(true));
    const [, init] = mocks.apiRequest.mock.calls.find(([, request]) => request?.method === "PUT")!;
    expect(JSON.parse(init.body as string)).toMatchObject({ type: "StayXGetOneFree", minimumStayNights: 6 });
  });

  it("shows the fixed single-night benefit on public promotion cards", () => {
    render(<PromotionCards promotions={[{ id: 1, title: "پیشنهاد اقامت", type: "StayXGetOneFree", minimumStayNights: 4, isActive: true }]} />);
    expect(screen.getByText("۴ شب اقامت، ۱ شب رایگان")).toBeTruthy();
    expect(screen.getByText("۱ شب رایگان")).toBeTruthy();
  });
});
