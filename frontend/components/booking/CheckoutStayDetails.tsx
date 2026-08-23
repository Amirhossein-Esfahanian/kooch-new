"use client";

import {
  KoochField,
  KoochInput,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import type { BookingCheckoutStayDetails } from "@/components/booking/booking-checkout";

export const checkoutStayDetailsStorageKey = "kooch_booking_checkout_stay_details_v1";
const checkoutStayDetailsVersion = 2;

export interface CheckoutGuestDraft {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  nationalCode: string;
}

export interface CheckoutStayDetailsDraft {
  bookingForSelf: boolean;
  primaryGuest: CheckoutGuestDraft;
  selfGuest?: CheckoutGuestDraft;
  otherGuest?: CheckoutGuestDraft;
  expectedArrivalTime: string;
  specialRequest: string;
}

export type CheckoutStayDetailsErrors = Partial<
  Record<"firstName" | "lastName" | "mobile" | "email" | "contact" | "nationalCode" | "specialRequest", string>
>;

export const emptyCheckoutGuestDraft: CheckoutGuestDraft = {
  firstName: "",
  lastName: "",
  mobile: "",
  email: "",
  nationalCode: "",
};

export const emptyCheckoutStayDetailsDraft: CheckoutStayDetailsDraft = {
  bookingForSelf: true,
  primaryGuest: emptyCheckoutGuestDraft,
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
      selfGuest?: unknown;
      otherGuest?: unknown;
      expectedArrivalTime?: unknown;
      specialRequest?: unknown;
    };
    if (
      (parsed.version !== 1 && parsed.version !== checkoutStayDetailsVersion) ||
      typeof parsed.bookingForSelf !== "boolean" ||
      !isSafeText(parsed.primaryGuest?.firstName, 100) ||
      !isSafeText(parsed.primaryGuest?.lastName, 100) ||
      !isSafeText(parsed.primaryGuest?.mobile, 30) ||
      !isSafeText(parsed.primaryGuest?.email, 320) ||
      !isSafeText(parsed.primaryGuest?.nationalCode ?? "", 20) ||
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
        nationalCode: (parsed.primaryGuest?.nationalCode as string | undefined) ?? "",
      },
      selfGuest: restoreGuestDraft(parsed.selfGuest),
      otherGuest: restoreGuestDraft(parsed.otherGuest),
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
  if (!draft.primaryGuest.firstName.trim()) {
    errors.firstName = "نام مهمان اصلی را وارد کنید.";
  }
  if (!draft.primaryGuest.lastName.trim()) {
    errors.lastName = "نام خانوادگی مهمان اصلی را وارد کنید.";
  }
  const mobile = normalizeMobile(draft.primaryGuest.mobile);
  const email = draft.primaryGuest.email.trim();
  if (draft.bookingForSelf && !mobile) {
    errors.mobile = "شماره موبایل مهمان اصلی را وارد کنید.";
  } else if (!draft.bookingForSelf && !mobile && !email) {
    errors.contact = "حداقل شماره موبایل یا ایمیل مهمان اصلی را وارد کنید.";
  }
  if (mobile && !isValidMobile(mobile)) {
    errors.mobile = "فرمت شماره موبایل معتبر نیست.";
  }
  if (email && !isValidEmail(email)) {
    errors.email = "فرمت ایمیل معتبر نیست.";
  }
  if (draft.primaryGuest.nationalCode.length > 20) {
    errors.nationalCode = "کد ملی نمی‌تواند بیشتر از ۲۰ نویسه باشد.";
  }
  return errors;
}

export function toBookingCheckoutStayDetails(
  draft: CheckoutStayDetailsDraft,
): BookingCheckoutStayDetails {
  return {
    bookingForSelf: draft.bookingForSelf,
    primaryGuest: {
      firstName: draft.primaryGuest.firstName.trim(),
      lastName: draft.primaryGuest.lastName.trim(),
      mobile: normalizeMobile(draft.primaryGuest.mobile) || null,
      email: draft.primaryGuest.email.trim().toLowerCase() || null,
      nationalCode: draft.primaryGuest.nationalCode.trim() || null,
    },
    expectedArrivalTime: draft.expectedArrivalTime || null,
    specialRequest: draft.specialRequest.trim() || null,
  };
}

