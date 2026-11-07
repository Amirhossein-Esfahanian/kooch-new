"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { BookingCheckoutSummary } from "@/components/booking/BookingCheckoutSummary";
import {
  BookingCartProvider,
  lastBookingSessionCodeKey,
  type BookingCartItem,
  useBookingCart,
} from "@/components/booking/BookingCartProvider";
import {
  createBookingSessionFromCart,
  buildBookingSessionRequestFromCart,
  revalidateBookingCart,
} from "@/components/booking/booking-checkout";
import {
  createPropertyDirectBookingSession,
  replayPropertyDirectBookingSession,
  DirectBookingCheckoutError,
} from "@/components/booking/direct-booking-checkout";
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
  type CheckoutGuestDraft,
  validateCheckoutStayDetailsDraft,
  type CheckoutStayDetailsDraft,
} from "@/components/booking/CheckoutStayDetails";
import { bookingModePresentation } from "@/components/booking/booking-display";
import { fetchPublicApi, type PublicProperty } from "@/lib/public-properties";
import type { ReceptionHours } from "@/lib/reception-hours";
import { validBookingPropertyEntry, writeBookingContext, type BookingPropertyEntry } from "@/lib/booking-context";
import { useBookingSupportPhone } from "@/components/booking/BookingSupportContact";

export function BookingCheckoutFlow() {
  return (
    <BookingCartProvider>
      <BookingCheckoutContent />
    </BookingCartProvider>
  );
}

