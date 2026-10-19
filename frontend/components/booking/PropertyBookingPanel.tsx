"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  GuestSelector,
  type GuestSelectorValue,
} from "@/components/GuestSelector";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCompactDateRangePicker } from "@/components/KoochCompactDateRangePicker";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import {
  BookingCartMobileActionBar,
  BookingCartSummary,
} from "@/components/booking/BookingCart";
import { PublicRoomTypeCard } from "@/components/booking/PublicRoomTypeCard";
import { PublicRoomTypeCalendarDialog } from "@/components/booking/PublicRoomTypeCalendarDialog";
import {
  bookingCartOfferMatches,
  bookingCartSelectionMatchesItems,
  BookingCartProvider,
  getBookingCartStayContext,
  getCartAwareAvailableCount,
  type BookingCartSelection,
  useBookingCart,
} from "@/components/booking/BookingCartProvider";
import { formatBookingDateRange } from "@/components/booking/booking-display";
import {
  fetchBookingOptions,
  type PublicBookingOptions,
  type PublicBookingRatePlanOption,
  type PublicBookingRoomTypeOption,
} from "@/lib/booking-sessions";
import type { PublicRoomType } from "@/lib/public-properties";
import { KoochSvgIcon } from "../KoochSvgIcon";

type DateRange = { startDate: string | null; endDate: string | null };
type PropertyBookingPanelSlots = {
  searchBar: ReactNode;
  roomSelection: ReactNode;
};

export const propertyRoomsAnchorId = "property-rooms";

export function PropertyBookingPanel(props: {
  autoCheckInitialContextKey?: string | null;
  propertyId: number;
  propertyName: string;
  propertySlug: string;
  roomTypes: PublicRoomType[];
  galleryFallback: string;
  onShowRoomDetails: (roomType: PublicRoomType) => void;
  dates: DateRange;
  onDatesChange: (value: DateRange) => void;
  guests: GuestSelectorValue;
  onGuestsChange: (value: GuestSelectorValue) => void;
  children: (slots: PropertyBookingPanelSlots) => ReactNode;
}) {
  return (
    <BookingCartProvider>
      <PropertyBookingPanelContent {...props} />
    </BookingCartProvider>
  );
}

