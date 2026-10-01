import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountCancellationRequest } from "@/lib/account-reservations";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
  session: { authenticated: true, loading: false, workspaces: ["account"] },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ reservationNumber: "R-123456" }),
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  resolveSessionDestination: () => "/account",
  useAuthSession: () => mocks.session,
}));
vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});
vi.mock("@/lib/currency", () => ({
  formatCurrency: (value: number) => `${value} تومان`,
  useSiteCurrencyLabel: () => "تومان",
}));

import AccountReservationDetailsPage from "@/app/account/reservations/[reservationNumber]/page";
import { ApiRequestError } from "@/lib/owner-api";

const detail = {
  reservationId: 12, reservationNumber: "R-123456", propertyName: "اقامتگاه آزمون",
  roomName: "اتاق یک", roomTypeName: "استاندارد", checkInDate: "2026-10-10",
  checkOutDate: "2026-10-12", nightsCount: 2, adults: 2, children: 0,
  roomCount: 1, totalPrice: 1000, finalAmount: 1000, paidAmount: 1000,
  remainingAmount: 0, currency: "IRR", status: "Confirmed",
  createdAtUtc: "2026-09-29T10:00:00Z", paymentExpiresAtUtc: null,
};
const pending: AccountCancellationRequest = {
  status: "Pending", reason: "GuestRequest", message: "برنامه سفر تغییر کرد.",
  requestedAtUtc: "2026-09-30T10:00:00Z", resolvedAtUtc: null,
};

let reservationStatus: string;
let requestState: AccountCancellationRequest | null;
let postFailure: ApiRequestError | null;
let conflictRequest: AccountCancellationRequest | null;
let pendingPost: Promise<AccountCancellationRequest> | null;
let requestGetFailure: ApiRequestError | null;

function setupApi() {
  mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/account/reservations/R-123456")
      return Promise.resolve({ ...detail, status: reservationStatus });
    if (path === "/account/reservations/R-123456/cancellation-request") {
      if (init?.method === "POST") {
        if (postFailure) {
          if (conflictRequest) requestState = conflictRequest;
          return Promise.reject(postFailure);
        }
        if (pendingPost) return pendingPost;
        requestState = { ...pending, message: JSON.parse(String(init.body)).message };
        return Promise.resolve(requestState);
      }
      if (requestGetFailure) return Promise.reject(requestGetFailure);
      return requestState ? Promise.resolve(requestState)
        : Promise.reject(new ApiRequestError("Not found", 404));
    }
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });
}

async function renderReady() {
  render(<AccountReservationDetailsPage />);
  await screen.findAllByText("اقامتگاه آزمون");
  await waitFor(() => expect(screen.queryByText("در حال دریافت وضعیت درخواست...")).toBeNull());
}

async function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "درخواست لغو رزرو" }));
  return screen.findByRole("dialog", { name: "درخواست لغو رزرو" });
}

