import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  step: "information",
}));
const auth = vi.hoisted(() => ({
  authenticated: false,
  loading: false,
}));
const checkout = vi.hoisted(() => ({
  create: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams({ step: navigation.step }),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => auth,
}));
vi.mock("@/components/booking/booking-checkout", () => ({
  createBookingSessionFromCart: checkout.create,
  revalidateBookingCart: checkout.revalidate,
}));

import {
  BookingCheckoutFlow,
  buildPropertyReturnHref,
} from "@/components/booking/BookingCheckoutFlow";
import {
  bookingCartStorageKey,
  expandBookingCartSelection,
  lastBookingSessionCodeKey,
  type BookingCartItem,
} from "@/components/booking/BookingCartProvider";

function bookingItems(): BookingCartItem[] {
  return [
    ...expandBookingCartSelection({
      propertyId: 1,
      propertyName: "خانه کاشان",
      propertySlug: "kashan-house",
      bookingMode: "Instant",
      roomTypeId: 10,
      roomTypeName: "اتاق شاه‌نشین",
      checkIn: "2026-08-10",
      checkOut: "2026-08-12",
      adults: 2,
      children: 1,
      childAges: [7],
      notes: null,
      displayAmount: 2_000_000,
      currency: "IRR",
      quantity: 2,
    }),
    ...expandBookingCartSelection({
      propertyId: 1,
      propertyName: "خانه کاشان",
      propertySlug: "kashan-house",
      bookingMode: "Instant",
      roomTypeId: 20,
      roomTypeName: "اتاق نیلوفر",
      checkIn: "2026-08-10",
      checkOut: "2026-08-12",
      adults: 2,
      children: 1,
      childAges: [7],
      notes: null,
      displayAmount: 3_000_000,
      currency: "IRR",
      quantity: 1,
    }),
  ];
}

function persistCart(items = bookingItems()) {
  sessionStorage.setItem(bookingCartStorageKey, JSON.stringify({
    propertyId: items[0].propertyId,
    propertyName: items[0].propertyName,
    propertySlug: items[0].propertySlug,
    bookingMode: items[0].bookingMode,
    idempotencyKey: "checkout-stable-key",
    checkoutRequested: false,
    items,
  }));
}

