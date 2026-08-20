"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import {
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
  type PublicBookingRoomTypeOption,
} from "@/lib/booking-sessions";
import type { PublicRoomType } from "@/lib/public-properties";

type DateRange = { startDate: string | null; endDate: string | null };
type PropertyBookingPanelSlots = {
  searchBar: ReactNode;
  roomSelection: ReactNode;
};

export const propertyRoomsAnchorId = "property-rooms";

export function PropertyBookingPanel(props: {
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
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [hasSuccessfulAvailabilitySearch, setHasSuccessfulAvailabilitySearch] =
    useState(false);
  const [message, setMessage] = useState<{
    tone: "error" | "info" | "success";
    text: string;
  } | null>(null);
  const [replacementSelection, setReplacementSelection] =
    useState<BookingCartSelection | null>(null);

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
    if (options && !optionsMatchSearch) setMessage(null);
  }, [options, optionsMatchSearch]);

  async function checkAvailability() {
    if (!dates.startDate || !dates.endDate) {
      setHasSuccessfulAvailabilitySearch(false);
      setMessage({ tone: "error", text: "تاریخ ورود و خروج را انتخاب کنید." });
      return;
    }
    setLoadingOptions(true);
    setHasSuccessfulAvailabilitySearch(false);
    setMessage(null);
    try {
      const response = await fetchBookingOptions(propertySlug, {
        checkIn: dates.startDate,
        checkOut: dates.endDate,
        adults: guests.adults,
        children: guests.children,
        childAges: guests.childAges,
      });
      setOptions(response);
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
      setMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "بررسی موجودی انجام نشد.",
      });
    } finally {
      setLoadingOptions(false);
    }
  }

  function addToCart(option: PublicBookingRoomTypeOption) {
    if (!dates.startDate || !dates.endDate) return;
    const selection: BookingCartSelection = {
      propertyId,
      propertyName,
      propertySlug,
      bookingMode: option.bookingMode,
      roomTypeId: option.roomTypeId,
      roomTypeName: option.name,
      checkIn: dates.startDate,
      checkOut: dates.endDate,
      adults: guests.adults,
      children: guests.children,
      childAges: guests.childAges,
      notes: null,
      displayAmount: option.finalAmount,
      currency: option.currency,
      quantity: 1,
    };
    if (!bookingCartSelectionMatchesItems(cart.items, selection)) {
      setReplacementSelection(selection);
      return;
    }
    addSelectionToCart(selection);
  }

  function removeOneFromCart(roomTypeId: number) {
    const selectedItems = currentStayCartItems.filter(
      (item) => item.roomTypeId === roomTypeId,
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
    if (cart.items.length === 0) return;
    cart.setCheckoutRequested(false);
    router.push("/booking/checkout?step=information");
  }

  const hasSearchResults = Boolean(optionsMatchSearch && options);
  const searchContextDiffersFromCart = Boolean(
    hasSuccessfulAvailabilitySearch &&
    optionsMatchSearch &&
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
  const showCartSummary = hasSearchResults || cart.items.length > 0;
  const cartSummary = (
    <BookingCartSummary
      className={hasSearchResults ? "lg:sticky lg:top-24" : undefined}
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
        className="sticky top-16 z-40 w-full border-b border-border bg-[var(--property-search-background)] shadow-sm"
        data-testid="property-search-bar"
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
              controlClassName="h-12 w-full rounded-lg border border-border bg-background px-3 text-right text-xs text-foreground"
              label=""
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
            </KoochAlert>
          )}

          {!hasSearchResults && !message && (
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

      <div
        className={`grid items-start gap-5 ${searchContextDiffersFromCart ? "mt-4" : ""} ${cart.items.length > 0 ? "pb-24 sm:pb-0" : ""} ${hasSearchResults ? "lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]" : ""}`}
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
            const selectedItems = currentStayCartItems.filter(
              (item) => item.roomTypeId === roomType.id,
            );
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
                        selectedQuantity: selectedItems.length,
                        onAdd: () => option && addToCart(option),
                        onRemove: () => removeOneFromCart(roomType.id),
                      }
                    : undefined
                }
                galleryFallback={galleryFallback}
                key={roomType.id}
                onShowDetails={() => onShowRoomDetails(roomType)}
                roomType={roomType}
              />
            );
          })}
        </div>
        {showCartSummary && cartSummary}
      </div>

      <BookingCartMobileActionBar
        count={cart.items.length}
        loading={false}
        onContinue={continueCheckout}
        total={cart.total}
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