describe("Guest cancellation request in existing reservation details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reservationStatus = "Confirmed";
    requestState = null;
    postFailure = null;
    conflictRequest = null;
    pendingPost = null;
    requestGetFailure = null;
    setupApi();
  });

  it("treats GET 404 as no request and explains that submitting does not cancel the reservation", async () => {
    await renderReady();
    const dialog = await openForm();
    expect(within(dialog).getByText(/ثبت این درخواست به معنی لغو شدن رزرو نیست/)).toBeTruthy();
    expect(within(dialog).getByText(/توسط پشتیبانی بررسی خواهد شد/)).toBeTruthy();
    expect(screen.getAllByText("تایید شده")).toHaveLength(2);
    expect(within(dialog).queryByText(/کیف پول|سهم اقامتگاه|بازپرداخت/)).toBeNull();
  });

  it("requires a backend-valid reason and submits only reason plus optional message", async () => {
    await renderReady();
    const dialog = await openForm();
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    expect(await within(dialog).findByText("دلیل درخواست را انتخاب کنید.")).toBeTruthy();
    expect(mocks.apiRequest.mock.calls.filter(([path, init]) => path.endsWith("/cancellation-request") && init?.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByRole("combobox", { name: /دلیل درخواست/ }), { target: { value: "GuestRequest" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "پیام (اختیاری)" }), { target: { value: "  لطفاً بررسی کنید  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    await waitFor(() => expect(screen.getByText("درخواست لغو در حال بررسی است")).toBeTruthy());
    const post = mocks.apiRequest.mock.calls.find(([path, init]) => path.endsWith("/cancellation-request") && init?.method === "POST");
    expect(post?.[0]).toBe("/account/reservations/R-123456/cancellation-request");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ reason: "GuestRequest", message: "لطفاً بررسی کنید" });
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === "/account/reservations/R-123456")).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "درخواست لغو رزرو" })).toBeNull());
    expect(reservationStatus).toBe("Confirmed");
  });

  it("submits an empty optional message as null", async () => {
    await renderReady();
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /دلیل درخواست/ }), { target: { value: "Other" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    await waitFor(() => expect(screen.getByText("درخواست لغو در حال بررسی است")).toBeTruthy());
    const post = mocks.apiRequest.mock.calls.find(([path, init]) => path.endsWith("/cancellation-request") && init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ reason: "Other", message: null });
  });

  it("prevents a duplicate POST while the first request is pending", async () => {
    let finish!: (value: AccountCancellationRequest) => void;
    pendingPost = new Promise((resolve) => { finish = resolve; });
    await renderReady();
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /دلیل درخواست/ }), { target: { value: "GuestRequest" } });
    const submit = within(dialog).getByRole("button", { name: "ثبت درخواست" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.apiRequest.mock.calls.filter(([path, init]) => path.endsWith("/cancellation-request") && init?.method === "POST")).toHaveLength(1));
    requestState = pending;
    finish(pending);
    await waitFor(() => expect(screen.getByText("درخواست لغو در حال بررسی است")).toBeTruthy());
  });

  it("shows Pending details and keeps the authoritative reservation status separate", async () => {
    requestState = pending;
    await renderReady();
    expect(screen.getByText("درخواست لغو در حال بررسی است")).toBeTruthy();
    expect(screen.getByText("برنامه سفر تغییر کرد.")).toBeTruthy();
    expect(screen.getByText("زمان درخواست")).toBeTruthy();
    expect(screen.getByText("وضعیت رزرو: تایید شده")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "درخواست لغو رزرو" })).toBeNull();
    expect(screen.queryByText("رزرو لغو شده")).toBeNull();
  });

  it("shows Rejected details and permits another request under the backend's non-cancelled rule", async () => {
    requestState = { ...pending, status: "Rejected", resolvedAtUtc: "2026-10-01T10:00:00Z" };
    await renderReady();
    expect(screen.getByText("درخواست لغو رد شد")).toBeTruthy();
    expect(screen.getByText("زمان بررسی")).toBeTruthy();
    expect(screen.getByText("برنامه سفر تغییر کرد.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "درخواست لغو رزرو" })).toBeTruthy();
  });

  it("shows Resolved read-only and blocks new requests on already Cancelled reservations", async () => {
    reservationStatus = "Cancelled";
    requestState = { ...pending, status: "Resolved", resolvedAtUtc: "2026-10-01T10:00:00Z" };
    await renderReady();
    expect(screen.getByText("درخواست لغو انجام شد")).toBeTruthy();
    expect(screen.getByText("وضعیت رزرو: لغو شده")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "درخواست لغو رزرو" })).toBeNull();
  });

  it("does not offer a request for a Cancelled reservation without request history", async () => {
    reservationStatus = "Cancelled";
    await renderReady();
    expect(screen.getByText("این رزرو لغو شده است.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "درخواست لغو رزرو" })).toBeNull();
  });

  it("refetches authoritative Pending state on POST 409 rather than creating a local duplicate", async () => {
    postFailure = new ApiRequestError("Conflict", 409);
    conflictRequest = pending;
    await renderReady();
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /دلیل درخواست/ }), { target: { value: "GuestRequest" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    await waitFor(() => expect(screen.getByText("درخواست لغو در حال بررسی است")).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "درخواست لغو رزرو" })).toBeNull());
    expect(mocks.apiRequest.mock.calls.filter(([path, init]) => path.endsWith("/cancellation-request") && init?.method === "POST")).toHaveLength(1);
  });

  it("keeps the form and input intact on an authorization error", async () => {
    postFailure = new ApiRequestError("اجازه ثبت این درخواست را ندارید.", 403);
    await renderReady();
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /دلیل درخواست/ }), { target: { value: "GuestRequest" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "پیام (اختیاری)" }), { target: { value: "پیام مهمان" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "اجازه ثبت این درخواست را ندارید.");
    expect(within(dialog).getByRole("textbox", { name: "پیام (اختیاری)" })).toHaveProperty("value", "پیام مهمان");
    expect(requestState).toBeNull();
  });

  it("keeps the request action unavailable when GET fails and supports retry", async () => {
    requestGetFailure = new ApiRequestError("Server unavailable", 503);
    await renderReady();
    expect(screen.getByRole("alert").textContent).toContain("Server unavailable");
    expect(screen.queryByRole("button", { name: "درخواست لغو رزرو" })).toBeNull();
    requestGetFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByRole("button", { name: "درخواست لغو رزرو" })).toBeTruthy();
  });
});
