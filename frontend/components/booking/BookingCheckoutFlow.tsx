"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { BookingCartSummary } from "@/components/booking/BookingCart";
import {
  BookingCartProvider,
  lastBookingSessionCodeKey,
  type BookingCartItem,
  useBookingCart,
} from "@/components/booking/BookingCartProvider";
import {
  createBookingSessionFromCart,
  revalidateBookingCart,
} from "@/components/booking/booking-checkout";
import {
  BookingCheckoutStepper,
  type BookingCheckoutStep,
} from "@/components/booking/BookingCheckoutStepper";
import {
  CheckoutIdentityStep,
  hasCompleteCheckoutIdentity,
} from "@/components/booking/CheckoutIdentityStep";
import {
  CheckoutStayDetails,
  CheckoutStayDetailsReview,
  checkoutStayDetailsStorageKey,
  emptyCheckoutStayDetailsDraft,
  restoreCheckoutStayDetailsDraft,
  serializeCheckoutStayDetailsDraft,
  toBookingCheckoutStayDetails,
  validateCheckoutStayDetailsDraft,
  type CheckoutStayDetailsDraft,
} from "@/components/booking/CheckoutStayDetails";
import { bookingModePresentation } from "@/components/booking/booking-display";
import { formatCurrency } from "@/lib/currency";

export function BookingCheckoutFlow() {
  return (
    <BookingCartProvider>
      <BookingCheckoutContent />
    </BookingCartProvider>
  );
}

function BookingCheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useAuthSession();
  const cart = useBookingCart();
  const submissionLockRef = useRef(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizationMessage, setFinalizationMessage] = useState<{
    tone: "error" | "info";
    text: string;
  } | null>(null);
  const [stayDetailsDraft, setStayDetailsDraft] = useState<CheckoutStayDetailsDraft>(
    emptyCheckoutStayDetailsDraft,
  );
  const [stayDetailsHydrated, setStayDetailsHydrated] = useState(false);
  const [showStayDetailsErrors, setShowStayDetailsErrors] = useState(false);
  const requestedReview = searchParams.get("step") === "review";
  const identityComplete = hasCompleteCheckoutIdentity(auth);
  const stayDetailsErrors = useMemo(
    () => validateCheckoutStayDetailsDraft(stayDetailsDraft),
    [stayDetailsDraft],
  );
  const stayDetailsComplete = Object.keys(stayDetailsErrors).length === 0;
  const currentStep: BookingCheckoutStep =
    requestedReview && identityComplete && stayDetailsHydrated && stayDetailsComplete
      ? "review"
      : "information";
  const identityInterruptionMessage =
    requestedReview && !auth.loading && !identityComplete
      ? "نشست شما در دسترس نیست یا اطلاعات هویتی کامل نشده است. سبد رزرو حفظ شده؛ شماره موبایل را تأیید کنید و سپس ادامه دهید."
      : null;

  useEffect(() => {
    setStayDetailsDraft(
      restoreCheckoutStayDetailsDraft(
        sessionStorage.getItem(checkoutStayDetailsStorageKey),
      ),
    );
    setStayDetailsHydrated(true);
  }, []);

  useEffect(() => {
    if (!stayDetailsHydrated) return;
    sessionStorage.setItem(
      checkoutStayDetailsStorageKey,
      serializeCheckoutStayDetailsDraft(stayDetailsDraft),
    );
  }, [stayDetailsDraft, stayDetailsHydrated]);

  const updateStayDetails = useCallback((next: CheckoutStayDetailsDraft) => {
    setStayDetailsDraft(next);
    setShowStayDetailsErrors(false);
    cart.renewIdempotencyKey();
  }, [cart]);

  const continueToReview = useCallback(() => {
    if (!identityComplete) return;
    if (!stayDetailsComplete) {
      setShowStayDetailsErrors(true);
      return;
    }
    router.push("/booking/checkout?step=review");
  }, [identityComplete, router, stayDetailsComplete]);

  const finalizeCheckout = useCallback(async () => {
    if (cart.items.length === 0 || submissionLockRef.current) return;

    if (!hasCompleteCheckoutIdentity(auth)) {
      cart.setCheckoutRequested(false);
      router.push("/booking/checkout?step=information");
      return;
    }

    if (!cart.idempotencyKey) return;

    submissionLockRef.current = true;
    setFinalizing(true);
    setFinalizationMessage(null);
    try {
      const refreshed = await revalidateBookingCart(cart.items);
      cart.replaceItems(refreshed.items);
      if (refreshed.priceChanged) {
        cart.setCheckoutRequested(false);
        setFinalizationMessage({
          tone: "info",
          text: "قیمت به‌روز شده است. مبلغ جدید را بررسی و دوباره ثبت نهایی را انتخاب کنید.",
        });
        return;
      }

      const created = await createBookingSessionFromCart(
        refreshed.items,
        cart.idempotencyKey,
        toBookingCheckoutStayDetails(stayDetailsDraft),
      );
      sessionStorage.setItem(lastBookingSessionCodeKey, created.sessionCode);
      sessionStorage.removeItem(checkoutStayDetailsStorageKey);
      cart.clear();
      router.push(
        `/account/booking-sessions/${encodeURIComponent(created.sessionCode)}`,
      );
    } catch (error) {
      cart.setCheckoutRequested(false);
      setFinalizationMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "ساخت سفارش رزرو انجام نشد.",
      });
    } finally {
      submissionLockRef.current = false;
      setFinalizing(false);
    }
  }, [auth, cart, router, stayDetailsDraft]);

  if (!cart.hydrated) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div
          aria-live="polite"
          className="rounded-lg border border-border bg-card p-6 text-sm font-bold text-muted-foreground"
          role="status"
        >
          در حال بازیابی انتخاب‌های رزرو شما...
        </div>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">
          تکمیل رزرو
        </h1>
        <KoochAlert className="mt-6" title="انتخاب رزروی پیدا نشد" variant="info">
          سبد رزرو خالی یا منقضی شده است. برای انتخاب اقامت و اتاق به فهرست اقامتگاه‌ها برگردید.
        </KoochAlert>
        <KoochButton className="mt-5" onClick={() => router.push("/properties")}>
          بازگشت به اقامتگاه‌ها
        </KoochButton>
      </div>
    );
  }

  const propertyReturnHref = buildPropertyReturnHref(cart.items);
  const bookingMode = cart.items[0].bookingMode;
  const finalActionLabel =
    bookingMode === "OnRequest" ? "ارسال درخواست رزرو" : "ادامه به پرداخت";

  return (
    <div className="bg-background px-4 py-8 text-foreground sm:px-6 sm:py-12" dir="rtl">
      <div className="mx-auto max-w-6xl">
        <header className="mx-auto max-w-3xl">
          <p className="text-sm font-bold text-primary">
            {currentStep === "information" ? "مرحله ۲ از ۳" : "مرحله ۳ از ۳"}
          </p>
          <h1 className="mt-2 text-2xl font-black sm:text-3xl">
            تکمیل رزرو
          </h1>
          <div className="mt-6 rounded-lg border border-border bg-card p-4 sm:p-5">
            <BookingCheckoutStepper currentStep={currentStep} />
          </div>
        </header>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
          <section
            aria-labelledby="checkout-step-title"
            className="rounded-lg border border-border bg-card p-5 sm:p-6"
          >
            {currentStep === "information" ? (
              <>
                <CheckoutIdentityStep
                  interruptionMessage={identityInterruptionMessage}
                  onAuthenticated={() => cart.setCheckoutRequested(false)}
                />
                {identityComplete && auth.user && stayDetailsHydrated ? (
                  <CheckoutStayDetails
                    draft={stayDetailsDraft}
                    errors={showStayDetailsErrors ? stayDetailsErrors : {}}
                    items={cart.items}
                    onChange={updateStayDetails}
                    user={auth.user}
                  />
                ) : null}
              </>
            ) : (
              <ReviewStep
                draft={stayDetailsDraft}
                items={cart.items}
                user={auth.user!}
              />
            )}

            {currentStep === "review" && finalizationMessage ? (
              <KoochAlert
                className="mt-6"
                title={
                  finalizationMessage.tone === "error"
                    ? "ثبت سفارش انجام نشد"
                    : "قیمت رزرو به‌روز شد"
                }
                variant={
                  finalizationMessage.tone === "error" ? "destructive" : "info"
                }
              >
                {finalizationMessage.text}
              </KoochAlert>
            ) : null}

            {currentStep === "review" ? (
              <div
                className="mt-6 flex items-center justify-between gap-4 rounded-lg bg-muted px-4 py-3 sm:hidden"
                data-testid="checkout-mobile-total"
              >
                <span className="text-sm font-bold text-muted-foreground">مبلغ کل</span>
                <strong className="text-base font-black text-foreground">
                  {formatCurrency(cart.total)}
                </strong>
              </div>
            ) : null}

            <div
              className="mt-8 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:justify-between"
              data-testid="checkout-mobile-actions"
            >
              <KoochButton
                onClick={() =>
                  router.push(
                    currentStep === "information"
                      ? propertyReturnHref
                      : "/booking/checkout?step=information",
                  )
                }
                variant="outline"
              >
                {currentStep === "information" ? "بازگشت به انتخاب اقامت" : "بازگشت به اطلاعات"}
              </KoochButton>
              {currentStep === "information" ? (
                <KoochButton
                  disabled={!identityComplete}
                  onClick={continueToReview}
                >
                  ادامه به نهایی‌سازی
                </KoochButton>
              ) : (
                <KoochButton
                  disabled={finalizing}
                  loading={finalizing}
                  onClick={() => void finalizeCheckout()}
                >
                  {finalActionLabel}
                </KoochButton>
              )}
            </div>
          </section>

          <aside aria-label="خلاصه رزرو" className="lg:sticky lg:top-24">
            <BookingCartSummary
              className=""
              items={cart.items}
              title="خلاصه رزرو"
              total={cart.total}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}

