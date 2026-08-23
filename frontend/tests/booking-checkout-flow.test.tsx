import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  step: "information",
}));
const auth = vi.hoisted(() => ({
  authenticated: false,
  loading: false,
  refreshSession: vi.fn(),
  user: null as null | {
    userId: number;
    firstName: string;
    lastName: string;
    guestId: number | null;
    fullName: string;
    email: string;
    phoneNumber: string | null;
    isActive: boolean;
  },
}));
const checkout = vi.hoisted(() => ({
  create: vi.fn(),
  revalidate: vi.fn(),
}));
const authApi = vi.hoisted(() => ({
  request: vi.fn(),
  setToken: vi.fn(),
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
vi.mock("@/lib/owner-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/owner-api")>();
  return {
    ...original,
    apiRequest: authApi.request,
    setToken: authApi.setToken,
  };
});

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
import {
  checkoutStayDetailsStorageKey,
  emptyCheckoutStayDetailsDraft,
  validateCheckoutStayDetailsDraft,
} from "@/components/booking/CheckoutStayDetails";
import { ApiRequestError } from "@/lib/owner-api";

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

function onRequestBookingItems(): BookingCartItem[] {
  return bookingItems().map((item) => ({
    ...item,
    bookingMode: "OnRequest",
  }));
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

function signIn(overrides: Partial<NonNullable<typeof auth.user>> = {}) {
  auth.authenticated = true;
  auth.user = {
    userId: 7,
    firstName: "سارا",
    lastName: "احمدی",
    guestId: 12,
    fullName: "سارا احمدی",
    email: "sara@example.test",
    phoneNumber: "09121234567",
    isActive: true,
    ...overrides,
  };
}

describe("multi-step booking checkout skeleton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    auth.authenticated = false;
    auth.loading = false;
    auth.user = null;
    navigation.step = "information";
    checkout.revalidate.mockImplementation(async (items: BookingCartItem[]) => ({
      items,
      priceChanged: false,
    }));
    checkout.create.mockResolvedValue({ sessionCode: "BS-100" });
    auth.refreshSession.mockResolvedValue(null);
  });

  it("restores Step 2 from the persisted cart and shows its read-only summary", async () => {
    persistCart();
    render(<BookingCheckoutFlow />);

    expect(await screen.findByRole("heading", { name: "تکمیل رزرو", level: 1 })).toBeTruthy();
    const stepper = screen.getByTestId("booking-checkout-stepper");
    expect(within(stepper).getByText("انتخاب اقامت")).toBeTruthy();
    expect(within(stepper).getByText("اطلاعات").closest("li")?.getAttribute("aria-current")).toBe("step");
    expect(within(stepper).getByText("نهایی‌سازی")).toBeTruthy();
    expect(screen.queryByText("مرحله ۲ از ۳")).toBeNull();
    expect(screen.getByTestId("booking-checkout-page").className).toContain("overflow-x-clip");
    expect(screen.getByRole("heading", { name: "اطلاعات رزروکننده" })).toBeTruthy();
    expect(screen.getByLabelText(/شماره موبایل/)).toBeTruthy();
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
    signIn();
    const view = render(<BookingCheckoutFlow />);

    fireEvent.click(await screen.findByRole("button", { name: "ادامه به نهایی‌سازی" }));
    expect(navigation.push).toHaveBeenCalledWith("/booking/checkout?step=review");

    navigation.step = "review";
    view.rerender(<BookingCheckoutFlow />);
    expect(await screen.findByRole("heading", { name: "مرور و نهایی‌سازی", level: 2 })).toBeTruthy();
    expect(screen.getByText("سارا احمدی")).toBeTruthy();
    expect(screen.getByText("۰۹۱۲۱۲۳۴۵۶۷")).toBeTruthy();
    expect(screen.getByText("sara@example.test")).toBeTruthy();
    expect(screen.getAllByText("رزرو آنی").length).toBeGreaterThan(0);
    expect(screen.getByText(/پس از ثبت رزرو، برای تکمیل رزرو وارد مرحله پرداخت می‌شوید/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "ادامه به پرداخت" }).hasAttribute("disabled")).toBe(false);

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

  it("does not call a booking API merely by entering Steps 2 and 3", async () => {
    persistCart();
    signIn();
    const view = render(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("button", { name: "ادامه به نهایی‌سازی" }));
    navigation.step = "review";
    view.rerender(<BookingCheckoutFlow />);
    await waitFor(() => expect(screen.getByText(/پس از ثبت رزرو، برای تکمیل رزرو وارد مرحله پرداخت می‌شوید/)).toBeTruthy());
    expect(checkout.revalidate).not.toHaveBeenCalled();
    expect(checkout.create).not.toHaveBeenCalled();
  });

  it("uses the OnRequest explanation and submit action without implying payment or confirmation", async () => {
    persistCart(onRequestBookingItems());
    signIn();
    navigation.step = "review";
    render(<BookingCheckoutFlow />);

    expect((await screen.findAllByText("نیازمند تأیید اقامتگاه")).length).toBeGreaterThan(0);
    expect(screen.getByText("درخواست رزرو برای اقامتگاه ارسال می‌شود.")).toBeTruthy();
    expect(screen.getByText("تا پیش از تأیید اقامتگاه، پرداختی انجام نمی‌شود.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ارسال درخواست رزرو" })).toBeTruthy();
    expect(screen.queryByText(/مهلت پرداخت/)).toBeNull();
    expect(screen.queryByText(/رزرو شما تأیید شد/)).toBeNull();
  });

  it("shows the complete read-only review and the same Instant CTA in the mobile action region", async () => {
    persistCart();
    sessionStorage.setItem(checkoutStayDetailsStorageKey, JSON.stringify({
      version: 1,
      bookingForSelf: true,
      primaryGuest: { firstName: "", lastName: "", mobile: "", email: "" },
      expectedArrivalTime: "14:30:00",
      specialRequest: "تخت کودک لطفاً",
    }));
    signIn();
    navigation.step = "review";
    render(<BookingCheckoutFlow />);

    expect(await screen.findByRole("heading", { name: "اقامت" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "اتاق‌ها" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "مهمانان" })).toBeTruthy();
    expect(screen.getByText("خانه کاشان")).toBeTruthy();
    expect(screen.getAllByText("۱۹ مرداد ۱۴۰۵ تا ۲۱ مرداد ۱۴۰۵").length).toBeGreaterThan(0);
    expect(screen.getAllByText("۲ شب").length).toBeGreaterThan(0);
    expect(screen.getAllByText("۲ اتاق").length).toBeGreaterThan(0);
    expect(screen.getAllByText("۴٬۰۰۰٬۰۰۰ تومان").length).toBeGreaterThan(0);
    expect(screen.getAllByText("۳٬۰۰۰٬۰۰۰ تومان").length).toBeGreaterThan(0);
    expect(screen.getAllByText("۱ کودک (۷ سال)").length).toBeGreaterThan(0);
    expect(screen.getByText("رزرو برای خودم")).toBeTruthy();
    expect(screen.getByText("۱۴:۳۰")).toBeTruthy();
    expect(screen.getByText("تخت کودک لطفاً")).toBeTruthy();
    expect(screen.getAllByText("۷٬۰۰۰٬۰۰۰ تومان").length).toBeGreaterThan(0);
    expect(screen.getAllByText("رزرو آنی").length).toBeGreaterThanOrEqual(2);

    const mobileTotal = screen.getByTestId("checkout-mobile-total");
    expect(mobileTotal.className).toContain("sm:hidden");
    expect(within(screen.getByTestId("checkout-mobile-actions")).getByRole("button", { name: "ادامه به پرداخت" })).toBeTruthy();
    expect(screen.queryByText(/مهلت پرداخت|مهلت تأیید/)).toBeNull();
    expect(screen.queryByText(/رزرو شما قطعی شد/)).toBeNull();
  });

  it("blocks Step 3 for an anonymous user and retains traditional login as a fallback", async () => {
    persistCart();
    navigation.step = "review";
    render(<BookingCheckoutFlow />);

    expect(await screen.findByText(/نشست شما در دسترس نیست/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ادامه به پرداخت" })).toBeNull();
    expect(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }).hasAttribute("disabled"))
      .toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "ورود به حساب از مسیر دیگر" }));

    expect(navigation.push).toHaveBeenCalledWith(
      `/login?returnTo=${encodeURIComponent("/booking/checkout?step=information")}`,
    );
    expect(checkout.revalidate).not.toHaveBeenCalled();
    expect(checkout.create).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).items).toHaveLength(3);
  });

  it("revalidates and creates the BookingSession only after authenticated final submit", async () => {
    const items = bookingItems();
    persistCart(items);
    signIn();
    navigation.step = "review";
    render(<BookingCheckoutFlow />);

    fireEvent.click(await screen.findByRole("button", { name: "ادامه به پرداخت" }));

    await waitFor(() => expect(checkout.create).toHaveBeenCalledWith(
      items,
      "checkout-stable-key",
      {
        bookingForSelf: true,
        expectedArrivalTime: null,
        primaryGuest: null,
        specialRequest: null,
      },
    ));
    expect(checkout.revalidate).toHaveBeenCalledWith(items);
    expect(sessionStorage.getItem(lastBookingSessionCodeKey)).toBe("BS-100");
    expect(sessionStorage.getItem(bookingCartStorageKey)).toBeNull();
    expect(navigation.push).toHaveBeenCalledWith("/account/booking-sessions/BS-100");
  });

  it("creates an OnRequest session and routes to canonical detail without initiating payment", async () => {
    const items = onRequestBookingItems();
    persistCart(items);
    signIn();
    navigation.step = "review";
    render(<BookingCheckoutFlow />);

    fireEvent.click(await screen.findByRole("button", { name: "ارسال درخواست رزرو" }));

    await waitFor(() => expect(checkout.create).toHaveBeenCalledTimes(1));
    expect(checkout.create).toHaveBeenCalledWith(
      items,
      "checkout-stable-key",
      expect.objectContaining({ bookingForSelf: true }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/account/booking-sessions/BS-100");
    expect(navigation.push).not.toHaveBeenCalledWith(expect.stringMatching(/payment|payments/));
  });

  it("accepts only one final submission while revalidation is in flight", async () => {
    const items = bookingItems();
    let resolveRevalidation!: (value: { items: BookingCartItem[]; priceChanged: boolean }) => void;
    checkout.revalidate.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRevalidation = resolve; }),
    );
    persistCart(items);
    signIn();
    navigation.step = "review";
    render(<BookingCheckoutFlow />);

    const submit = await screen.findByRole("button", { name: "ادامه به پرداخت" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(checkout.revalidate).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(bookingCartStorageKey)).not.toBeNull();
    expect(sessionStorage.getItem(checkoutStayDetailsStorageKey)).not.toBeNull();
    resolveRevalidation({ items, priceChanged: false });
    await waitFor(() => expect(checkout.create).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(bookingCartStorageKey)).toBeNull();
    expect(sessionStorage.getItem(checkoutStayDetailsStorageKey)).toBeNull();
  });

  it("prefills an authenticated identity without asking for OTP", async () => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);

    expect(await screen.findByText("سارا احمدی")).toBeTruthy();
    expect(screen.queryByText("وارد حساب خود هستید")).toBeNull();
    const contact = screen.getByTestId("checkout-booking-contact");
    expect(within(contact).getByText("نام و نام خانوادگی")).toBeTruthy();
    expect(within(contact).getByText("شماره موبایل")).toBeTruthy();
    expect(within(contact).getByText("ایمیل")).toBeTruthy();
    expect(contact.className).toContain("sm:grid-cols-3");
    expect(screen.getByText("سارا احمدی")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ارسال کد تأیید" })).toBeNull();
    expect(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }).hasAttribute("disabled"))
      .toBe(false);
  });

  it("allows a complete authenticated identity to continue without email", async () => {
    persistCart();
    signIn({ email: "" });
    render(<BookingCheckoutFlow />);

    expect(await screen.findByText("ثبت نشده")).toBeTruthy();
    expect(screen.queryByText("وارد حساب خود هستید")).toBeNull();
    expect(screen.queryByRole("heading", { name: "تکمیل اطلاعات حساب" })).toBeNull();
    expect(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }).hasAttribute("disabled"))
      .toBe(false);
  });

  it.each([
    ["lastName", { lastName: "", fullName: "سارا" }, "نام خانوادگی"],
    ["firstName", { firstName: "", fullName: "احمدی" }, "نام"],
  ])("shows canonical profile completion when authenticated %s is missing", async (_, overrides, missingLabel) => {
    persistCart();
    signIn(overrides);
    render(<BookingCheckoutFlow />);

    const completion = await screen.findByRole("heading", { name: "تکمیل اطلاعات حساب" });
    const section = completion.closest("section")!;
    expect(within(section).getByLabelText(/^نام\s*\*/, { selector: "input" })).toBeTruthy();
    expect(within(section).getByLabelText(/^نام خانوادگی/, { selector: "input" })).toBeTruthy();
    expect(within(section).queryByLabelText("شماره موبایل", { selector: "input" })).toBeNull();
    expect(screen.getByText(missingLabel, { selector: "dt" }).parentElement?.textContent).toContain("تکمیل نشده");
    expect(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }).hasAttribute("disabled"))
      .toBe(true);
    expect(screen.queryByText("این رزرو برای چه کسی است؟", { selector: "legend" })).toBeNull();
  });

  it("refreshes the authoritative session after profile completion and reveals stay details without losing checkout state", async () => {
    const items = bookingItems();
    persistCart(items);
    sessionStorage.setItem(checkoutStayDetailsStorageKey, JSON.stringify({
      version: 1,
      bookingForSelf: true,
      primaryGuest: { firstName: "", lastName: "", mobile: "", email: "" },
      expectedArrivalTime: "14:30:00",
      specialRequest: "اتاق آرام",
    }));
    signIn({ lastName: "", fullName: "سارا" });
    authApi.request.mockResolvedValueOnce({});
    auth.refreshSession.mockImplementationOnce(async () => {
      signIn({ lastName: "احمدی", fullName: "سارا احمدی" });
      return { user: auth.user };
    });
    const view = render(<BookingCheckoutFlow />);

    const completion = (await screen.findByRole("heading", { name: "تکمیل اطلاعات حساب" })).closest("section")!;
    fireEvent.change(within(completion).getByLabelText(/^نام خانوادگی/, { selector: "input" }), {
      target: { value: "  احمدی  " },
    });
    fireEvent.click(within(completion).getByRole("button", { name: "ذخیره و ادامه" }));

    await waitFor(() => expect(auth.refreshSession).toHaveBeenCalledTimes(1));
    expect(authApi.request).toHaveBeenCalledWith("/auth/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ firstName: "سارا", lastName: "  احمدی  " }),
    });
    view.rerender(<BookingCheckoutFlow />);

    expect(screen.queryByRole("heading", { name: "تکمیل اطلاعات حساب" })).toBeNull();
    expect(await screen.findByText("این رزرو برای چه کسی است؟", { selector: "legend" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /برای خودم/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /رزرو برای دیگری/ })).toBeTruthy();
    expect((screen.getByLabelText("زمان تقریبی ورود") as HTMLSelectElement).value).toBe("14:30:00");
    expect((screen.getByLabelText("درخواست ویژه") as HTMLTextAreaElement).value).toBe("اتاق آرام");
    expect(sessionStorage.getItem(bookingCartStorageKey)).not.toBeNull();
    expect(sessionStorage.getItem(checkoutStayDetailsStorageKey)).not.toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("preserves entered identity and checkout state when profile completion fails", async () => {
    persistCart();
    sessionStorage.setItem(checkoutStayDetailsStorageKey, JSON.stringify({
      version: 1,
      bookingForSelf: true,
      primaryGuest: { firstName: "", lastName: "", mobile: "", email: "" },
      expectedArrivalTime: "",
      specialRequest: "بدون پله",
    }));
    signIn({ lastName: "", fullName: "سارا" });
    authApi.request.mockRejectedValueOnce(new ApiRequestError("Internal error", 500));
    render(<BookingCheckoutFlow />);

    const completion = (await screen.findByRole("heading", { name: "تکمیل اطلاعات حساب" })).closest("section")!;
    const lastNameInput = within(completion).getByLabelText(/^نام خانوادگی/, { selector: "input" }) as HTMLInputElement;
    fireEvent.change(lastNameInput, { target: { value: "احمدی" } });
    fireEvent.click(within(completion).getByRole("button", { name: "ذخیره و ادامه" }));

    expect(await screen.findByText(/ذخیره اطلاعات حساب موقتاً ممکن نیست/)).toBeTruthy();
    expect(lastNameInput.value).toBe("احمدی");
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }).hasAttribute("disabled"))
      .toBe(true);
    expect(sessionStorage.getItem(bookingCartStorageKey)).not.toBeNull();
    expect(sessionStorage.getItem(checkoutStayDetailsStorageKey)).not.toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("defaults an authenticated user to booking for self without duplicate traveler fields", async () => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);

    expect((await screen.findByRole("radio", { name: /برای خودم/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText("نام خانوادگی", { selector: "input" })).toBeNull();
    expect(screen.queryByText(/رزرو برای سارا احمدی ثبت خواهد شد/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "مهمان اصلی" })).toBeNull();
  });

  it("shows primary guest fields when booking for another person", async () => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);

    fireEvent.click(await screen.findByRole("radio", { name: /رزرو برای دیگری/ }));
    expect(screen.getByRole("heading", { name: "اطلاعات مهمان اصلی" })).toBeTruthy();
    expect(screen.getByLabelText(/^نام\s*\*/, { selector: "input" })).toBeTruthy();
    expect(screen.getByLabelText(/^نام خانوادگی\s*\*/, { selector: "input" })).toBeTruthy();
    expect(screen.queryByText(/کد تأیید.*مهمان/)).toBeNull();
  });

  it("confirms another guest locally, collapses to a summary, and reopens with values preserved", async () => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);

    fireEvent.click(await screen.findByRole("radio", { name: /رزرو برای دیگری/ }));
    fireEvent.change(screen.getByLabelText(/^نام\s*\*/, { selector: "input" }), {
      target: { value: "مریم" },
    });
    fireEvent.change(screen.getByLabelText(/^نام خانوادگی/, { selector: "input" }), {
      target: { value: "کریمی" },
    });
    fireEvent.change(screen.getByLabelText("شماره موبایل", { selector: "input" }), {
      target: { value: "09121234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "تأیید اطلاعات مهمان" }));

    const summary = screen.getByTestId("confirmed-primary-guest");
    expect(within(summary).getByText(/مریم کریمی/)).toBeTruthy();
    expect(within(summary).getByText(/۰۹۱۲۱۲۳۴۵۶۷/)).toBeTruthy();
    expect(screen.queryByLabelText(/^نام\s*\*/, { selector: "input" })).toBeNull();
    expect(authApi.request).not.toHaveBeenCalled();
    expect(checkout.create).not.toHaveBeenCalled();

    fireEvent.click(within(summary).getByRole("button", { name: "ویرایش" }));
    expect((screen.getByLabelText(/^نام\s*\*/, { selector: "input" }) as HTMLInputElement).value)
      .toBe("مریم");
    expect((screen.getByLabelText(/^نام خانوادگی/, { selector: "input" }) as HTMLInputElement).value)
      .toBe("کریمی");
  });

  it("keeps the guest form open and exposes existing validation on invalid local confirmation", async () => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);

    fireEvent.click(await screen.findByRole("radio", { name: /رزرو برای دیگری/ }));
    fireEvent.click(screen.getByRole("button", { name: "تأیید اطلاعات مهمان" }));

    expect(screen.getByText("نام مهمان اصلی را وارد کنید.")).toBeTruthy();
    expect(screen.getByText("نام خانوادگی مهمان اصلی را وارد کنید.")).toBeTruthy();
    expect(screen.queryByTestId("confirmed-primary-guest")).toBeNull();
  });

  it("requires the other guest first name", async () => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /رزرو برای دیگری/ }));
    fireEvent.change(screen.getByLabelText(/^نام خانوادگی/, { selector: "input" }), { target: { value: "احمدی" } });
    fireEvent.change(screen.getByLabelText("ایمیل", { selector: "input" }), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }));
    expect(screen.getByText("نام مهمان اصلی را وارد کنید.")).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalledWith("/booking/checkout?step=review");
  });

  it("requires the other guest last name", async () => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /رزرو برای دیگری/ }));
    fireEvent.change(screen.getByLabelText(/^نام\s*\*/, { selector: "input" }), { target: { value: "مریم" } });
    fireEvent.change(screen.getByLabelText("ایمیل", { selector: "input" }), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }));
    expect(screen.getByText("نام خانوادگی مهمان اصلی را وارد کنید.")).toBeTruthy();
  });

  it("blocks another-person checkout without either mobile or email", async () => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /رزرو برای دیگری/ }));
    fireEvent.change(screen.getByLabelText(/^نام\s*\*/, { selector: "input" }), { target: { value: "مریم" } });
    fireEvent.change(screen.getByLabelText(/^نام خانوادگی/, { selector: "input" }), { target: { value: "احمدی" } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }));
    expect(screen.getAllByText("حداقل شماره موبایل یا ایمیل مهمان اصلی را وارد کنید.").length).toBeGreaterThan(0);
  });

  it("validates provided traveler contact formats and the special-request limit", () => {
    const errors = validateCheckoutStayDetailsDraft({
      ...emptyCheckoutStayDetailsDraft,
      bookingForSelf: false,
      primaryGuest: {
        firstName: "مریم",
        lastName: "احمدی",
        mobile: "123",
        email: "invalid-email",
      },
      specialRequest: "x".repeat(2001),
    });
    expect(errors.mobile).toBe("فرمت شماره موبایل معتبر نیست.");
    expect(errors.email).toBe("فرمت ایمیل معتبر نیست.");
    expect(errors.specialRequest).toBe("درخواست ویژه نمی‌تواند بیشتر از ۲۰۰۰ نویسه باشد.");
  });

  it.each([
    ["mobile", "09121234567"],
    ["email", "guest@example.test"],
  ])("accepts another guest with %s only", async (field, value) => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /رزرو برای دیگری/ }));
    fireEvent.change(screen.getByLabelText(/^نام\s*\*/, { selector: "input" }), { target: { value: "مریم" } });
    fireEvent.change(screen.getByLabelText(/^نام خانوادگی/, { selector: "input" }), { target: { value: "احمدی" } });
    fireEvent.change(screen.getByLabelText(field === "mobile" ? "شماره موبایل" : "ایمیل", { selector: "input" }), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }));
    expect(navigation.push).toHaveBeenCalledWith("/booking/checkout?step=review");
  });

  it("stops requiring other-guest fields after switching back to self", async () => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /رزرو برای دیگری/ }));
    fireEvent.click(screen.getByRole("radio", { name: /برای خودم/ }));
    fireEvent.click(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }));
    expect(screen.queryByLabelText(/^نام\s*\*/, { selector: "input" })).toBeNull();
    expect(navigation.push).toHaveBeenCalledWith("/booking/checkout?step=review");
  });

  it("keeps optional arrival time through review, back navigation, and refresh", async () => {
    persistCart();
    signIn();
    const view = render(<BookingCheckoutFlow />);
    const arrival = await screen.findByLabelText("زمان تقریبی ورود");
    fireEvent.change(arrival, { target: { value: "14:30:00" } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }));
    navigation.step = "review";
    view.rerender(<BookingCheckoutFlow />);
    expect(await screen.findByText("۱۴:۳۰")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "بازگشت به اطلاعات" }));
    navigation.step = "information";
    view.rerender(<BookingCheckoutFlow />);
    expect((await screen.findByLabelText("زمان تقریبی ورود") as HTMLSelectElement).value).toBe("14:30:00");
    view.unmount();
    const restored = render(<BookingCheckoutFlow />);
    expect((await screen.findByLabelText("زمان تقریبی ورود") as HTMLSelectElement).value).toBe("14:30:00");
    restored.unmount();
  });

  it("preserves a bounded special request and rejects restored oversized drafts", async () => {
    persistCart();
    signIn();
    const view = render(<BookingCheckoutFlow />);
    const request = await screen.findByLabelText("درخواست ویژه");
    fireEvent.change(request, { target: { value: "اتاق آرام لطفاً" } });
    expect(JSON.parse(sessionStorage.getItem(checkoutStayDetailsStorageKey)!).specialRequest).toBe("اتاق آرام لطفاً");
    view.unmount();
    const restored = render(<BookingCheckoutFlow />);
    expect((await screen.findByLabelText("درخواست ویژه") as HTMLTextAreaElement).value).toBe("اتاق آرام لطفاً");

    sessionStorage.setItem(checkoutStayDetailsStorageKey, JSON.stringify({
      version: 1,
      bookingForSelf: true,
      primaryGuest: { firstName: "", lastName: "", mobile: "", email: "" },
      expectedArrivalTime: "",
      specialRequest: "x".repeat(2001),
    }));
    restored.unmount();
    render(<BookingCheckoutFlow />);
    expect((await screen.findByLabelText("درخواست ویژه") as HTMLTextAreaElement).value).toBe("");
  });

  it("shows child ages read-only without asking for them again", async () => {
    persistCart();
    signIn();
    render(<BookingCheckoutFlow />);
    expect(await screen.findByText(/۱ کودک \(۷ سال\)/)).toBeTruthy();
    expect(screen.queryByLabelText(/سن کودک/)).toBeNull();
  });

  it("reviews booking contact and another primary guest separately", async () => {
    persistCart();
    signIn();
    const view = render(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /رزرو برای دیگری/ }));
    fireEvent.change(screen.getByLabelText(/^نام\s*\*/, { selector: "input" }), { target: { value: "مریم" } });
    fireEvent.change(screen.getByLabelText(/^نام خانوادگی/, { selector: "input" }), { target: { value: "کریمی" } });
    fireEvent.change(screen.getByLabelText("ایمیل", { selector: "input" }), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }));
    navigation.step = "review";
    view.rerender(<BookingCheckoutFlow />);
    expect(await screen.findByRole("heading", { name: "اطلاعات رزروکننده" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "مهمان اصلی" })).toBeTruthy();
    expect(screen.getByText("سارا احمدی")).toBeTruthy();
    expect(screen.getByText("مریم کریمی")).toBeTruthy();
  });

  it("submits other guest, arrival, and special request once without identity IDs", async () => {
    const items = bookingItems();
    persistCart(items);
    signIn();
    const view = render(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /رزرو برای دیگری/ }));
    fireEvent.change(screen.getByLabelText(/^نام\s*\*/, { selector: "input" }), { target: { value: " مریم " } });
    fireEvent.change(screen.getByLabelText(/^نام خانوادگی/, { selector: "input" }), { target: { value: " کریمی " } });
    fireEvent.change(screen.getByLabelText("شماره موبایل", { selector: "input" }), { target: { value: "۰۹۱۲۱۲۳۴۵۶۷" } });
    fireEvent.change(screen.getByLabelText("زمان تقریبی ورود"), { target: { value: "15:00:00" } });
    fireEvent.change(screen.getByLabelText("درخواست ویژه"), { target: { value: "  تخت کودک  " } });
    fireEvent.click(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }));
    navigation.step = "review";
    view.rerender(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("button", { name: "ادامه به پرداخت" }));

    await waitFor(() => expect(checkout.create).toHaveBeenCalled());
    const details = checkout.create.mock.calls[0][2];
    expect(details).toEqual({
      bookingForSelf: false,
      primaryGuest: { firstName: "مریم", lastName: "کریمی", mobile: "09121234567", email: null },
      expectedArrivalTime: "15:00:00",
      specialRequest: "تخت کودک",
    });
    expect(details).not.toHaveProperty("userId");
    expect(details).not.toHaveProperty("guestId");
    expect(items.every((item) => item.notes === null)).toBe(true);
  });

  it("keeps cart and stay draft when final creation fails", async () => {
    persistCart();
    signIn();
    navigation.step = "review";
    checkout.create.mockRejectedValueOnce(new Error("ثبت سفارش موقتاً ممکن نیست."));
    render(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("button", { name: "ادامه به پرداخت" }));
    expect(await screen.findByText("ثبت سفارش موقتاً ممکن نیست.")).toBeTruthy();
    expect(sessionStorage.getItem(bookingCartStorageKey)).not.toBeNull();
    expect(sessionStorage.getItem(checkoutStayDetailsStorageKey)).not.toBeNull();
  });

  it("renews idempotency only for material stay-detail edits", async () => {
    persistCart();
    signIn();
    const view = render(<BookingCheckoutFlow />);
    const initialKey = JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).idempotencyKey;
    fireEvent.change(await screen.findByLabelText("زمان تقریبی ورود"), { target: { value: "16:00:00" } });
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).idempotencyKey).not.toBe(initialKey));
    const editedKey = JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).idempotencyKey;
    fireEvent.click(screen.getByRole("button", { name: "ادامه به نهایی‌سازی" }));
    navigation.step = "review";
    view.rerender(<BookingCheckoutFlow />);
    fireEvent.click(await screen.findByRole("button", { name: "بازگشت به اطلاعات" }));
    expect(JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).idempotencyKey).toBe(editedKey);
  });

  it("sends OTP for an existing user, reflects cooldown, and stays in checkout after verification", async () => {
    persistCart();
    authApi.request
      .mockResolvedValueOnce({
        sent: true,
        requiresRegistration: false,
        expiresAtUtc: "2026-08-18T10:03:00Z",
        devOtpCode: null,
      })
      .mockResolvedValueOnce({ token: "checkout-token" });
    auth.refreshSession.mockImplementation(async () => {
      signIn();
      return { user: auth.user };
    });
    render(<BookingCheckoutFlow />);

    fireEvent.change(await screen.findByLabelText(/شماره موبایل/), {
      target: { value: "۰۹۱۲۱۲۳۴۵۶۷" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));

    expect(await screen.findByLabelText(/کد تأیید/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "ارسال مجدد تا ۶۰ ثانیه" }).hasAttribute("disabled"))
      .toBe(true);
    expect(authApi.request).toHaveBeenNthCalledWith(1, "/auth/request-otp", expect.objectContaining({
      method: "POST",
    }));

    fireEvent.change(screen.getByLabelText(/کد تأیید/), {
      target: { value: "۱۲۳۴۵۶" },
    });
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ادامه" }));

    expect(await screen.findByText("سارا احمدی")).toBeTruthy();
    expect(authApi.setToken).toHaveBeenCalledWith("checkout-token");
    expect(navigation.push).not.toHaveBeenCalledWith(expect.stringMatching(/^\/login/));
    expect(JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).items).toHaveLength(3);
  });

  it("creates a new User through the existing OTP endpoint and preserves the cart", async () => {
    persistCart();
    authApi.request
      .mockResolvedValueOnce({
        sent: false,
        requiresRegistration: true,
        expiresAtUtc: null,
      })
      .mockResolvedValueOnce({
        sent: true,
        requiresRegistration: false,
        expiresAtUtc: "2026-08-18T10:03:00Z",
        devOtpCode: null,
      })
      .mockResolvedValueOnce({ token: "new-user-token" });
    auth.refreshSession.mockImplementation(async () => {
      signIn();
      return { user: auth.user };
    });
    render(<BookingCheckoutFlow />);

    fireEvent.change(await screen.findByLabelText(/شماره موبایل/), {
      target: { value: "09129876543" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));

    expect(await screen.findByText("تکمیل اطلاعات حساب")).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText(/نام/)[0], { target: { value: "مینا" } });
    fireEvent.change(screen.getByLabelText(/نام خانوادگی/), { target: { value: "کریمی" } });
    fireEvent.change(screen.getByLabelText("ایمیل"), { target: { value: "mina@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "ساخت حساب و ارسال کد" }));

    expect(await screen.findByLabelText(/کد تأیید/)).toBeTruthy();
    const registrationPayload = JSON.parse(
      (authApi.request.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(registrationPayload).toEqual(expect.objectContaining({
      allowRegistration: true,
      email: "mina@example.test",
      firstName: "مینا",
      lastName: "کریمی",
      mobile: "09129876543",
    }));

    fireEvent.change(screen.getByLabelText(/کد تأیید/), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ادامه" }));
    expect(await screen.findByText("سارا احمدی")).toBeTruthy();
    expect(sessionStorage.getItem(bookingCartStorageKey)).not.toBeNull();
  });

  it("shows a safe invalid OTP error and does not allow progression", async () => {
    persistCart();
    authApi.request
      .mockResolvedValueOnce({
        sent: true,
        requiresRegistration: false,
        expiresAtUtc: "2026-08-18T10:03:00Z",
        devOtpCode: null,
      })
      .mockRejectedValueOnce(new ApiRequestError("Invalid or expired OTP code.", 401));
    render(<BookingCheckoutFlow />);

    fireEvent.change(await screen.findByLabelText(/شماره موبایل/), {
      target: { value: "09121234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));
    fireEvent.change(await screen.findByLabelText(/کد تأیید/), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ادامه" }));

    expect(await screen.findByText(/کد تأیید نامعتبر یا منقضی شده است/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ادامه به پرداخت" })).toBeNull();
    expect(checkout.create).not.toHaveBeenCalled();
  });

  it("allows changing the mobile before OTP verification", async () => {
    persistCart();
    authApi.request.mockResolvedValueOnce({
      sent: true,
      requiresRegistration: false,
      expiresAtUtc: "2026-08-18T10:03:00Z",
      devOtpCode: null,
    });
    render(<BookingCheckoutFlow />);

    fireEvent.change(await screen.findByLabelText(/شماره موبایل/), {
      target: { value: "09121234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));
    fireEvent.click(await screen.findByRole("button", { name: "تغییر شماره موبایل" }));

    const mobileInput = screen.getByLabelText(/شماره موبایل/) as HTMLInputElement;
    expect(mobileInput.value).toBe("09121234567");
    fireEvent.change(mobileInput, { target: { value: "09129876543" } });
    expect(mobileInput.value).toBe("09129876543");
    expect(screen.queryByLabelText(/کد تأیید/)).toBeNull();
  });

  it("restores the authenticated checkout and cart after a refresh", async () => {
    persistCart();
    signIn();
    const first = render(<BookingCheckoutFlow />);
    expect(await screen.findByText("سارا احمدی")).toBeTruthy();
    first.unmount();

    render(<BookingCheckoutFlow />);
    expect(await screen.findByText("سارا احمدی")).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).items).toHaveLength(3);
  });

  it("returns to identity resolution if the session disappears before final submission", async () => {
    persistCart();
    signIn();
    navigation.step = "review";
    const view = render(<BookingCheckoutFlow />);
    expect(await screen.findByRole("button", { name: "ادامه به پرداخت" })).toBeTruthy();

    auth.authenticated = false;
    auth.user = null;
    view.rerender(<BookingCheckoutFlow />);

    expect(await screen.findByText(/نشست شما در دسترس نیست/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ادامه به پرداخت" })).toBeNull();
    expect(checkout.create).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(bookingCartStorageKey)).not.toBeNull();
  });

});