export function BookingCheckoutContent({
  presentation = "page",
  onEditSelection,
  onBusyChange,
  identityResetKey = 0,
}: {
  presentation?: "page" | "dialog";
  onEditSelection?: () => void;
  onBusyChange?: (busy: boolean) => void;
  identityResetKey?: number;
} = {}) {
  const isDialog = presentation === "dialog";
  const [dialogStep, setDialogStep] = useState<"information" | "review">("information");
  const [identityBusy, setIdentityBusy] = useState(false);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef<BookingCheckoutStep | null>(null);
  const support = useBookingSupportPhone();
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useAuthSession();
  const cart = useBookingCart();
  const submissionLockRef = useRef(false);
  const checkoutMountedRef = useRef(false);
  const submissionIdentityRef = useRef("");
  const confirmedSessionRef = useRef<{ userId: number; key: string; sessionCode: string; href: string } | null>(null);
  const linkedGuestInitializedRef = useRef(false);
  const [finalizing, setFinalizing] = useState(false);
  const [showExistingOrderRecovery, setShowExistingOrderRecovery] = useState(false);
  const [finalizationMessage, setFinalizationMessage] = useState<{
    tone: "error" | "info";
    text: string;
  } | null>(null);
  const [stayDetailsDraft, setStayDetailsDraft] =
    useState<CheckoutStayDetailsDraft>(emptyCheckoutStayDetailsDraft);
  const [stayDetailsHydrated, setStayDetailsHydrated] = useState(false);
  const [receptionData, setReceptionData] = useState<{
    propertyId: number;
    hours: ReceptionHours;
  } | null>(null);
  const [receptionLoadFailed, setReceptionLoadFailed] = useState(false);
  const [showStayDetailsErrors, setShowStayDetailsErrors] = useState(false);
  const requestedReview = isDialog ? dialogStep === "review" : searchParams.get("step") === "review";
  const identityComplete = hasCompleteCheckoutIdentity(auth);
  const stayDetailsErrors = useMemo(
    () => validateCheckoutStayDetailsDraft(stayDetailsDraft),
    [stayDetailsDraft],
  );
  const stayDetailsComplete = Object.keys(stayDetailsErrors).length === 0;
  const checkoutPropertyId = cart.items[0]?.propertyId;
  const checkoutPropertySlug = cart.items[0]?.propertySlug;
  submissionIdentityRef.current = JSON.stringify([auth.user?.userId, cart.idempotencyKey,
    checkoutPropertyId, checkoutPropertySlug, cart.propertyEntry?.kind]);
  const receptionHours = receptionData && receptionData.propertyId === checkoutPropertyId
    ? receptionData.hours
    : null;
  const currentStep: BookingCheckoutStep =
    requestedReview &&
    identityComplete &&
    stayDetailsHydrated &&
    stayDetailsComplete
      ? "review"
      : "information";
  const ContentTag = isDialog ? "div" : "main";
  const identityInterruptionMessage =
    requestedReview && !auth.loading && !identityComplete
      ? "نشست شما در دسترس نیست یا اطلاعات هویتی کامل نشده است. سبد رزرو حفظ شده؛ شماره موبایل را تأیید کنید و سپس ادامه دهید."
      : null;

  const showInformation = useCallback(() => {
    if (isDialog) setDialogStep("information");
    else router.push("/booking/checkout?step=information");
  }, [isDialog, router]);

  useEffect(() => {
    onBusyChange?.(finalizing || identityBusy);
    return () => onBusyChange?.(false);
  }, [finalizing, identityBusy, onBusyChange]);

  useEffect(() => { if (isDialog) setDialogStep("information"); }, [identityResetKey, isDialog]);

  useEffect(() => {
    if (isDialog && previousStepRef.current !== null && previousStepRef.current !== currentStep) {
      stepHeadingRef.current?.focus();
    }
    previousStepRef.current = currentStep;
  }, [currentStep, isDialog]);

  useEffect(() => {
    checkoutMountedRef.current = true;
    return () => { checkoutMountedRef.current = false; };
  }, []);

  useEffect(() => {
    setStayDetailsDraft(
      isDialog ? emptyCheckoutStayDetailsDraft : restoreCheckoutStayDetailsDraft(
        sessionStorage.getItem(checkoutStayDetailsStorageKey),
      ),
    );
    setStayDetailsHydrated(true);
  }, [isDialog]);

  useEffect(() => {
    if (!cart.hydrated || !checkoutPropertySlug || !checkoutPropertyId) return;
    let cancelled = false;
    setReceptionData(null);
    setReceptionLoadFailed(false);
    fetchPublicApi<Pick<PublicProperty, "id" | keyof ReceptionHours>>(
      `/properties/${encodeURIComponent(checkoutPropertySlug)}`,
    ).then((property) => {
      if (cancelled) return;
      if (property.id !== checkoutPropertyId) throw new Error("Property mismatch.");
      setReceptionData({
        propertyId: property.id,
        hours: {
          regularReceptionFrom: property.regularReceptionFrom,
          regularReceptionUntil: property.regularReceptionUntil,
        },
      });
      setReceptionLoadFailed(false);
    }).catch(() => {
      if (!cancelled) {
        setReceptionData(null);
        setReceptionLoadFailed(true);
      }
    });
    return () => { cancelled = true; };
  }, [cart.hydrated, checkoutPropertyId, checkoutPropertySlug]);

  useEffect(() => {
    if (
      !stayDetailsHydrated ||
      !identityComplete ||
      !auth.user ||
      linkedGuestInitializedRef.current
    )
      return;

    linkedGuestInitializedRef.current = true;
    const linkedGuest = buildSelfGuestDraft(auth.user);
    setStayDetailsDraft((current) => {
      if (current.bookingForSelf && hasGuestDraftValue(current.primaryGuest)) {
        return { ...current, selfGuest: { ...current.primaryGuest } };
      }
      if (current.bookingForSelf) {
        return {
          ...current,
          primaryGuest: { ...linkedGuest },
          selfGuest: { ...linkedGuest },
        };
      }
      return current.selfGuest
        ? current
        : { ...current, selfGuest: { ...linkedGuest } };
    });
  }, [auth.user, identityComplete, stayDetailsHydrated]);

  useEffect(() => {
    if (!stayDetailsHydrated || isDialog) return;
    sessionStorage.setItem(
      checkoutStayDetailsStorageKey,
      serializeCheckoutStayDetailsDraft(stayDetailsDraft),
    );
  }, [isDialog, stayDetailsDraft, stayDetailsHydrated]);

  const updateStayDetails = useCallback(
    (next: CheckoutStayDetailsDraft) => {
      setStayDetailsDraft(next);
      setShowStayDetailsErrors(false);
      // An ambiguous Direct creation must be resolved before a different key can create again.
      // Its private traveler draft is deliberately not persisted by the dialog.
      const unresolvedDirectAttempt = isDialog &&
        cart.directCreationAttempt?.userId === auth.user?.userId &&
        cart.directCreationAttempt?.idempotencyKey === cart.idempotencyKey;
      if (!unresolvedDirectAttempt) cart.renewIdempotencyKey();
    },
    [auth.user?.userId, cart, isDialog],
  );

  const continueToReview = useCallback(() => {
    if (!identityComplete) return;
    if (!stayDetailsComplete) {
      setShowStayDetailsErrors(true);
      return;
    }
    if (isDialog) setDialogStep("review");
    else router.push("/booking/checkout?step=review");
  }, [identityComplete, isDialog, router, stayDetailsComplete]);

  const finalizeCheckout = useCallback(async () => {
    if (cart.items.length === 0 || submissionLockRef.current) return;

    if (auth.loading || !hasCompleteCheckoutIdentity(auth)) {
      if (!isDialog) cart.setCheckoutRequested(false);
      showInformation();
      return;
    }

    if (!cart.idempotencyKey) return;

    const userId = auth.user!.userId;
    if (confirmedSessionRef.current?.key === cart.idempotencyKey && confirmedSessionRef.current.userId === userId) {
      router.push(confirmedSessionRef.current.href);
      return;
    }
    const entry = validBookingPropertyEntry(cart.propertyEntry, cart.items);
    const directEntry = entry?.kind === "book" ? entry : null;
    if (isDialog && !directEntry) {
      setFinalizationMessage({ tone: "error", text: "انتخاب رزرو مستقیم معتبر نیست؛ به انتخاب اقامت برگردید." });
      return;
    }
    const submissionIdentity = submissionIdentityRef.current;
    const isCurrent = () => checkoutMountedRef.current && submissionIdentityRef.current === submissionIdentity;

    const complete = (sessionCode: string) => {
      if (!isCurrent()) throw new DirectBookingCheckoutError("اطلاعات حساب یا رزرو تغییر کرده است. سفارش‌های حساب قبلی را بررسی کنید.");
      const href = directEntry
        ? `/book/${encodeURIComponent(directEntry.propertySlug)}/reservations/${encodeURIComponent(sessionCode)}`
        : `/account/booking-sessions/${encodeURIComponent(sessionCode)}`;
      confirmedSessionRef.current = { userId, key: cart.idempotencyKey!, sessionCode, href };
      // Browser storage failure must not turn a confirmed server creation into a failed attempt.
      try {
        sessionStorage.setItem(lastBookingSessionCodeKey, sessionCode);
        sessionStorage.removeItem(checkoutStayDetailsStorageKey);
      } catch { /* The canonical Session URL remains available without this convenience storage. */ }
      try { cart.clear(); } catch { /* A retained cart can only replay the same keyed attempt. */ }
      router.push(href);
    };

    submissionLockRef.current = true;
    setFinalizing(true);
    setShowExistingOrderRecovery(false);
    setFinalizationMessage(null);
    try {
      const details = toBookingCheckoutStayDetails(stayDetailsDraft);
      if (directEntry && cart.directCreationAttempt?.userId === userId &&
          cart.directCreationAttempt.idempotencyKey === cart.idempotencyKey) {
        const replay = await replayPropertyDirectBookingSession(
          buildBookingSessionRequestFromCart(cart.items, cart.idempotencyKey, details), directEntry.propertyId);
        if (replay) {
          complete(replay.sessionCode);
          return;
        }
      }
      const refreshed = await revalidateBookingCart(cart.items);
      if (!isCurrent()) throw new DirectBookingCheckoutError("اطلاعات حساب یا رزرو تغییر کرده است. انتخاب فعلی را دوباره بررسی کنید.");
      cart.replaceItems(refreshed.items);
      if (refreshed.priceChanged) {
        if (!isDialog) cart.setCheckoutRequested(false);
        setFinalizationMessage({
          tone: "info",
          text: "قیمت به‌روز شده است. مبلغ جدید را بررسی و دوباره ثبت نهایی را انتخاب کنید.",
        });
        return;
      }

      const created = directEntry
        ? await createPropertyDirectBookingSession(
            buildBookingSessionRequestFromCart(refreshed.items, cart.idempotencyKey, details),
            { propertyId: refreshed.items[0].propertyId, propertySlug: refreshed.items[0].propertySlug },
            () => cart.markDirectCreationAttempt(userId), isCurrent)
        : await createBookingSessionFromCart(refreshed.items, cart.idempotencyKey, details);
      complete(created.sessionCode);
    } catch (error) {
      if (!checkoutMountedRef.current) return;
      if (isDialog && error instanceof DirectBookingCheckoutError && error.status === 409) {
        setShowExistingOrderRecovery(true);
      }
      if (!directEntry) cart.setCheckoutRequested(false);
      if (error instanceof DirectBookingCheckoutError && error.status === 401) {
        await auth.refreshSession({ redirectOnUnauthorized: false }).catch(() => null);
        showInformation();
      }
      setFinalizationMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "ساخت سفارش رزرو انجام نشد.",
      });
    } finally {
      submissionLockRef.current = false;
      setFinalizing(false);
    }
  }, [auth, cart, isDialog, router, showInformation, stayDetailsDraft]);

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
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
          تکمیل رزرو
        </h1>
        <KoochAlert
          className="mt-6"
          title="انتخاب رزروی پیدا نشد"
          variant="info"
        >
          سبد رزرو خالی یا منقضی شده است. برای انتخاب اقامت و اتاق به فهرست
          اقامتگاه‌ها برگردید.
        </KoochAlert>
        <KoochButton
          className="mt-5"
          onClick={() => isDialog ? onEditSelection?.() : router.push("/properties")}
        >
          {isDialog ? "ویرایش انتخاب اقامت" : "بازگشت به اقامتگاه‌ها"}
        </KoochButton>
      </div>
    );
  }

  const propertyReturnHref = buildPropertyReturnHref(cart.items, cart.propertyEntry);
  const bookingMode = cart.items[0].bookingMode;
  const finalActionLabel =
    bookingMode === "OnRequest"
      ? "ارسال درخواست رزرو"
      : "ثبت رزرو و ادامه به پرداخت";

  return (
    <div
      className="min-w-0 overflow-x-clip bg-background text-foreground [--checkout-timeline-height:3.5rem]"
      data-testid="booking-checkout-page"
      dir="rtl"
    >
      <div
        className={`${isDialog ? "" : "sticky top-[var(--header-height)] z-40"} h-[var(--checkout-timeline-height)] w-full border-b border-border bg-[var(--property-search-background)] shadow-sm`}
        data-testid="checkout-sticky-timeline"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <BookingCheckoutStepper currentStep={currentStep} />
          </div>
        </div>
      </div>

      <ContentTag className={`mx-auto max-w-7xl ${isDialog ? "py-4" : "px-4 py-5 sm:px-6 sm:py-7"}`}>
        <h1 ref={stepHeadingRef} tabIndex={isDialog ? -1 : undefined} className="text-xl font-bold" id="checkout-page-title">
          {currentStep === "review" ? "مرور و نهایی‌سازی" : "تکمیل رزرو"}
        </h1>

        {isDialog && <details className="mt-4 rounded-lg border border-border bg-muted lg:hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            خلاصه رزرو · {cart.items[0].propertyName} · {cart.items.length.toLocaleString("fa-IR")} اتاق
          </summary>
          <div className="max-h-[45dvh] overflow-y-auto p-3">
            <BookingCheckoutSummary items={cart.items} total={cart.total} priceNotice="این قیمت انتخاب فعلی است و پیش از ثبت نهایی دوباره بررسی می‌شود." />
          </div>
        </details>}

        <div className="mt-5 grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
          <section
            aria-label={
              currentStep === "information" ? "اطلاعات رزرو" : undefined
            }
            aria-labelledby={
              currentStep === "review" ? "checkout-page-title" : undefined
            }
            className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5"
          >
            {currentStep === "information" ? (
              <>
                <CheckoutIdentityStep
                  key={identityResetKey}
                  allowAlternateLogin={!isDialog}
                  onBusyChange={setIdentityBusy}
                  interruptionMessage={identityInterruptionMessage}
                  onAuthenticated={() => { if (!isDialog) cart.setCheckoutRequested(false); }}
                />
                {identityComplete && auth.user && stayDetailsHydrated ? (
                  <CheckoutStayDetails
                    draft={stayDetailsDraft}
                    errors={showStayDetailsErrors ? stayDetailsErrors : {}}
                    onChange={updateStayDetails}
                    receptionHours={receptionHours}
                    receptionLoadFailed={receptionLoadFailed}
                    supportPhone={support.phone}
                    supportLoading={support.loading}
                  />
                ) : null}
              </>
            ) : (
              <ReviewStep draft={stayDetailsDraft} items={cart.items} receptionHours={receptionHours} support={support} />
            )}

            {finalizationMessage ? (
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
                {showExistingOrderRecovery && <div className="mt-3 space-y-3">
                  <p>ممکن است تلاش قبلی ثبت شده باشد. کلید همان تلاش حفظ شده است؛ پیش از شروع رزرو دیگری، سفارش‌های خود را بررسی کنید.</p>
                  <KoochButton variant="outline" onClick={() => router.push("/account/orders")}>بررسی سفارش‌های من</KoochButton>
                </div>}
              </KoochAlert>
            ) : null}
          </section>

          <aside
            aria-label="خلاصه رزرو"
            className={isDialog ? "hidden lg:sticky lg:top-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block" : "lg:sticky lg:top-[calc(var(--header-height)+var(--checkout-timeline-height)+1rem)] lg:col-start-2 lg:row-span-2 lg:row-start-1"}
          >
            <BookingCheckoutSummary items={cart.items} total={cart.total} priceNotice={isDialog ? "این قیمت انتخاب فعلی است و پیش از ثبت نهایی دوباره بررسی می‌شود." : undefined} />
          </aside>

          <div
            className={`flex flex-col gap-3 sm:flex-row sm:justify-between lg:col-start-1 ${isDialog ? "sticky bottom-0 bg-card py-3" : ""} ${
              currentStep === "review"
                ? "border-t border-border pt-4"
                : "rounded-lg border border-border bg-card p-4"
            }`}
            data-testid="checkout-mobile-actions"
          >
            <KoochButton
              disabled={isDialog && (finalizing || identityBusy)}
              onClick={() => {
                if (currentStep !== "information") showInformation();
                else if (isDialog) onEditSelection?.();
                else router.push(propertyReturnHref);
              }}
              variant="outline"
            >
              {currentStep === "information"
                ? isDialog ? "ویرایش انتخاب اقامت" : "بازگشت به انتخاب اقامت"
                : "بازگشت به اطلاعات"}
            </KoochButton>
            {currentStep === "information" ? (
              <KoochButton
                data-booking-primary="true"
                disabled={!identityComplete}
                onClick={continueToReview}
              >
                ادامه به نهایی‌سازی
              </KoochButton>
            ) : (
              <KoochButton
                data-booking-primary="true"
                disabled={finalizing}
                loading={finalizing}
                onClick={() => void finalizeCheckout()}
              >
                {finalActionLabel}
              </KoochButton>
            )}
          </div>
        </div>
      </ContentTag>
    </div>
  );
}

