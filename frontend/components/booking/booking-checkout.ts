import type { BookingCartItem } from "@/components/booking/BookingCartProvider";
import {
  createAccountBookingSession,
  fetchBookingOptions,
  type AccountBookingSessionCreateResponse,
  type BookingOptionsQuery,
  type PublicBookingOptions,
} from "@/lib/booking-sessions";

type BookingOptionsFetcher = (
  slug: string,
  query: BookingOptionsQuery,
) => Promise<PublicBookingOptions>;

export interface RevalidatedBookingCart {
  items: BookingCartItem[];
  priceChanged: boolean;
}

function queryKey(item: BookingCartItem) {
  return JSON.stringify([
    item.checkIn,
    item.checkOut,
    item.adults,
    item.children,
    item.childAges,
  ]);
}

export async function revalidateBookingCart(
  items: BookingCartItem[],
  fetcher: BookingOptionsFetcher = fetchBookingOptions,
): Promise<RevalidatedBookingCart> {
  if (items.length === 0) throw new Error("سبد رزرو خالی است.");
  const propertySlug = items[0].propertySlug;
  const groups = new Map<string, BookingCartItem[]>();
  for (const item of items) {
    if (item.propertySlug !== propertySlug) {
      throw new Error("سبد رزرو فقط می‌تواند شامل یک اقامتگاه باشد.");
    }
    const key = queryKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const responses = new Map<string, PublicBookingOptions>();
  await Promise.all(
    [...groups.entries()].map(async ([key, groupedItems]) => {
      const item = groupedItems[0];
      responses.set(
        key,
        await fetcher(propertySlug, {
          checkIn: item.checkIn,
          checkOut: item.checkOut,
          adults: item.adults,
          children: item.children,
          childAges: item.childAges,
        }),
      );
    }),
  );

  const counts = new Map<string, number>();
  for (const item of items) {
    const key = `${queryKey(item)}:${item.roomTypeId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let priceChanged = false;
  const refreshedItems = items.map((item) => {
    const response = responses.get(queryKey(item));
    const option = response?.roomTypes.find(
      (candidate) => candidate.roomTypeId === item.roomTypeId,
    );
    if (!response || response.propertyId !== item.propertyId || !option) {
      throw new Error("یکی از اتاق‌های سبد دیگر برای این بازه موجود نیست.");
    }
    if (option.bookingMode !== item.bookingMode) {
      throw new Error("شرایط رزرو این اتاق تغییر کرده است؛ سبد را دوباره بررسی کنید.");
    }
    if ((counts.get(`${queryKey(item)}:${item.roomTypeId}`) ?? 0) > option.availableCount) {
      throw new Error("تعداد اتاق‌های انتخاب‌شده بیشتر از موجودی فعلی است.");
    }
    if (
      item.roomId !== null &&
      !option.rooms.some((room) => room.roomId === item.roomId)
    ) {
      throw new Error("اتاق مشخص‌شده دیگر در این بازه قابل رزرو نیست.");
    }

    priceChanged ||=
      option.finalAmount !== item.displayAmount ||
      option.currency !== item.currency;
    return {
      ...item,
      roomTypeName: option.name,
      displayAmount: option.finalAmount,
      currency: option.currency,
    };
  });

  return { items: refreshedItems, priceChanged };
}

export function createBookingSessionFromCart(
  items: BookingCartItem[],
  idempotencyKey: string,
  create: typeof createAccountBookingSession = createAccountBookingSession,
): Promise<AccountBookingSessionCreateResponse> {
  return create({
    idempotencyKey,
    items: items.map((item) => ({
      roomTypeId: item.roomTypeId,
      checkInDate: item.checkIn,
      checkOutDate: item.checkOut,
      adults: item.adults,
      children: item.children,
      childAges: item.childAges,
      notes: item.notes,
    })),
  });
}
