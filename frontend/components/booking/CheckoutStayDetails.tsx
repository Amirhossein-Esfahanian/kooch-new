"use client";

import { KoochAlert } from "@/components/KoochAlert";
import {
  KoochField,
  KoochInput,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import type { AuthSessionUser } from "@/components/auth/AuthSessionProvider";
import {
  groupBookingCartItems,
} from "@/components/booking/BookingCart";
import type { BookingCartItem } from "@/components/booking/BookingCartProvider";
import {
  bookingModePresentation,
  countBookingNights,
  formatBookingDateRange,
} from "@/components/booking/booking-display";
import type { BookingCheckoutStayDetails } from "@/components/booking/booking-checkout";
import { formatCurrency } from "@/lib/currency";

export const checkoutStayDetailsStorageKey = "kooch_booking_checkout_stay_details_v1";
const checkoutStayDetailsVersion = 1;

export interface CheckoutStayDetailsDraft {
  bookingForSelf: boolean;
  primaryGuest: {
    firstName: string;
    lastName: string;
    mobile: string;
    email: string;
  };
  expectedArrivalTime: string;
  specialRequest: string;
}

export type CheckoutStayDetailsErrors = Partial<
  Record<"firstName" | "lastName" | "mobile" | "email" | "contact" | "specialRequest", string>
>;

export const emptyCheckoutStayDetailsDraft: CheckoutStayDetailsDraft = {
  bookingForSelf: true,
  primaryGuest: { firstName: "", lastName: "", mobile: "", email: "" },
  expectedArrivalTime: "",
  specialRequest: "",
};

const arrivalOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  const value = `${String(hour).padStart(2, "0")}:${minute}:00`;
  return { value, label: `${toPersianDigits(String(hour).padStart(2, "0"))}:${toPersianDigits(minute)}` };
});

export function restoreCheckoutStayDetailsDraft(
  value: string | null,
): CheckoutStayDetailsDraft {
  if (!value) return emptyCheckoutStayDetailsDraft;
  try {
    const parsed = JSON.parse(value) as {
      version?: unknown;
      bookingForSelf?: unknown;
      primaryGuest?: Record<string, unknown>;
      expectedArrivalTime?: unknown;
      specialRequest?: unknown;
    };
    if (
      parsed.version !== checkoutStayDetailsVersion ||
      typeof parsed.bookingForSelf !== "boolean" ||
      !isSafeText(parsed.primaryGuest?.firstName, 100) ||
      !isSafeText(parsed.primaryGuest?.lastName, 100) ||
      !isSafeText(parsed.primaryGuest?.mobile, 30) ||
      !isSafeText(parsed.primaryGuest?.email, 320) ||
      !isSafeText(parsed.specialRequest, 2000) ||
      typeof parsed.expectedArrivalTime !== "string" ||
      (parsed.expectedArrivalTime !== "" &&
        !arrivalOptions.some((option) => option.value === parsed.expectedArrivalTime))
    ) {
      return emptyCheckoutStayDetailsDraft;
    }
    return {
      bookingForSelf: parsed.bookingForSelf,
      primaryGuest: {
        firstName: parsed.primaryGuest!.firstName as string,
        lastName: parsed.primaryGuest!.lastName as string,
        mobile: parsed.primaryGuest!.mobile as string,
        email: parsed.primaryGuest!.email as string,
      },
      expectedArrivalTime: parsed.expectedArrivalTime,
      specialRequest: parsed.specialRequest as string,
    };
  } catch {
    return emptyCheckoutStayDetailsDraft;
  }
}

export function serializeCheckoutStayDetailsDraft(draft: CheckoutStayDetailsDraft) {
  return JSON.stringify({ version: checkoutStayDetailsVersion, ...draft });
}