function ReviewStep({
  draft,
  items,
  receptionHours,
  support,
}: {
  draft: CheckoutStayDetailsDraft;
  items: BookingCartItem[];
  receptionHours: ReceptionHours | null;
  support: { phone: string | null; loading: boolean };
}) {
  const mode = bookingModePresentation(items[0].bookingMode);
  const isOnRequest = items[0].bookingMode === "OnRequest";

  return (
    <div>
      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
        پیش از ادامه، اطلاعات اقامت، مهمانان و مبلغ سفارش را بررسی کنید.
      </p>
      <CheckoutStayDetailsReview draft={draft} receptionHours={receptionHours} supportPhone={support.phone} supportLoading={support.loading} />
      <div className="mt-5 divide-y divide-border border-y border-border">
        <section className="py-4" aria-labelledby="checkout-booking-mode-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              className="text-sm font-bold text-muted-foreground"
              id="checkout-booking-mode-title"
            >
              نوع رزرو
            </h2>
            <p className="text-sm font-bold text-foreground">
              {mode.icon} {mode.label}
            </p>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {isOnRequest
              ? "درخواست رزرو پس از تأیید اقامتگاه آماده پرداخت می‌شود."
              : "پس از ثبت رزرو، برای تکمیل آن وارد مرحله پرداخت می‌شوید."}
          </p>
        </section>
        <section
          className="py-4"
          aria-labelledby="checkout-payment-window-title"
        >
          <h2
            className="text-sm font-bold text-muted-foreground"
            id="checkout-payment-window-title"
          >
            مهلت پرداخت
          </h2>
          <p className="mt-1 text-sm font-bold leading-6 text-foreground">
            مهلت پرداخت پس از ثبت رزرو آغاز می‌شود.
          </p>
        </section>
      </div>
    </div>
  );
}

