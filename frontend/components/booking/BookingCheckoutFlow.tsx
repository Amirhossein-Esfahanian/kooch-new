"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const resumedCheckout = useRef(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizationMessage, setFinalizationMessage] = useState<{
    tone: "error" | "info";
    text: string;
  } | null>(null);
  const currentStep: BookingCheckoutStep =
    searchParams.get("step") === "review" ? "review" : "information";

  const finalizeCheckout = useCallback(async () => {
    if (cart.items.length === 0 || finalizing) return;

    if (!auth.authenticated) {
      cart.setCheckoutRequested(true);
      router.push(
        `/login?returnTo=${encodeURIComponent("/booking/checkout?step=review")}`,
      );
      return;
    }

    if (!cart.idempotencyKey) return;

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
      );
      sessionStorage.setItem(lastBookingSessionCodeKey, created.sessionCode);
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
      setFinalizing(false);
    }
  }, [auth.authenticated, cart, finalizing, router]);

  useEffect(() => {
    if (
      currentStep !== "review" ||
      !cart.hydrated ||
      auth.loading ||
      !auth.authenticated ||
      !cart.checkoutRequested ||
      resumedCheckout.current
    ) {
      return;
    }

    resumedCheckout.current = true;
    void finalizeCheckout();
  }, [
    auth.authenticated,
    auth.loading,
    cart.checkoutRequested,
    cart.hydrated,
    currentStep,
    finalizeCheckout,
  ]);

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
              <InformationStep />
            ) : (
              <ReviewStep />
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
                <KoochButton onClick={() => router.push("/booking/checkout?step=review")}>
                  ادامه به نهایی‌سازی
                </KoochButton>
              ) : (
                <KoochButton
                  loading={finalizing}
                  onClick={() => void finalizeCheckout()}
                >
                  ثبت نهایی رزرو
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

function InformationStep() {
  return (
    <div>
      <h2 className="text-xl font-black text-foreground" id="checkout-step-title">
        اطلاعات رزروکننده
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
        در این مرحله اطلاعات لازم برای ادامه رزرو تکمیل خواهد شد.
      </p>
      <KoochAlert className="mt-6" title="این بخش در مرحله بعد تکمیل می‌شود" variant="info">
        اطلاعات رزروکننده در مرحله بعد تکمیل می‌شود. انتخاب‌های اقامت و مبلغ فعلی تا آن زمان در سبد رزرو شما حفظ می‌شوند.
      </KoochAlert>
    </div>
  );
}

function ReviewStep() {
  return (
    <div>
      <h2 className="text-xl font-black text-foreground" id="checkout-step-title">
        مرور و نهایی‌سازی
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
        پیش از ثبت نهایی، انتخاب‌ها و مبلغ رزرو را در خلاصه بررسی کنید.
      </p>
      <KoochAlert className="mt-6" title="ثبت نهایی با رفتار فعلی" variant="info">
        تا پیش از انتخاب «ثبت نهایی رزرو» هیچ سفارشی ایجاد نمی‌شود. پس از آن، در صورت نیاز ورود انجام می‌شود و موجودی و قیمت پیش از ساخت سفارش دوباره بررسی می‌شوند.
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
