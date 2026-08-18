"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GuestSelector, type GuestSelectorValue } from "@/components/GuestSelector";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { BookingCartMobileActionBar, BookingCartSummary } from "@/components/booking/BookingCart";
import {
  bookingCartSelectionMatchesItems,
  BookingCartProvider,
  getBookingCartStayContext,
  getCartAwareAvailableCount,
  type BookingCartSelection,
  useBookingCart,
} from "@/components/booking/BookingCartProvider";
import { bookingModePresentation, formatBookingDateRange } from "@/components/booking/booking-display";
import {
  fetchBookingOptions,
  type PublicBookingOptions,
  type PublicBookingRoomTypeOption,
} from "@/lib/booking-sessions";
import { formatCurrency } from "@/lib/currency";

type DateRange = { startDate: string | null; endDate: string | null };

export function PropertyBookingPanel(props: {
  propertyId: number;
  propertyName: string;
  propertySlug: string;
  startingPrice: number | null;
  dates: DateRange;
  onDatesChange: (value: DateRange) => void;
  guests: GuestSelectorValue;
  onGuestsChange: (value: GuestSelectorValue) => void;
  preferredRoomTypeId?: number | null;
  preferredRoomTypeName?: string | null;
}) {
  return <BookingCartProvider><PropertyBookingPanelContent {...props} /></BookingCartProvider>;
}