function PropertyBookingPanelContent({
  autoCheckInitialContextKey,
  propertyId,
  propertyName,
  propertySlug,
  roomTypes,
  galleryFallback,
  onShowRoomDetails,
  dates,
  onDatesChange,
  guests,
  onGuestsChange,
  children,
}: {
  autoCheckInitialContextKey?: string | null;
  propertyId: number;
  propertyName: string;
  propertySlug: string;
  roomTypes: PublicRoomType[];
  galleryFallback: string;
  onShowRoomDetails: (roomType: PublicRoomType) => void;
  dates: DateRange;
  onDatesChange: (value: DateRange) => void;
  guests: GuestSelectorValue;
  onGuestsChange: (value: GuestSelectorValue) => void;
  children: (slots: PropertyBookingPanelSlots) => ReactNode;
}) {
  const router = useRouter();
  const cart = useBookingCart();
  const [options, setOptions] = useState<PublicBookingOptions | null>(null);
  const [optionsContextKey, setOptionsContextKey] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(Boolean(autoCheckInitialContextKey));
  const attemptedAutoCheckKey = useRef<string | null>(null);
  const availabilityRequestId = useRef(0);
  const [hasSuccessfulAvailabilitySearch, setHasSuccessfulAvailabilitySearch] =
    useState(false);
  const [message, setMessage] = useState<{
    tone: "error" | "info" | "success";
    text: string;
    retryAvailability?: boolean;
  } | null>(null);
  const [replacementSelection, setReplacementSelection] =
    useState<BookingCartSelection | null>(null);
  const [calendarRoomType, setCalendarRoomType] = useState<PublicRoomType | null>(null);
  const searchBarRef = useRef<HTMLDivElement>(null);
  const searchContextKey = JSON.stringify([
    propertySlug, dates.startDate, dates.endDate, guests.rooms,
    guests.adults, guests.children, guests.childAges,
  ]);
  const currentContextKey = useRef(searchContextKey);
  currentContextKey.current = searchContextKey;

  useEffect(() => {
    const searchBar = searchBarRef.current;
    if (!searchBar) return;

    const publishSearchHeight = () => {
      document.documentElement.style.setProperty(
        "--property-booking-search-height",
        `${Math.ceil(searchBar.getBoundingClientRect().height)}px`,
      );
    };

    publishSearchHeight();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(publishSearchHeight);
    observer?.observe(searchBar);
    if (!observer) window.addEventListener("resize", publishSearchHeight);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", publishSearchHeight);
      document.documentElement.style.removeProperty(
        "--property-booking-search-height",
      );
    };
  }, []);

  const optionsMatchSearch =
    options?.checkInDate === dates.startDate &&
    options?.checkOutDate === dates.endDate &&
    options?.adults === guests.adults &&
    options?.children === guests.children &&
    options?.childAges.length === guests.childAges.length &&
    options.childAges.every((age, index) => age === guests.childAges[index]);
  const cartMatchesCurrentStay = Boolean(
    dates.startDate &&
    dates.endDate &&
    bookingCartSelectionMatchesItems(cart.items, {
      propertyId,
      checkIn: dates.startDate,
      checkOut: dates.endDate,
      adults: guests.adults,
      children: guests.children,
      childAges: guests.childAges,
    }),
  );
  const currentStayCartItems = cartMatchesCurrentStay ? cart.items : [];

  useEffect(() => {
    availabilityRequestId.current += 1;
    setOptions(null);
    setOptionsContextKey(null);
    setHasSuccessfulAvailabilitySearch(false);
    setMessage(null);
    setLoadingOptions(false);
  }, [searchContextKey]);

  const checkAvailability = useCallback(async () => {
    const requestId = ++availabilityRequestId.current;
    const requestedContextKey = searchContextKey;
    setOptions(null);
    setOptionsContextKey(null);
    setHasSuccessfulAvailabilitySearch(false);
    if (!dates.startDate || !dates.endDate) {
      setMessage({ tone: "error", text: "تاریخ ورود و خروج را انتخاب کنید." });
      return;
    }
    setLoadingOptions(true);
    setMessage(null);
    try {
      const response = await fetchBookingOptions(propertySlug, {
        checkIn: dates.startDate,
        checkOut: dates.endDate,
        adults: guests.adults,
        children: guests.children,
        childAges: guests.childAges,
      });
      if (requestId !== availabilityRequestId.current || requestedContextKey !== currentContextKey.current) return;
      setOptions(response);
      setOptionsContextKey(requestedContextKey);
      setHasSuccessfulAvailabilitySearch(true);
      if (response.roomTypes.length === 0) {
        setMessage({
          tone: "info",
          text: "برای این بازه اتاق قابل رزروی پیدا نشد؛ وضعیت هر اتاق را در کارت آن بررسی کنید.",
        });
      }
      document.getElementById(propertyRoomsAnchorId)?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
    } catch (error) {
      if (requestId !== availabilityRequestId.current || requestedContextKey !== currentContextKey.current) return;
      setMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "بررسی موجودی انجام نشد.",
        retryAvailability: true,
      });
    } finally {
      if (requestId === availabilityRequestId.current && requestedContextKey === currentContextKey.current) {
        setLoadingOptions(false);
      }
    }
  }, [dates.startDate, dates.endDate, guests.adults, guests.children, guests.childAges, propertySlug, searchContextKey]);

  useEffect(() => {
    if (!autoCheckInitialContextKey || attemptedAutoCheckKey.current === autoCheckInitialContextKey) return;
    const currentContextKey = JSON.stringify([
      propertySlug, dates.startDate, dates.endDate, guests.rooms,
      guests.adults, guests.children, guests.childAges,
    ]);
    if (currentContextKey !== autoCheckInitialContextKey) return;
    attemptedAutoCheckKey.current = autoCheckInitialContextKey;
    void checkAvailability();
  }, [autoCheckInitialContextKey, checkAvailability, dates.startDate, dates.endDate, guests, propertySlug]);

  function addToCart(option: PublicBookingRoomTypeOption, ratePlan?: PublicBookingRatePlanOption) {
    if (!dates.startDate || !dates.endDate) return;
    const selection: BookingCartSelection = {
      propertyId,
      propertyName,
      propertySlug,
      bookingMode: option.bookingMode,
      roomTypeId: option.roomTypeId,
      ratePlanId: ratePlan?.ratePlanId ?? null,
      ratePlanName: ratePlan?.name ?? null,
      mealPlanName: ratePlan ? ratePlan.mealPlanName : option.defaultMealPlanName,
      roomTypeName: option.name,
      checkIn: dates.startDate,
      checkOut: dates.endDate,
      adults: guests.adults,
      children: guests.children,
      childAges: guests.childAges,
      notes: null,
      displayAmount: ratePlan?.finalAmount ?? option.finalAmount,
      currency: ratePlan?.currency ?? option.currency,
      quantity: 1,
    };
    if (!bookingCartSelectionMatchesItems(cart.items, selection)) {
      setReplacementSelection(selection);
      return;
    }
    addSelectionToCart(selection);
  }

  function removeOneFromCart(roomTypeId: number, ratePlanId: number | null = null) {
    const selectedItems = currentStayCartItems.filter(
      (item) => bookingCartOfferMatches(item, roomTypeId, ratePlanId),
    );
    const itemToRemove = selectedItems.at(-1);
    if (itemToRemove) cart.removeItem(itemToRemove.id);
  }

  function addSelectionToCart(
    selection: BookingCartSelection,
    replace = false,
  ) {
    try {
      if (replace) cart.replaceWithSelection(selection);
      else cart.addSelection(selection);
      setMessage({
        tone: "success",
        text: `${selection.quantity.toLocaleString("fa-IR")} واحد از ${selection.roomTypeName} به سبد رزرو اضافه شد.`,
      });
      toast.success("اتاق به سبد رزرو اضافه شد.");
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "افزودن اتاق انجام نشد.",
      });
    }
  }

  function continueCheckout() {
    if (!canCheckout) return;
    cart.setCheckoutRequested(false);
    router.push("/booking/checkout?step=information");
  }

  const hasSearchResults = Boolean(
    !loadingOptions && hasSuccessfulAvailabilitySearch && options &&
    optionsContextKey === searchContextKey && optionsMatchSearch &&
    options.propertyId === propertyId && options.propertySlug === propertySlug,
  );
  const canCheckout = Boolean(
    hasSearchResults && cartMatchesCurrentStay && cart.items.length > 0 && options &&
    cart.items.every((item) => {
      const option = options.roomTypes.find((candidate) => candidate.roomTypeId === item.roomTypeId);
      if (!option || option.bookingMode !== item.bookingMode ||
          cart.items.filter((selected) => selected.roomTypeId === item.roomTypeId).length > option.availableCount) return false;
      if (item.roomId !== null && !option.rooms.some((room) => room.roomId === item.roomId)) return false;
      const offer = item.ratePlanId === null
        ? option
        : option.ratePlans?.find((plan) => plan.ratePlanId === item.ratePlanId);
      return offer?.finalAmount === item.displayAmount && offer.currency === item.currency;
    }),
  );
  const searchContextDiffersFromCart = Boolean(
    hasSearchResults &&
    options &&
    cart.items.length > 0 &&
    !bookingCartSelectionMatchesItems(cart.items, {
      propertyId: options.propertyId,
      checkIn: options.checkInDate,
      checkOut: options.checkOutDate,
      adults: options.adults,
      children: options.children,
      childAges: options.childAges,
    }),
  );
  const showCartSummary = hasSearchResults && (cart.items.length === 0 || canCheckout);
  const cartSummary = (
    <BookingCartSummary
      className={
        hasSearchResults
          ? "lg:sticky lg:top-[calc(var(--header-height)+var(--property-booking-search-height,0px)+1rem)]"
          : undefined
      }
      items={cart.items}
      loading={false}
      onContinue={continueCheckout}
      onRemove={cart.removeItem}
      total={cart.total}
    />
  );

  const searchBar = (
    <>
      <div
        className="sticky top-[var(--header-height)] z-40 w-full border-b border-border bg-[var(--property-search-background)] shadow-sm"
        data-testid="property-search-bar"
        ref={searchBarRef}
      >
        <div
          className="mx-auto max-w-7xl px-5 py-2 sm:px-8 sm:py-3"
          data-testid="property-search-inner"
        >
          <form
            aria-label="جستجوی موجودی این اقامتگاه"
            className="grid grid-cols-2 items-end gap-2 sm:gap-3 xl:grid-cols-[minmax(180px,0.8fr)_minmax(320px,1.5fr)_minmax(240px,1fr)_auto]"
            data-testid="room-availability-controls"
            onSubmit={(event) => {
              event.preventDefault();
              void checkAvailability();
            }}
          >
            <div className="col-span-2 grid gap-1.5 text-sm font-bold text-foreground sm:col-span-1">
              {/* <span id="property-search-context-label">اقامتگاه</span> */}
              <div
                aria-labelledby="property-search-context-label"
                className="flex h-12 min-w-0 items-center rounded-lg border border-border bg-muted px-3 text-sm font-semibold text-foreground"
                data-testid="property-search-context"
              >
                <KoochSvgIcon src="/svgs/search-3.svg" size="lg" />
                <span className="truncate">{propertyName}</span>
              </div>
            </div>

            <div className="col-span-2 grid min-w-0 gap-1.5 text-sm font-bold text-foreground sm:col-span-1">
              {/* <span>تاریخ اقامت</span> */}
              <KoochCompactDateRangePicker
                calendarType="jalali"
                daySpacing="compact"
                disablePastDates
                fieldSize="compact"
                onChange={(nextDates) => {
                  if (!nextDates.startDate || !nextDates.endDate) return;
                  onDatesChange(nextDates);
                }}
                value={dates}
              />
            </div>

            <GuestSelector
              className="col-span-1 gap-1.5"
              controlClassName="h-12 w-full px-3 text-right text-xs"
              label=""
              icon={<KoochSvgIcon src="/svgs/users-3.svg" size="lg" />}
              onChange={onGuestsChange}
              value={guests}
            />

            <KoochButton
              className="col-span-1 h-12 w-full px-5"
              loading={loadingOptions}
              type="submit"
            >
              بررسی موجودی
            </KoochButton>
          </form>
        </div>
      </div>

      {(message || !hasSearchResults) && (
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          {message && (
            <KoochAlert
              className="mt-3"
              variant={message.tone === "error" ? "destructive" : message.tone}
            >
              {message.text}
              {message.retryAvailability && (
                <KoochButton className="mt-2" onClick={() => void checkAvailability()} size="sm" variant="outline">
                  تلاش دوباره
                </KoochButton>
              )}
            </KoochAlert>
          )}

          {!hasSearchResults && !message && !loadingOptions && (
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              تاریخ و تعداد مهمان را برای بررسی موجودی انتخاب کنید.
            </p>
          )}
        </div>
      )}
    </>
  );

  const roomSelection = (
    <>
      {searchContextDiffersFromCart && (
        <KoochAlert title="جست‌وجوی جدید" variant="info">
          این نتایج برای تاریخ یا مهمان‌های متفاوتی است. با انتخاب اتاق جدید
          می‌توانید انتخاب‌های فعلی را جایگزین کنید.
        </KoochAlert>
      )}
      {cart.items.length > 0 && !canCheckout && !searchContextDiffersFromCart && (
        <KoochAlert className="mt-4" variant="info">
          انتخاب‌های قبلی در سبد حفظ شده‌اند، اما قیمت و موجودی آن‌ها برای این جست‌وجو تأیید نشده است.
          برای ادامه رزرو، موجودی را دوباره بررسی کنید یا انتخاب‌ها را اصلاح کنید.
        </KoochAlert>
      )}

      <div
        className={`grid items-start gap-5 ${searchContextDiffersFromCart ? "mt-4" : ""} ${canCheckout ? "pb-24 sm:pb-0" : ""} ${showCartSummary ? "lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]" : ""}`}
        data-testid="room-selection-region"
      >
        <div
          aria-label="نوع‌های اتاق"
          className="grid gap-5"
          data-testid="canonical-room-type-list"
          role="list"
        >
          {roomTypes.map((roomType) => {
            const option = hasSearchResults
              ? (options?.roomTypes.find(
                  (item) => item.roomTypeId === roomType.id,
                ) ?? null)
              : null;
            const unavailable = hasSearchResults
              ? options?.unavailableRoomTypes?.find(
                  (item) => item.roomTypeId === roomType.id,
                )
              : undefined;
            const selectedBaseItems = currentStayCartItems.filter(
              (item) => bookingCartOfferMatches(item, roomType.id),
            );
            const roomTypeItems = currentStayCartItems.filter((item) => item.roomTypeId === roomType.id);
            const availableToAdd =
              option && dates.startDate && dates.endDate
                ? getCartAwareAvailableCount({
                    items: currentStayCartItems,
                    propertyId,
                    roomTypeId: roomType.id,
                    checkIn: dates.startDate,
                    checkOut: dates.endDate,
                    serverAvailableCount: option.availableCount,
                  })
                : 0;

            return (
              <PublicRoomTypeCard
                booking={
                  hasSearchResults
                    ? {
                        option,
                        unavailableReason: unavailable?.reason,
                        availableToAdd,
                        selectedQuantity: selectedBaseItems.length,
                        totalSelectedQuantity: roomTypeItems.length,
                        onAdd: () => option && addToCart(option),
                        onRemove: () => removeOneFromCart(roomType.id),
                        ratePlans: option?.ratePlans?.map((plan) => ({
                          ...plan,
                          selectedQuantity: roomTypeItems.filter((item) => bookingCartOfferMatches(item, roomType.id, plan.ratePlanId)).length,
                          onAdd: () => addToCart(option, plan),
                          onRemove: () => removeOneFromCart(roomType.id, plan.ratePlanId),
                        })) ?? [],
                      }
                    : undefined
                }
                galleryFallback={galleryFallback}
                key={roomType.id}
                onShowDetails={() => onShowRoomDetails(roomType)}
                onShowCalendar={() => setCalendarRoomType(roomType)}
                roomType={roomType}
              />
            );
          })}
        </div>
        {showCartSummary && cartSummary}
      </div>

      <BookingCartMobileActionBar
        count={canCheckout ? cart.items.length : 0}
        loading={false}
        onContinue={continueCheckout}
        total={canCheckout ? cart.total : 0}
      />
      <PublicRoomTypeCalendarDialog
        onClose={() => setCalendarRoomType(null)}
        propertySlug={propertySlug}
        roomType={calendarRoomType}
      />
      <KoochConfirmDialog
        cancelText="حفظ سبد فعلی"
        confirmText="شروع رزرو جدید"
        description={
          replacementSelection ? (
            <CartReplacementDetails
              current={getBookingCartStayContext(cart.items)}
              currentPropertyName={cart.items[0]?.propertyName ?? ""}
              next={replacementSelection}
            />
          ) : undefined
        }
        onConfirm={() => {
          if (!replacementSelection) return;
          addSelectionToCart(replacementSelection, true);
          setReplacementSelection(null);
        }}
        onOpenChange={(open) => {
          if (!open) setReplacementSelection(null);
        }}
        open={replacementSelection !== null}
        title="سبد رزرو شما مربوط به اقامت دیگری است"
        variant="warning"
      />
    </>
  );

  return children({ searchBar, roomSelection });
}

