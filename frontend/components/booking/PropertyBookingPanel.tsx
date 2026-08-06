"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { GuestSelector, type GuestSelectorValue } from "@/components/GuestSelector";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { KoochField, KoochSelect } from "@/components/KoochFormControls";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { BookingCartMobileActionBar, BookingCartSummary } from "@/components/booking/BookingCart";
import { BookingCartProvider, lastBookingSessionCodeKey, useBookingCart } from "@/components/booking/BookingCartProvider";
import { createBookingSessionFromCart, revalidateBookingCart } from "@/components/booking/booking-checkout";
import { fetchBookingOptions, type PublicBookingOptions } from "@/lib/booking-sessions";
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const auth = useAuthSession();
  const cart = useBookingCart();
  const [options, setOptions] = useState<PublicBookingOptions | null>(null);
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(null);
  const resumedCheckout = useRef(false);

  const selectedOption = useMemo(
    () => options?.roomTypes.find((item) => item.roomTypeId === Number(selectedRoomTypeId)) ?? null,
    [options, selectedRoomTypeId],
  );

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
      const first = preferred ?? response.roomTypes[0];
      setSelectedRoomTypeId(first ? String(first.roomTypeId) : "");
      setQuantity(Math.min(Math.max(1, guests.rooms), first?.availableCount ?? 1));
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

  function addToCart() {
    if (!selectedOption || !dates.startDate || !dates.endDate) return;
    try {
      cart.addSelection({
        propertyId,
        propertyName,
        propertySlug,
        bookingMode: selectedOption.bookingMode,
        roomTypeId: selectedOption.roomTypeId,
        roomTypeName: selectedOption.name,
        checkIn: dates.startDate,
        checkOut: dates.endDate,
        adults: guests.adults,
        children: guests.children,
        childAges: guests.childAges,
        notes: null,
        displayAmount: selectedOption.finalAmount,
        currency: selectedOption.currency,
        quantity,
      });
      setMessage({
        tone: "success",
        text: `${quantity.toLocaleString("fa-IR")} واحد از ${selectedOption.name} به سبد رزرو اضافه شد.`,
      });
      toast.success("اتاق به سبد رزرو اضافه شد.");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "افزودن اتاق انجام نشد." });
    }
  }

  async function continueCheckout() {
    if (cart.items.length === 0 || checkingOut) return;
    if (!auth.authenticated) {
      cart.setCheckoutRequested(true);
      const current = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
      router.push(`/login?returnTo=${encodeURIComponent(current)}`);
      return;
    }
    if (!cart.idempotencyKey) return;
    setCheckingOut(true);
    setMessage(null);
    try {
      const refreshed = await revalidateBookingCart(cart.items);
      cart.replaceItems(refreshed.items);
      if (refreshed.priceChanged) {
        cart.setCheckoutRequested(false);
        setMessage({ tone: "info", text: "قیمت به‌روز شده است. مبلغ جدید را بررسی و دوباره ادامه دهید." });
        return;
      }
      const created = await createBookingSessionFromCart(refreshed.items, cart.idempotencyKey);
      sessionStorage.setItem(lastBookingSessionCodeKey, created.sessionCode);
      cart.clear();
      router.push(`/account/booking-sessions/${encodeURIComponent(created.sessionCode)}`);
    } catch (error) {
      cart.setCheckoutRequested(false);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "ساخت سفارش رزرو انجام نشد." });
    } finally {
      setCheckingOut(false);
    }
  }

  useEffect(() => {
    if (!options || !preferredRoomTypeId) return;
    const preferred = options.roomTypes.find(
      (item) => item.roomTypeId === preferredRoomTypeId,
    );
    if (!preferred) return;

    setSelectedRoomTypeId(String(preferred.roomTypeId));
    setQuantity(
      Math.min(Math.max(1, guests.rooms), preferred.availableCount),
    );
  }, [guests.rooms, options, preferredRoomTypeId]);

  useEffect(() => {
    if (!cart.hydrated || auth.loading || !auth.authenticated || !cart.checkoutRequested || resumedCheckout.current) return;
    resumedCheckout.current = true;
    void continueCheckout();
  }, [auth.authenticated, auth.loading, cart.checkoutRequested, cart.hydrated]);

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

      {options && options.roomTypes.length > 0 && (
        <div className="mt-5 grid gap-4 rounded-lg border border-border bg-muted/40 p-4">
          <KoochField label="نوع اتاق">
            <KoochSelect value={selectedRoomTypeId} onChange={(event) => {
              const value = event.target.value;
              const next = options.roomTypes.find((item) => item.roomTypeId === Number(value));
              setSelectedRoomTypeId(value);
              setQuantity(Math.min(Math.max(1, guests.rooms), next?.availableCount ?? 1));
            }}>
              {options.roomTypes.map((item) => <option key={item.roomTypeId} value={item.roomTypeId}>{item.name} — {formatCurrency(item.finalAmount)}</option>)}
            </KoochSelect>
          </KoochField>
          {selectedOption ? (
            <KoochField label="تعداد اتاق">
              <KoochSelect value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}>
                {Array.from({ length: selectedOption.availableCount }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value.toLocaleString("fa-IR")}</option>)}
              </KoochSelect>
            </KoochField>
          ) : null}
          {selectedOption && <p className="text-xs leading-6 text-muted-foreground">{selectedOption.availableCount.toLocaleString("fa-IR")} اتاق قابل رزرو · {selectedOption.bookingMode === "Instant" ? "رزرو آنی" : "نیازمند تأیید مالک"}</p>}
          {selectedOption && (
            <p className="text-sm font-bold text-foreground">
              مبلغ قطعی این بازه برای هر اتاق: {formatCurrency(selectedOption.finalAmount)}
            </p>
          )}
          <KoochButton onClick={addToCart}>افزودن این اتاق به سبد رزرو</KoochButton>
        </div>
      )}

      <BookingCartSummary items={cart.items} loading={checkingOut} onContinue={continueCheckout} onRemove={cart.removeItem} total={cart.total} />
      <BookingCartMobileActionBar count={cart.items.length} loading={checkingOut} onContinue={continueCheckout} total={cart.total} />
    </>
  );
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
