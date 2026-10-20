import {
  bookingCartItemsShareContext,
  type BookingCartItem,
} from "@/components/booking/BookingCartProvider";
import {
  createAccountBookingSession,
  fetchBookingQuote,
  fetchBookingOptions,
  validateBookingQuote,
  type AccountBookingSessionCreateResponse,
  type AccountBookingSessionPrimaryGuestRequest,
  type BookingOptionsQuery,
  type PublicBookingOptions,
  type PublicBookingQuote,
  type PublicBookingQuoteRequest,
} from "@/lib/booking-sessions";

type BookingOptionsFetcher = (
  slug: string,
  query: BookingOptionsQuery,
) => Promise<PublicBookingOptions>;
type BookingQuoteFetcher = (slug: string, request: PublicBookingQuoteRequest) => Promise<PublicBookingQuote>;

export interface RevalidatedBookingCart {
  items: BookingCartItem[];
  priceChanged: boolean;
}

export interface BookingCheckoutStayDetails {
  bookingForSelf: boolean;
  primaryGuest: AccountBookingSessionPrimaryGuestRequest | null;
  expectedArrivalTime: string | null;
  expectedArrivalDayOffset: 0 | 1 | null;
  specialRequest: string | null;
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
  quoteFetcher: BookingQuoteFetcher = fetchBookingQuote,
): Promise<RevalidatedBookingCart> {
  if (items.length === 0) throw new Error("سبد رزرو خالی است.");
  if (!bookingCartItemsShareContext(items)) {
    throw new Error("همه اتاق‌های سبد باید تاریخ اقامت و ترکیب مهمان یکسان داشته باشند.");
  }
  if (items[0].stayRooms && items[0].stayRooms > 1) {
    const first = items[0];
    if (items.length !== first.stayRooms || items.some((item) =>
      item.stayRooms !== first.stayRooms || item.propertySlug !== first.propertySlug ||
      item.allocatedAdults === undefined || item.allocatedChildAges === undefined)) {
      throw new Error("ترکیب اتاق‌های سبد کامل نیست؛ دوباره اتاق‌ها را انتخاب کنید.");
    }
    const request: PublicBookingQuoteRequest = {
      checkInDate: first.checkIn,
      checkOutDate: first.checkOut,
      adults: first.adults,
      childAges: first.childAges,
      selections: items.map((item) => ({ roomTypeId: item.roomTypeId,
        ratePlanId: item.ratePlanId, quantity: 1 })),
    };
    const quote = validateBookingQuote(await quoteFetcher(first.propertySlug, request), request, first.propertyId);
    const refreshedItems = items.map((item, index) => {
      const room = quote.rooms[index];
      if (room.bookingMode !== item.bookingMode) {
        throw new Error("شرایط رزرو این اتاق تغییر کرده است؛ اتاق‌ها را دوباره انتخاب کنید.");
      }
      return { ...item, displayAmount: room.finalAmount, currency: room.currency,
        allocatedAdults: room.adults, allocatedChildAges: [...room.childAges] };
    });
    return { items: refreshedItems, priceChanged: refreshedItems.some((item, index) =>
      item.displayAmount !== items[index].displayAmount || item.currency !== items[index].currency) };
  }
  if (items.some((item) => item.stayRooms && item.stayRooms > 1)) {
    throw new Error("ترکیب اتاق‌های سبد یکسان نیست.");
  }
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
      throw new Error(
        `موجودی ${option.name} تغییر کرده است. حداکثر ${option.availableCount.toLocaleString("fa-IR")} واحد در دسترس است؛ تعداد را کاهش دهید یا دوباره موجودی را بررسی کنید.`,
      );
    }
    if (
      item.roomId !== null &&
      !option.rooms.some((room) => room.roomId === item.roomId)
    ) {
      throw new Error("اتاق مشخص‌شده دیگر در این بازه قابل رزرو نیست.");
    }

    const selectedPlan = item.ratePlanId == null
      ? null
      : option.ratePlans?.find((plan) => plan.ratePlanId === item.ratePlanId);
    if (item.ratePlanId != null && !selectedPlan) {
      throw new Error("نرخ فروش انتخاب‌شده دیگر برای این بازه در دسترس نیست.");
    }
    const offer = selectedPlan ?? option;
    priceChanged ||=
      offer.finalAmount !== item.displayAmount ||
      offer.currency !== item.currency;
    return {
      ...item,
      ratePlanId: item.ratePlanId ?? null,
      ratePlanName: selectedPlan?.name ?? null,
      mealPlanName: item.ratePlanId == null
        ? option.defaultMealPlanName ?? null
        : selectedPlan?.mealPlanName ?? null,
      roomTypeName: option.name,
      displayAmount: offer.finalAmount,
      currency: offer.currency,
    };
  });

  return { items: refreshedItems, priceChanged };
}

export function createBookingSessionFromCart(
  items: BookingCartItem[],
  idempotencyKey: string,
  stayDetails: BookingCheckoutStayDetails,
  create: typeof createAccountBookingSession = createAccountBookingSession,
): Promise<AccountBookingSessionCreateResponse> {
  if (!bookingCartItemsShareContext(items)) {
    throw new Error("همه اتاق‌های سبد باید تاریخ اقامت و ترکیب مهمان یکسان داشته باشند.");
  }
  const multiRoom = Boolean(items[0]?.stayRooms && items[0].stayRooms > 1);
  if (multiRoom && (items.length !== items[0].stayRooms || items.some((item) =>
    item.stayRooms !== items[0].stayRooms || item.allocatedAdults === undefined ||
    item.allocatedChildAges === undefined))) {
    throw new Error("ترکیب اتاق‌های سبد کامل نیست؛ دوباره اتاق‌ها را انتخاب کنید.");
  }
  return create({
    idempotencyKey,
    bookingForSelf: stayDetails.bookingForSelf,
    primaryGuest: stayDetails.primaryGuest,
    expectedArrivalTime: stayDetails.expectedArrivalTime,
    expectedArrivalDayOffset: stayDetails.expectedArrivalDayOffset,
    specialRequest: stayDetails.specialRequest,
    ...(multiRoom ? { stayGuests: { adults: items[0].adults, childAges: items[0].childAges } } : {}),
    items: items.map((item) => ({
      roomTypeId: item.roomTypeId,
      ratePlanId: item.ratePlanId ?? null,
      checkInDate: item.checkIn,
      checkOutDate: item.checkOut,
      adults: multiRoom ? 1 : item.adults,
      children: multiRoom ? 0 : item.children,
      childAges: multiRoom ? [] : item.childAges,
      notes: item.notes,
    })),
  });
}