export function CheckoutStayDetails({
  draft,
  errors,
  onChange,
}: {
  draft: CheckoutStayDetailsDraft;
  errors: CheckoutStayDetailsErrors;
  onChange: (draft: CheckoutStayDetailsDraft) => void;
}) {
  const updateGuest = (field: keyof CheckoutStayDetailsDraft["primaryGuest"], value: string) =>
    onChange({
      ...draft,
      primaryGuest: { ...draft.primaryGuest, [field]: value },
      ...(draft.bookingForSelf
        ? { selfGuest: { ...draft.primaryGuest, [field]: value } }
        : { otherGuest: { ...draft.primaryGuest, [field]: value } }),
    });

  const toggleOtherGuest = (checked: boolean) => {
    if (checked === !draft.bookingForSelf) return;
    if (checked) {
      onChange({
        ...draft,
        bookingForSelf: false,
        selfGuest: { ...draft.primaryGuest },
        primaryGuest: { ...(draft.otherGuest ?? emptyCheckoutGuestDraft) },
      });
      return;
    }
    onChange({
      ...draft,
      bookingForSelf: true,
      otherGuest: { ...draft.primaryGuest },
      primaryGuest: { ...(draft.selfGuest ?? emptyCheckoutGuestDraft) },
    });
  };

  return (
    <div className="min-w-0">
      <section aria-labelledby="primary-guest-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-foreground" id="primary-guest-title">
              اطلاعات مهمان
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              اطلاعات مهمان اصلی این اقامت را وارد کنید.
            </p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-foreground">
            <input
              checked={!draft.bookingForSelf}
              className="h-4 w-4 accent-[var(--theme-primary)]"
              data-testid="checkout-other-guest-toggle"
              onChange={(event) => toggleOtherGuest(event.target.checked)}
              type="checkbox"
            />
            مهمان اصلی شخص دیگری است
          </label>
        </div>

        <div className="mt-4 grid min-w-0 items-start gap-4 sm:grid-cols-2" data-testid="checkout-primary-guest-panel">
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
          <KoochField
            error={errors.mobile ?? errors.contact}
            helperText={draft.bookingForSelf ? undefined : "شماره موبایل یا ایمیل؛ وارد کردن یکی کافی است."}
            label="شماره موبایل"
            required={draft.bookingForSelf}
          >
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
          <KoochField className="sm:max-w-sm" error={errors.nationalCode} label="کد ملی (اختیاری)">
            <KoochInput
              autoComplete="off"
              dir="ltr"
              maxLength={20}
              onChange={(event) => updateGuest("nationalCode", event.target.value)}
              value={draft.primaryGuest.nationalCode}
            />
          </KoochField>
        </div>
      </section>

      <section className="mt-6 border-t border-border pt-5" aria-labelledby="special-request-title">
        <h3 className="text-base font-black text-foreground" id="special-request-title">درخواست ویژه</h3>
        <KoochField
          className="mt-3"
          error={errors.specialRequest}
          helperText={`ثبت درخواست به معنی تضمین انجام آن نیست. ${toPersianDigits(String(draft.specialRequest.length))} از ۲۰۰۰ نویسه`}
        >
          <KoochTextarea
            aria-label="درخواست ویژه"
            className="min-h-20"
            maxLength={2000}
            onChange={(event) => onChange({ ...draft, specialRequest: event.target.value })}
            placeholder="در صورت نیاز، درخواست خود را بنویسید."
            rows={3}
            value={draft.specialRequest}
          />
        </KoochField>
      </section>

      <section className="mt-6 border-t border-border pt-5" aria-labelledby="arrival-time-title">
        <h3 className="text-base font-black text-foreground" id="arrival-time-title">زمان تقریبی ورود</h3>
        <KoochField className="mt-3 max-w-sm">
          <KoochSelect
            aria-label="زمان تقریبی ورود"
            onChange={(event) => onChange({ ...draft, expectedArrivalTime: event.target.value })}
            value={draft.expectedArrivalTime}
          >
            <option value="">هنوز مشخص نیست</option>
            {arrivalOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </KoochSelect>
        </KoochField>
      </section>
    </div>
  );
}

export function CheckoutStayDetailsReview({
  draft,
}: {
  draft: CheckoutStayDetailsDraft;
}) {
  const guest = toBookingCheckoutStayDetails(draft).primaryGuest;
  const arrival = draft.expectedArrivalTime
    ? toPersianDigits(draft.expectedArrivalTime.slice(0, 5))
    : "مشخص نشده";

  return (
    <div className="mt-6 grid gap-5">
      <ReviewSurface title="اطلاعات مهمان">
        {guest ? (
          <ReviewGrid>
            <ReviewValue label="نام و نام خانوادگی" value={`${guest.firstName} ${guest.lastName}`} />
            {guest.mobile ? <ReviewValue dir="ltr" label="شماره موبایل" value={toPersianDigits(guest.mobile)} /> : null}
            {guest.email ? <ReviewValue className="sm:col-span-2" dir="ltr" label="ایمیل" value={guest.email} /> : null}
          </ReviewGrid>
        ) : null}
      </ReviewSurface>

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

function restoreGuestDraft(value: unknown): CheckoutGuestDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const guest = value as Partial<Record<keyof CheckoutGuestDraft, unknown>>;
  if (
    !isSafeText(guest.firstName, 100) ||
    !isSafeText(guest.lastName, 100) ||
    !isSafeText(guest.mobile, 30) ||
    !isSafeText(guest.email, 320) ||
    !isSafeText(guest.nationalCode, 20)
  ) return undefined;
  return {
    firstName: guest.firstName,
    lastName: guest.lastName,
    mobile: guest.mobile,
    email: guest.email,
    nationalCode: guest.nationalCode,
  };
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