export function buildPropertyReturnHref(items: BookingCartItem[], propertyEntry?: BookingPropertyEntry) {
  const firstItem = items[0];
  if (!firstItem || !firstItem.propertySlug || firstItem.propertySlug === "." || firstItem.propertySlug === "..") return "/properties";

  const entry = validBookingPropertyEntry(propertyEntry, items);
  const query = writeBookingContext({
    dates: { startDate: firstItem.checkIn, endDate: firstItem.checkOut },
    guests: { adults: firstItem.adults, children: firstItem.children,
      rooms: entry?.rooms ?? firstItem.stayRooms ?? items.length, childAges: firstItem.childAges },
  });
  return `/${entry?.kind ?? "properties"}/${encodeURIComponent(firstItem.propertySlug)}?${query.toString()}`;
}

export function buildSelfGuestDraft(
  user: NonNullable<ReturnType<typeof useAuthSession>["user"]>,
): CheckoutGuestDraft {
  const guest = user.linkedGuest;
  return {
    firstName: guest?.firstName ?? user.firstName,
    lastName: guest?.lastName ?? user.lastName,
    mobile: guest?.mobile ?? user.phoneNumber ?? "",
    email: guest?.email ?? user.email ?? "",
    nationalCode: guest?.nationalCode ?? "",
  };
}

function hasGuestDraftValue(guest: CheckoutGuestDraft) {
  return Object.values(guest).some((value) => value.trim().length > 0);
}