function CartReplacementDetails({
  current,
  currentPropertyName,
  next,
}: {
  current: ReturnType<typeof getBookingCartStayContext>;
  currentPropertyName: string;
  next: BookingCartSelection;
}) {
  if (!current) return null;
  return (
    <div className="grid gap-3">
      <p>برای افزودن این انتخاب باید سبد فعلی با رزرو جدید جایگزین شود.</p>
      <dl className="grid gap-2 rounded-lg bg-muted p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-bold text-foreground">اقامت فعلی سبد</dt>
          <dd className="mt-1 text-muted-foreground">
            {currentPropertyName}
            <br />
            {formatBookingDateRange(current.checkIn, current.checkOut)}
            <br />
            {formatGuestComposition(current)}
          </dd>
        </div>
        <div>
          <dt className="font-bold text-foreground">اقامت جدید</dt>
          <dd className="mt-1 text-muted-foreground">
            {next.propertyName}
            <br />
            {formatBookingDateRange(next.checkIn, next.checkOut)}
            <br />
            {formatGuestComposition(next)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function formatGuestComposition({
  adults,
  children,
}: {
  adults: number;
  children: number;
}) {
  return children > 0
    ? `${adults.toLocaleString("fa-IR")} بزرگسال و ${children.toLocaleString("fa-IR")} کودک`
    : `${adults.toLocaleString("fa-IR")} بزرگسال`;
}