function ReviewStep({
  draft,
  items,
  user,
}: {
  draft: CheckoutStayDetailsDraft;
  items: BookingCartItem[];
  user: NonNullable<ReturnType<typeof useAuthSession>["user"]>;
}) {
  const mode = bookingModePresentation(items[0].bookingMode);
  const isOnRequest = items[0].bookingMode === "OnRequest";

  return (
    <div>
      <h2 className="text-xl font-black text-foreground" id="checkout-step-title">
        مرور و نهایی‌سازی
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
        پیش از ادامه، اطلاعات اقامت، مهمانان و مبلغ سفارش را بررسی کنید.
      </p>
      <CheckoutStayDetailsReview draft={draft} items={items} user={user} />
      <KoochAlert className="mt-6" title={`${mode.icon} ${mode.label}`} variant="info">
        {isOnRequest ? (
          <div className="grid gap-2">
            <p>درخواست رزرو برای اقامتگاه ارسال می‌شود.</p>
            <p>تا پیش از تأیید اقامتگاه، پرداختی انجام نمی‌شود.</p>
            <p>مهلت پاسخ اقامتگاه طبق سازوکار فعلی سیستم اعمال می‌شود.</p>
            <p>پس از تأیید، می‌توانید از صفحه سفارش وارد مرحله پرداخت شوید.</p>
          </div>
        ) : (
          <p>پس از ثبت رزرو، برای تکمیل رزرو وارد مرحله پرداخت می‌شوید.</p>
        )}
      </KoochAlert>
    </div>
  );
}

export function buildPropertyReturnHref(items: BookingCartItem[]) {
  const firstItem = items[0];
  if (!firstItem) return "/properties";

  const query = new URLSearchParams({
    checkIn: firstItem.checkIn,
    checkOut: firstItem.checkOut,
    adults: String(firstItem.adults),
    children: String(firstItem.children),
    rooms: String(items.length),
  });
  firstItem.childAges.forEach((age) => query.append("childAges", String(age)));
  return `/properties/${encodeURIComponent(firstItem.propertySlug)}?${query.toString()}`;
}
