"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GuestSelector, type GuestSelectorValue } from "@/components/GuestSelector";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { BookingCartMobileActionBar, BookingCartSummary } from "@/components/booking/BookingCart";
import {
  PublicRoomTypeCard,
} from "@/components/booking/PublicRoomTypeCard";
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
}) {
  return <BookingCartProvider><PropertyBookingPanelContent {...props} /></BookingCartProvider>;
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
}) {
  const router = useRouter();
  const cart = useBookingCart();
  const [options, setOptions] = useState<PublicBookingOptions | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(null);
  const [replacementSelection, setReplacementSelection] = useState<BookingCartSelection | null>(null);

  const optionsMatchSearch =
    options?.checkInDate === dates.startDate &&
    options?.checkOutDate === dates.endDate &&
    options?.adults === guests.adults &&
    options?.children === guests.children &&
    options?.childAges.length === guests.childAges.length &&
    options.childAges.every((age, index) => age === guests.childAges[index]);
  const cartMatchesCurrentStay = Boolean(
    dates.startDate && dates.endDate &&
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
      setOptions(response);
      if (response.roomTypes.length === 0) {
        setMessage({
          tone: "info",
          text: "برای این بازه اتاق قابل رزروی پیدا نشد؛ وضعیت هر اتاق را در کارت آن بررسی کنید.",
        });
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "بررسی موجودی انجام نشد." });
    } finally {
      setLoadingOptions(false);
    }
  }

  function addToCart(option: PublicBookingRoomTypeOption) {
    if (
      !dates.startDate ||
      !dates.endDate
    ) return;
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

  function addSelectionToCart(selection: BookingCartSelection, replace = false) {
    try {
      if (replace) cart.replaceWithSelection(selection);
      else cart.addSelection(selection);
      setMessage({
        tone: "success",
        text: `${selection.quantity.toLocaleString("fa-IR")} واحد از ${selection.roomTypeName} به سبد رزرو اضافه شد.`,
      });
      toast.success("اتاق به سبد رزرو اضافه شد.");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "افزودن اتاق انجام نشد." });
    }
  }

  function continueCheckout() {
    if (cart.items.length === 0) return;
    cart.setCheckoutRequested(false);
    router.push("/booking/checkout?step=information");
  }

  const hasSearchResults = Boolean(optionsMatchSearch && options);
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

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div
          className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)_auto] lg:items-end"
          data-testid="room-availability-controls"
        >
          <KoochDatePicker calendarType="jalali" controlClassName="rounded-lg border px-3 py-2.5 text-right text-xs" disablePastDates labels={{ start: "تاریخ ورود", end: "تاریخ خروج", rangeTitle: "انتخاب تاریخ اقامت" }} labelsAbove mode="range" onChange={onDatesChange} placeholderEnd="انتخاب خروج" placeholderStart="انتخاب ورود" value={dates} />
          <GuestSelector controlClassName="rounded-lg border px-3 py-2.5 text-right text-xs" label="مهمانان هر اتاق و تعداد اتاق" onChange={onGuestsChange} value={guests} />
          <KoochButton className="w-full lg:w-auto" loading={loadingOptions} onClick={checkAvailability}>بررسی موجودی</KoochButton>
        </div>

        {message && <KoochAlert className="mt-4" variant={message.tone === "error" ? "destructive" : message.tone}>{message.text}</KoochAlert>}

        {!hasSearchResults && !message && (
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            تاریخ و تعداد مهمان را برای بررسی موجودی انتخاب کنید.
          </p>
        )}
      </div>

      <div
        className={`mt-5 grid items-start gap-5 ${cart.items.length > 0 ? "pb-24 sm:pb-0" : ""} ${hasSearchResults ? "lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]" : ""}`}
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
              ? options?.roomTypes.find((item) => item.roomTypeId === roomType.id) ?? null
              : null;
            const unavailable = hasSearchResults
              ? options?.unavailableRoomTypes?.find((item) => item.roomTypeId === roomType.id)
              : undefined;
            const selectedItems = currentStayCartItems.filter(
              (item) => item.roomTypeId === roomType.id,
            );
            const availableToAdd = option && dates.startDate && dates.endDate
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
                booking={hasSearchResults ? {
                  option,
                  unavailableReason: unavailable?.reason,
                  availableToAdd,
                  selectedQuantity: selectedItems.length,
                  onAdd: () => option && addToCart(option),
                  onRemove: () => removeOneFromCart(roomType.id),
                } : undefined}
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

      <BookingCartMobileActionBar count={cart.items.length} loading={false} onContinue={continueCheckout} total={cart.total} />
      <KoochConfirmDialog
        cancelText="حفظ سبد فعلی"
        confirmText="شروع رزرو جدید"
        description={replacementSelection ? (
          <CartReplacementDetails
            current={getBookingCartStayContext(cart.items)}
            currentPropertyName={cart.items[0]?.propertyName ?? ""}
            next={replacementSelection}
          />
        ) : undefined}
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
            {currentPropertyName}<br />
            {formatBookingDateRange(current.checkIn, current.checkOut)}<br />
            {formatGuestComposition(current)}
          </dd>
        </div>
        <div>
          <dt className="font-bold text-foreground">اقامت جدید</dt>
          <dd className="mt-1 text-muted-foreground">
            {next.propertyName}<br />
            {formatBookingDateRange(next.checkIn, next.checkOut)}<br />
            {formatGuestComposition(next)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function formatGuestComposition({ adults, children }: { adults: number; children: number }) {
  return children > 0
    ? `${adults.toLocaleString("fa-IR")} بزرگسال و ${children.toLocaleString("fa-IR")} کودک`
    : `${adults.toLocaleString("fa-IR")} بزرگسال`;
}