export function validateCheckoutStayDetailsDraft(
  draft: CheckoutStayDetailsDraft,
): CheckoutStayDetailsErrors {
  const errors: CheckoutStayDetailsErrors = {};
  if (draft.specialRequest.length > 2000) {
    errors.specialRequest = "درخواست ویژه نمی‌تواند بیشتر از ۲۰۰۰ نویسه باشد.";
  }
  if (draft.bookingForSelf) return errors;

  if (!draft.primaryGuest.firstName.trim()) {
    errors.firstName = "نام مهمان اصلی را وارد کنید.";
  }
  if (!draft.primaryGuest.lastName.trim()) {
    errors.lastName = "نام خانوادگی مهمان اصلی را وارد کنید.";
  }
  const mobile = normalizeMobile(draft.primaryGuest.mobile);
  const email = draft.primaryGuest.email.trim();
  if (!mobile && !email) {
    errors.contact = "حداقل شماره موبایل یا ایمیل مهمان اصلی را وارد کنید.";
  }
  if (mobile && !isValidMobile(mobile)) {
    errors.mobile = "فرمت شماره موبایل معتبر نیست.";
  }
  if (email && !isValidEmail(email)) {
    errors.email = "فرمت ایمیل معتبر نیست.";
  }
  return errors;
}

export function toBookingCheckoutStayDetails(
  draft: CheckoutStayDetailsDraft,
): BookingCheckoutStayDetails {
  return {
    bookingForSelf: draft.bookingForSelf,
    primaryGuest: draft.bookingForSelf
      ? null
      : {
          firstName: draft.primaryGuest.firstName.trim(),
          lastName: draft.primaryGuest.lastName.trim(),
          mobile: normalizeMobile(draft.primaryGuest.mobile),
          email: draft.primaryGuest.email.trim().toLowerCase() || null,
        },
    expectedArrivalTime: draft.expectedArrivalTime || null,
    specialRequest: draft.specialRequest.trim() || null,
  };
}