describe("multi-step booking checkout skeleton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    auth.authenticated = false;
    auth.loading = false;
    navigation.step = "information";
    checkout.revalidate.mockImplementation(async (items: BookingCartItem[]) => ({
      items,
      priceChanged: false,
    }));
    checkout.create.mockResolvedValue({ sessionCode: "BS-100" });
  });

  it("restores Step 2 from the persisted cart and shows its read-only summary", async () => {
    persistCart();
    render(<BookingCheckoutFlow />);

    expect(await screen.findByRole("heading", { name: "تکمیل رزرو", level: 1 })).toBeTruthy();
    const stepper = screen.getByTestId("booking-checkout-stepper");
    expect(within(stepper).getByText("انتخاب اقامت")).toBeTruthy();
    expect(within(stepper).getByText("اطلاعات").closest("li")?.getAttribute("aria-current")).toBe("step");
    expect(within(stepper).getByText("نهایی‌سازی")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "اطلاعات رزروکننده" })).toBeTruthy();
    expect(screen.getByText("اتاق شاه‌نشین")).toBeTruthy();
    expect(screen.getByText("اتاق نیلوفر")).toBeTruthy();
    expect(screen.getByText("۷٬۰۰۰٬۰۰۰ تومان")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /حذف .* از سبد رزرو/ })).toBeNull();
    const mobileActions = screen.getByTestId("checkout-mobile-actions");
    expect(mobileActions.className).toContain("flex-col");
    expect(mobileActions.className).not.toContain("flex-col-reverse");
  });

  it("returns to the Property stay without clearing the cart", async () => {
    const items = bookingItems();
    persistCart(items);
    render(<BookingCheckoutFlow />);

    fireEvent.click(await screen.findByRole("button", { name: "بازگشت به انتخاب اقامت" }));

    expect(navigation.push).toHaveBeenCalledWith(buildPropertyReturnHref(items));
    expect(JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).items).toHaveLength(3);
  });

  it("navigates from Step 2 to the Step 3 review skeleton and back", async () => {
    persistCart();
    const view = render(<BookingCheckoutFlow />);

    fireEvent.click(await screen.findByRole("button", { name: "ادامه به نهایی‌سازی" }));
    expect(navigation.push).toHaveBeenCalledWith("/booking/checkout?step=review");

    navigation.step = "review";
    view.rerender(<BookingCheckoutFlow />);
    expect(await screen.findByRole("heading", { name: "مرور و نهایی‌سازی", level: 2 })).toBeTruthy();
    expect(screen.getByText(/تا پیش از انتخاب «ثبت نهایی رزرو» هیچ سفارشی ایجاد نمی‌شود/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "ثبت نهایی رزرو" }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "بازگشت به اطلاعات" }));
    expect(navigation.push).toHaveBeenCalledWith("/booking/checkout?step=information");
  });

  it("recovers after a full remount and keeps the same idempotency key", async () => {
    persistCart();
    const first = render(<BookingCheckoutFlow />);
    expect(await screen.findByText("اتاق شاه‌نشین")).toBeTruthy();
    first.unmount();

    render(<BookingCheckoutFlow />);
    expect(await screen.findByText("اتاق نیلوفر")).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).idempotencyKey)
      .toBe("checkout-stable-key");
  });

  it("fails safely when the cart is empty", async () => {
    render(<BookingCheckoutFlow />);

    expect(await screen.findByText("انتخاب رزروی پیدا نشد")).toBeTruthy();
    expect(screen.queryByTestId("booking-checkout-stepper")).toBeNull();
    expect(screen.queryByRole("button", { name: "ادامه به نهایی‌سازی" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "بازگشت به اقامتگاه‌ها" }));
    expect(navigation.push).toHaveBeenCalledWith("/properties");
  });

  it("does not call an API or create a BookingSession merely by entering Steps 2 and 3", async () => {
    persistCart();
    const view = render(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("button", { name: "ادامه به نهایی‌سازی" }));
    navigation.step = "review";
    view.rerender(<BookingCheckoutFlow />);
    await waitFor(() => expect(screen.getByText("ثبت نهایی با رفتار فعلی")).toBeTruthy());
    expect(checkout.revalidate).not.toHaveBeenCalled();
    expect(checkout.create).not.toHaveBeenCalled();
  });

  it("preserves the cart and returns to Step 3 through the real login flow", async () => {
    persistCart();
    navigation.step = "review";
    render(<BookingCheckoutFlow />);

    fireEvent.click(await screen.findByRole("button", { name: "ثبت نهایی رزرو" }));

    expect(navigation.push).toHaveBeenCalledWith(
      `/login?returnTo=${encodeURIComponent("/booking/checkout?step=review")}`,
    );
    expect(checkout.revalidate).not.toHaveBeenCalled();
    expect(checkout.create).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).checkoutRequested)
      .toBe(true);
  });

  it("revalidates and creates the BookingSession only after authenticated final submit", async () => {
    const items = bookingItems();
    persistCart(items);
    auth.authenticated = true;
    navigation.step = "review";
    render(<BookingCheckoutFlow />);

    fireEvent.click(await screen.findByRole("button", { name: "ثبت نهایی رزرو" }));

    await waitFor(() => expect(checkout.create).toHaveBeenCalledWith(
      items,
      "checkout-stable-key",
    ));
    expect(checkout.revalidate).toHaveBeenCalledWith(items);
    expect(sessionStorage.getItem(lastBookingSessionCodeKey)).toBe("BS-100");
    expect(sessionStorage.getItem(bookingCartStorageKey)).toBeNull();
    expect(navigation.push).toHaveBeenCalledWith("/account/booking-sessions/BS-100");
  });

  it("resumes the same final submission after returning authenticated from login", async () => {
    const items = bookingItems();
    persistCart(items);
    const stored = JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!);
    sessionStorage.setItem(
      bookingCartStorageKey,
      JSON.stringify({ ...stored, checkoutRequested: true }),
    );
    auth.authenticated = true;
    navigation.step = "review";

    render(<BookingCheckoutFlow />);

    await waitFor(() => expect(checkout.create).toHaveBeenCalledWith(
      items,
      "checkout-stable-key",
    ));
  });
});