function PropertyBookingPanelContent({
  propertyId,
  propertyName,
  propertySlug,
  startingPrice,
  dates,
  onDatesChange,
  guests,
  onGuestsChange,
  preferredRoomTypeId,
  preferredRoomTypeName,
}: {
  propertyId: number;
  propertyName: string;
  propertySlug: string;
  startingPrice: number | null;
  dates: DateRange;
  onDatesChange: (value: DateRange) => void;
  guests: GuestSelectorValue;
  onGuestsChange: (value: GuestSelectorValue) => void;
  preferredRoomTypeId?: number | null;
  preferredRoomTypeName?: string | null;
}) {
  const router = useRouter();
  const cart = useBookingCart();
  const [options, setOptions] = useState<PublicBookingOptions | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(null);
  const [replacementSelection, setReplacementSelection] = useState<BookingCartSelection | null>(null);

  const optionsMatchSearch =
    options?.checkInDate === dates.startDate && options?.checkOutDate === dates.endDate;
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
      const preferred = response.roomTypes.find(
        (item) => item.roomTypeId === preferredRoomTypeId,
      );
      if (response.roomTypes.length === 0) {
        const preferredUnavailable = response.unavailableRoomTypes?.find(
          (item) => item.roomTypeId === preferredRoomTypeId,
        );
        const firstUnavailable = preferredUnavailable ?? response.unavailableRoomTypes?.[0];
        setMessage({
          tone: "info",
          text: unavailableMessage(firstUnavailable?.reason),
        });
      } else if (preferredRoomTypeId && !preferred) {
        setMessage({
          tone: "info",
          text: "اتاق انتخاب‌شده در این بازه قابل رزرو نیست؛ گزینه‌های در دسترس را می‌توانید بررسی کنید.",
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

  const hasAvailableRoomTypes = Boolean(
    optionsMatchSearch && options && options.roomTypes.length > 0,
  );
  const cartSummary = (
    <BookingCartSummary
      className={hasAvailableRoomTypes ? "lg:sticky lg:top-24" : undefined}
      items={cart.items}
      loading={false}
      onContinue={continueCheckout}
      onRemove={cart.removeItem}
      total={cart.total}
    />
  );

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {startingPrice === null ? "قیمت اقامت" : "کمترین قیمت روزانه آینده"}
      </p>
      <p className="mt-1 text-2xl font-black text-primary">
        {startingPrice === null ? "قیمت پس از تعیین در تقویم" : formatCurrency(startingPrice)}
      </p>
      <p className="mt-2 font-bold text-foreground">{propertyName}</p>
      {preferredRoomTypeId && preferredRoomTypeName && (
        <KoochAlert className="mt-4" title={`اتاق انتخاب‌شده: ${preferredRoomTypeName}`} variant="info">
          مرحله بعد: تاریخ و مهمانان را مشخص کنید و «بررسی موجودی» را بزنید. انتخاب کارت هنوز به معنی افزودن به سبد نیست.
        </KoochAlert>
      )}
      <div className="mt-5 grid gap-3">
        <KoochDatePicker calendarType="jalali" controlClassName="rounded-lg border px-3 py-2.5 text-right text-xs" disablePastDates labels={{ start: "تاریخ ورود", end: "تاریخ خروج", rangeTitle: "انتخاب تاریخ اقامت" }} labelsAbove mode="range" onChange={onDatesChange} placeholderEnd="انتخاب خروج" placeholderStart="انتخاب ورود" value={dates} />
        <GuestSelector controlClassName="rounded-lg border px-3 py-2.5 text-right text-xs" label="مهمانان هر اتاق و تعداد اتاق" onChange={onGuestsChange} value={guests} />
      </div>
      <KoochButton className="mt-5 w-full" loading={loadingOptions} onClick={checkAvailability}>بررسی موجودی</KoochButton>

      {message && <KoochAlert className="mt-4" variant={message.tone === "error" ? "destructive" : message.tone}>{message.text}</KoochAlert>}

      {hasAvailableRoomTypes && options ? (
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
          <div className="grid gap-4 rounded-lg border border-border bg-muted/40 p-4">
            <div>
              <h3 className="font-black text-foreground" id="available-room-types-title">
                اتاق‌های قابل انتخاب
              </h3>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                می‌توانید چند نوع اتاق یا چند واحد از یک نوع را برای همین اقامت انتخاب کنید.
              </p>
            </div>
            <ul aria-labelledby="available-room-types-title" className="divide-y divide-border">
              {options.roomTypes.map((option) => {
                const selectedItems = currentStayCartItems.filter(
                  (item) => item.roomTypeId === option.roomTypeId,
                );
                const availableToAdd = dates.startDate && dates.endDate
                  ? getCartAwareAvailableCount({
                      items: currentStayCartItems,
                      propertyId,
                      roomTypeId: option.roomTypeId,
                      checkIn: dates.startDate,
                      checkOut: dates.endDate,
                      serverAvailableCount: option.availableCount,
                    })
                  : 0;
                return (
                  <RoomTypeSelectionRow
                    availableToAdd={availableToAdd}
                    isPreferred={option.roomTypeId === preferredRoomTypeId}
                    key={option.roomTypeId}
                    onAdd={() => addToCart(option)}
                    onRemove={() => removeOneFromCart(option.roomTypeId)}
                    option={option}
                    selectedQuantity={selectedItems.length}
                  />
                );
              })}
            </ul>
          </div>
          {cartSummary}
        </div>
      ) : cartSummary}

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

function RoomTypeSelectionRow({
  availableToAdd,
  isPreferred,
  onAdd,
  onRemove,
  option,
  selectedQuantity,
}: {
  availableToAdd: number;
  isPreferred: boolean;
  onAdd: () => void;
  onRemove: () => void;
  option: PublicBookingRoomTypeOption;
  selectedQuantity: number;
}) {
  const maximumSelectable = selectedQuantity + availableToAdd;
  const isOverCapacity = selectedQuantity > option.availableCount;
  const isSingleUnit = selectedQuantity <= 1 && maximumSelectable <= 1;
  const mode = bookingModePresentation(option.bookingMode);

  return (
    <li
      className="grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      data-preferred={isPreferred || undefined}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="font-black text-foreground">{option.name}</h4>
          {isPreferred && <span className="text-xs font-bold text-primary">انتخاب‌شده از صفحه اتاق‌ها</span>}
        </div>
        <p className="mt-1 text-sm font-bold text-foreground">
          {formatCurrency(option.finalAmount)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          <span aria-hidden="true">{mode.icon}</span>{" "}{mode.label}
          {selectedQuantity === 0 && availableToAdd > 0
            ? ` · ${availableToAdd.toLocaleString("fa-IR")} واحد موجود`
            : ""}
        </p>
        {isOverCapacity && (
          <p className="mt-2 text-xs font-bold leading-6 text-destructive" role="status">
            موجودی جدید حداکثر {option.availableCount.toLocaleString("fa-IR")} واحد است؛ تعداد انتخاب‌شده را کاهش دهید.
          </p>
        )}
      </div>
      <div className="flex min-h-11 items-center justify-start sm:justify-end">
        {selectedQuantity === 0 ? (
          <KoochButton
            aria-label={availableToAdd === 0 ? `تکمیل ظرفیت ${option.name}` : `انتخاب ${option.name}`}
            disabled={availableToAdd === 0}
            onClick={onAdd}
            variant={availableToAdd === 0 ? "outline" : "primary"}
          >
            {availableToAdd === 0 ? "تکمیل ظرفیت" : "انتخاب"}
          </KoochButton>
        ) : isSingleUnit ? (
          <KoochButton
            aria-label={`حذف انتخاب ${option.name}`}
            aria-pressed={true}
            onClick={onRemove}
            variant="outline"
          >
            <span aria-hidden="true">✓</span> انتخاب شد؛ حذف
          </KoochButton>
        ) : (
          <div aria-label={`تعداد انتخاب‌شده ${option.name}`} className="flex items-center gap-2" role="group">
            <KoochButton aria-label={`کاهش تعداد ${option.name}`} onClick={onRemove} size="icon" variant="outline">
              <span aria-hidden="true" className="text-lg">−</span>
            </KoochButton>
            <output aria-atomic="true" aria-live="polite" className="min-w-8 text-center text-base font-black text-foreground">
              {selectedQuantity.toLocaleString("fa-IR")}
            </output>
            <KoochButton
              aria-label={`افزایش تعداد ${option.name}`}
              disabled={availableToAdd === 0 || isOverCapacity}
              onClick={onAdd}
              size="icon"
              variant="outline"
            >
              <span aria-hidden="true" className="text-lg">+</span>
            </KoochButton>
          </div>
        )}
      </div>
    </li>
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

function unavailableMessage(
  reason?: "GuestCapacityExceeded" | "NoActiveNamedRooms" | "InsufficientAvailability" | "IncompleteDailyPricing",
) {
  if (reason === "GuestCapacityExceeded") {
    return "ظرفیت این اتاق برای تعداد مهمانان انتخاب‌شده کافی نیست. تعداد مهمانان یا نوع اتاق را تغییر دهید.";
  }
  if (reason === "IncompleteDailyPricing") {
    return "قیمت همه شب‌های این بازه هنوز در تقویم تعیین نشده است. تاریخ دیگری را انتخاب کنید یا بعداً دوباره بررسی کنید.";
  }
  return "در این بازه ظرفیت قابل رزرو وجود ندارد. تاریخ‌ها یا تعداد اتاق را تغییر دهید و دوباره بررسی کنید.";
}
