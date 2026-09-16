import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("PromotionWorkspace currency context", () => {
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
    fireEvent.change(screen.getByLabelText("عنوان"), {
      target: { value: "تخفیف ثابت آزمون" },
    });
    fireEvent.change(amountInput, { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

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
});