export function CheckoutStayDetails({
  draft,
  errors,
  items,
  onChange,
  user,
}: {
  draft: CheckoutStayDetailsDraft;
  errors: CheckoutStayDetailsErrors;
  items: BookingCartItem[];
  onChange: (draft: CheckoutStayDetailsDraft) => void;
  user: AuthSessionUser;
}) {
  const updateGuest = (field: keyof CheckoutStayDetailsDraft["primaryGuest"], value: string) =>
    onChange({ ...draft, primaryGuest: { ...draft.primaryGuest, [field]: value } });

  return (
    <div className="mt-8 grid gap-8 border-t border-border pt-8">
      <fieldset>
        <legend className="text-base font-black text-foreground">این رزرو برای چه کسی است؟</legend>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <BookingRecipientOption
            checked={draft.bookingForSelf}
            description={`مهمان اصلی ${user.fullName} خواهد بود.`}
            label="برای خودم"
            onChange={() => onChange({ ...draft, bookingForSelf: true })}
          />
          <BookingRecipientOption
            checked={!draft.bookingForSelf}
            description="اطلاعات مهمان اصلی را بدون ساخت حساب جدا ثبت کنید."
            label="برای شخص دیگری"
            onChange={() => onChange({ ...draft, bookingForSelf: false })}
          />
        </div>
      </fieldset>

      {draft.bookingForSelf ? (
        <KoochAlert title="مهمان اصلی" variant="info">
          اطلاعات تکراری از شما خواسته نمی‌شود؛ رزرو برای {user.fullName} ثبت خواهد شد.
        </KoochAlert>
      ) : (
        <section aria-labelledby="primary-guest-title">
          <h3 className="text-base font-black text-foreground" id="primary-guest-title">اطلاعات مهمان اصلی</h3>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            برای مهمان حساب کاربری یا تأیید OTP ساخته نمی‌شود. نام و دست‌کم یکی از راه‌های تماس کافی است.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <KoochField error={errors.firstName} label="نام" required>
              <KoochInput
                autoComplete="given-name"
                maxLength={100}
                onChange={(event) => updateGuest("firstName", event.target.value)}
                value={draft.primaryGuest.firstName}
              />
            </KoochField>
            <KoochField error={errors.lastName} label="نام خانوادگی" required>
              <KoochInput
                autoComplete="family-name"
                maxLength={100}
                onChange={(event) => updateGuest("lastName", event.target.value)}
                value={draft.primaryGuest.lastName}
              />
            </KoochField>
            <KoochField error={errors.mobile ?? errors.contact} helperText="شماره موبایل یا ایمیل؛ وارد کردن یکی کافی است." label="شماره موبایل">
              <KoochInput
                autoComplete="tel"
                dir="ltr"
                inputMode="tel"
                maxLength={30}
                onChange={(event) => updateGuest("mobile", event.target.value)}
                placeholder="مثلاً 09123456789"
                value={draft.primaryGuest.mobile}
              />
            </KoochField>
            <KoochField error={errors.email} label="ایمیل">
              <KoochInput
                autoComplete="email"
                dir="ltr"
                maxLength={320}
                onChange={(event) => updateGuest("email", event.target.value)}
                type="email"
                value={draft.primaryGuest.email}
              />
            </KoochField>
          </div>
        </section>
      )}

      <section className="grid gap-5 sm:grid-cols-2" aria-label="جزئیات تکمیلی اقامت">
        <KoochField helperText="این زمان تقریبی است و محدودیت ساعت پذیرش را تغییر نمی‌دهد." label="زمان تقریبی ورود">
          <KoochSelect
            onChange={(event) => onChange({ ...draft, expectedArrivalTime: event.target.value })}
            value={draft.expectedArrivalTime}
          >
            <option value="">هنوز مشخص نیست</option>
            {arrivalOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </KoochSelect>
        </KoochField>
        <KoochField
          className="sm:col-span-2"
          error={errors.specialRequest}
          helperText={`درخواست شما برای اقامتگاه ارسال می‌شود و تضمین انجام آن وجود ندارد. ${toPersianDigits(String(draft.specialRequest.length))} از ۲۰۰۰ نویسه`}
          label="درخواست ویژه"
        >
          <KoochTextarea
            maxLength={2000}
            onChange={(event) => onChange({ ...draft, specialRequest: event.target.value })}
            placeholder="در صورت نیاز، درخواست خود را بنویسید."
            value={draft.specialRequest}
          />
        </KoochField>
      </section>

      <StayAndGuestSummary items={items} />
    </div>
  );
}

export function CheckoutStayDetailsReview({
  draft,
  items,
  user,
}: {
  draft: CheckoutStayDetailsDraft;
  items: BookingCartItem[];
  user: AuthSessionUser;
}) {
  const guest = toBookingCheckoutStayDetails(draft).primaryGuest;
  const arrival = draft.expectedArrivalTime
    ? toPersianDigits(draft.expectedArrivalTime.slice(0, 5))
    : "مشخص نشده";

  return (
    <div className="mt-6 grid gap-5">
      <ReviewSurface title="اطلاعات رزروکننده">
        <ReviewGrid>
          <ReviewValue label="نام و نام خانوادگی" value={user.fullName} />
          <ReviewValue dir="ltr" label="شماره موبایل" value={toPersianDigits(user.phoneNumber ?? "—")} />
          {user.email ? <ReviewValue className="sm:col-span-2" dir="ltr" label="ایمیل" value={user.email} /> : null}
        </ReviewGrid>
      </ReviewSurface>

      <ReviewSurface title="مهمان اصلی">
        {draft.bookingForSelf ? (
          <p className="text-sm font-bold text-foreground">رزرو برای خودم</p>
        ) : guest ? (
          <ReviewGrid>
            <ReviewValue label="نام و نام خانوادگی" value={`${guest.firstName} ${guest.lastName}`} />
            {guest.mobile ? <ReviewValue dir="ltr" label="شماره موبایل" value={toPersianDigits(guest.mobile)} /> : null}
            {guest.email ? <ReviewValue className="sm:col-span-2" dir="ltr" label="ایمیل" value={guest.email} /> : null}
          </ReviewGrid>
        ) : null}
      </ReviewSurface>

      <StayAndGuestSummary items={items} review />

      <div className="grid gap-5 sm:grid-cols-2">
        <ReviewSurface title="زمان ورود"><p className="text-sm font-bold text-foreground">{arrival}</p></ReviewSurface>
        {draft.specialRequest.trim() ? (
          <ReviewSurface title="درخواست ویژه">
            <p className="break-words text-sm leading-7 text-foreground">{draft.specialRequest.trim()}</p>
          </ReviewSurface>
        ) : null}
      </div>
    </div>
  );
}

function StayAndGuestSummary({ items, review = false }: { items: BookingCartItem[]; review?: boolean }) {
  const first = items[0];
  if (!first) return null;
  const lines = groupBookingCartItems(items);
  const childrenDescription = first.children > 0
    ? `${first.children.toLocaleString("fa-IR")} کودک (${first.childAges.map((age) => `${age.toLocaleString("fa-IR")} سال`).join("، ")})`
    : "بدون کودک";

  return (
    <section className={review ? "rounded-lg border border-border bg-background p-4" : ""} aria-labelledby={review ? "review-stay-title" : "stay-summary-title"}>
      <h3 className="text-base font-black text-foreground" id={review ? "review-stay-title" : "stay-summary-title"}>{review ? "اقامت" : "خلاصه اقامت و مهمانان"}</h3>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <ReviewValue label="اقامتگاه" value={first.propertyName} />
        <ReviewValue label="تاریخ اقامت" value={formatBookingDateRange(first.checkIn, first.checkOut)} />
        <ReviewValue label="مدت اقامت" value={`${countBookingNights(items).toLocaleString("fa-IR")} شب`} />
        {!review ? <ReviewValue label="مهمانان" value={`${first.adults.toLocaleString("fa-IR")} بزرگسال، ${childrenDescription}`} /> : null}
        {!review ? <ReviewValue label="مبلغ کل" value={formatCurrency(items.reduce((sum, item) => sum + item.displayAmount, 0))} /> : null}
      </dl>
      {review ? <h4 className="mt-5 border-t border-border pt-5 text-sm font-black text-foreground">اتاق‌ها</h4> : null}
      <ul className="mt-4 grid gap-2" aria-label="اتاق‌های انتخاب‌شده">
        {lines.map((line) => {
          const lineMode = bookingModePresentation(line.item.bookingMode);
          return (
            <li className="grid min-w-0 gap-2 rounded-lg bg-muted px-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={line.key}>
              <div className="min-w-0">
                <p className="break-words font-black text-foreground">{line.item.roomTypeName}</p>
                <p className="mt-1 text-xs font-bold text-muted-foreground">
                  {lineMode.icon} {lineMode.label}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 sm:justify-end">
                <span className="font-bold text-foreground">{line.quantity.toLocaleString("fa-IR")} اتاق</span>
                <span className="font-black text-foreground">{formatCurrency(line.total)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {review ? (
        <>
          <div className="mt-5 border-t border-border pt-5">
            <h4 className="text-sm font-black text-foreground">مهمانان</h4>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <ReviewValue label="بزرگسال" value={first.adults.toLocaleString("fa-IR")} />
              <ReviewValue label="کودک و سن" value={childrenDescription} />
            </dl>
          </div>
          <dl className="mt-5 border-t border-border pt-5">
            <ReviewValue label="مبلغ کل" value={formatCurrency(items.reduce((sum, item) => sum + item.displayAmount, 0))} />
          </dl>
        </>
      ) : null}
    </section>
  );
}

function BookingRecipientOption({ checked, description, label, onChange }: { checked: boolean; description: string; label: string; onChange: () => void }) {
  return (
    <label className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border p-4 transition focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background ${checked ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted"}`}>
      <input checked={checked} className="mt-1 h-4 w-4 accent-primary" name="booking-recipient" onChange={onChange} type="radio" />
      <span className="min-w-0">
        <span className="block font-black text-foreground">{label}</span>
        <span className="mt-1 block text-xs leading-6 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function ReviewSurface({ children, title }: { children: React.ReactNode; title: string }) {
  return <section className="rounded-lg border border-border bg-background p-4"><h3 className="text-base font-black text-foreground">{title}</h3><div className="mt-4">{children}</div></section>;
}

function ReviewGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid gap-4 sm:grid-cols-2">{children}</dl>;
}

function ReviewValue({ className = "", dir, label, value }: { className?: string; dir?: "ltr" | "rtl"; label: string; value: string }) {
  return <div className={`min-w-0 ${className}`}><dt className="text-xs font-bold text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-black text-foreground" dir={dir}>{value}</dd></div>;
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function normalizeMobile(value: string): string | null {
  let normalized = toLatinDigits(value).replace(/[^+\d]/g, "");
  if (normalized.startsWith("0098")) normalized = `0${normalized.slice(4)}`;
  else if (normalized.startsWith("+98")) normalized = `0${normalized.slice(3)}`;
  else if (normalized.startsWith("98") && normalized.length === 12) normalized = `0${normalized.slice(2)}`;
  return normalized || null;
}

function isValidMobile(value: string) {
  const digits = value.startsWith("+") ? value.slice(1) : value;
  return /^\d{8,15}$/.test(digits);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toLatinDigits(value: string) {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 1776 ? code - 1776 : code - 1632);
  });
}

function toPersianDigits(value: string) {
  return value.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}
