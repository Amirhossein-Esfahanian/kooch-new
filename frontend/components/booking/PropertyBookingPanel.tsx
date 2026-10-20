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
  fetchBookingCandidates,
  fetchBookingOptions,
  fetchBookingQuote,
  validateBookingQuote,
  type PublicBookingCandidates,
  type PublicBookingOptions,
  type PublicBookingQuote,
  type PublicBookingQuoteRequest,
  type PublicBookingRatePlanOption,
  type PublicBookingRoomTypeOption,
} from "@/lib/booking-sessions";
import type { PublicRoomType } from "@/lib/public-properties";
import { KoochSvgIcon } from "../KoochSvgIcon";

type DateRange = { startDate: string | null; endDate: string | null };
type MultiRoomSelection = { roomTypeId: number; ratePlanId: number | null; quantity: number };
function reconcileMultiSelections(selections: MultiRoomSelection[], candidates: PublicBookingCandidates) {
  const used = new Map<number, number>();
  return selections.flatMap((selection) => {
    const room = candidates.roomTypes.find((item) => item.roomTypeId === selection.roomTypeId);
    if (!room || (selection.ratePlanId !== null &&
        !room.ratePlans.some((plan) => plan.ratePlanId === selection.ratePlanId))) return [];
    const quantity = Math.max(0, Math.min(selection.quantity,
      room.availableCount - (used.get(selection.roomTypeId) ?? 0)));
    used.set(selection.roomTypeId, (used.get(selection.roomTypeId) ?? 0) + quantity);
    return quantity > 0 ? [{ ...selection, quantity }] : [];
  });
}
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
  const [candidates, setCandidates] = useState<PublicBookingCandidates | null>(null);
  const [optionsContextKey, setOptionsContextKey] = useState<string | null>(null);
  const [multiDraft, setMultiDraft] = useState<{ contextKey: string; selections: MultiRoomSelection[] } | null>(null);
  const [quote, setQuote] = useState<PublicBookingQuote | null>(null);
  const [quoteContextKey, setQuoteContextKey] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const quoteRequestId = useRef(0);
  const cartRef = useRef(cart);
  cartRef.current = cart;
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
  const isMultiRoomSearch = guests.rooms > 1;
  const selectedOffers = multiDraft?.contextKey === searchContextKey ? multiDraft.selections : [];
  const selectedRoomCount = selectedOffers.reduce((sum, selection) => sum + selection.quantity, 0);
  const selectedOffersKey = JSON.stringify(selectedOffers);
  const currentQuoteKey = JSON.stringify([searchContextKey, selectedOffersKey]);
  const currentQuoteKeyRef = useRef(currentQuoteKey);
  currentQuoteKeyRef.current = currentQuoteKey;
  const [pendingMultiReplacement, setPendingMultiReplacement] = useState<{
    key: string;
    selections: BookingCartSelection[];
  } | null>(null);
  const [multiReplacementOpen, setMultiReplacementOpen] = useState(false);

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
      stayRooms: guests.rooms,
    }),
  );
  const currentStayCartItems = cartMatchesCurrentStay ? cart.items : [];

  useEffect(() => {
    availabilityRequestId.current += 1;
    quoteRequestId.current += 1;
    setOptions(null);
    setCandidates(null);
    setOptionsContextKey(null);
    setMultiDraft(null);
    setQuote(null);
    setQuoteContextKey(null);
    setQuoteError(null);
    setQuoteLoading(false);
    setPendingMultiReplacement(null);
    setMultiReplacementOpen(false);
    setHasSuccessfulAvailabilitySearch(false);
    setMessage(null);
    setLoadingOptions(false);
  }, [searchContextKey]);

  const candidatesMatchSearch = Boolean(
    candidates?.propertyId === propertyId &&
    candidates?.checkInDate === dates.startDate &&
    candidates?.checkOutDate === dates.endDate &&
    candidates?.rooms === guests.rooms &&
    candidates?.adults === guests.adults &&
    candidates?.childAges.length === guests.childAges.length &&
    candidates.childAges.every((age, index) => age === guests.childAges[index]),
  );
  const hasCandidateResults = Boolean(
    isMultiRoomSearch && !loadingOptions && hasSuccessfulAvailabilitySearch &&
    candidates && optionsContextKey === searchContextKey && candidatesMatchSearch,
  );

  useEffect(() => {
    if (!hasCandidateResults || !cart.hydrated || multiDraft ||
        !cartMatchesCurrentStay || cart.items.length !== guests.rooms ||
        !cart.items.every((item) => item.stayRooms === guests.rooms)) return;
    const selections: MultiRoomSelection[] = [];
    for (const item of cart.items) {
      const match = selections.find((selection) =>
        selection.roomTypeId === item.roomTypeId && selection.ratePlanId === item.ratePlanId);
      if (match) match.quantity += 1;
      else selections.push({ roomTypeId: item.roomTypeId, ratePlanId: item.ratePlanId, quantity: 1 });
    }
    setMultiDraft({ contextKey: searchContextKey,
      selections: reconcileMultiSelections(selections, candidates!) });
  }, [cart.hydrated, cart.items, cartMatchesCurrentStay, guests.rooms,
    hasCandidateResults, multiDraft, searchContextKey, candidates]);

  useEffect(() => {
    const requestId = ++quoteRequestId.current;
    setQuote(null);
    setQuoteContextKey(null);
    setQuoteError(null);
    setQuoteLoading(false);
    setPendingMultiReplacement(null);
    setMultiReplacementOpen(false);
    if (!hasCandidateResults || !candidates || !dates.startDate || !dates.endDate ||
        selectedRoomCount !== guests.rooms) return;

    const request: PublicBookingQuoteRequest = {
      checkInDate: dates.startDate,
      checkOutDate: dates.endDate,
      adults: guests.adults,
      childAges: guests.childAges,
      selections: selectedOffers.map((selection) => ({ ...selection })),
    };
    const expanded = selectedOffers.flatMap((selection) =>
      Array.from({ length: selection.quantity }, () => selection));
    const requestedQuoteKey = currentQuoteKey;
    setQuoteLoading(true);
    void fetchBookingQuote(propertySlug, request).then((response) => {
      if (requestId !== quoteRequestId.current ||
          requestedQuoteKey !== currentQuoteKeyRef.current) return;
      const verified = validateBookingQuote(response, request, propertyId);
      const selections = verified.rooms.map((room, index): BookingCartSelection => {
        const chosen = expanded[index];
        const candidate = candidates.roomTypes.find((item) => item.roomTypeId === chosen.roomTypeId);
        const plan = chosen.ratePlanId === null ? null
          : candidate?.ratePlans.find((item) => item.ratePlanId === chosen.ratePlanId);
        if (!candidate || (chosen.ratePlanId !== null && !plan)) {
          throw new Error("نرخ انتخاب‌شده دیگر در دسترس نیست؛ موجودی را دوباره بررسی کنید.");
        }
        return {
          propertyId, propertyName, propertySlug,
          bookingMode: room.bookingMode,
          roomTypeId: room.roomTypeId,
          ratePlanId: room.ratePlanId,
          ratePlanName: plan?.name ?? null,
          mealPlanName: plan ? plan.mealPlanName : candidate.defaultMealPlanName,
          roomTypeName: candidate.name,
          checkIn: request.checkInDate,
          checkOut: request.checkOutDate,
          adults: request.adults,
          children: request.childAges.length,
          childAges: request.childAges,
          stayRooms: guests.rooms,
          allocatedAdults: room.adults,
          allocatedChildAges: room.childAges,
          notes: null,
          displayAmount: room.finalAmount,
          currency: room.currency,
          quantity: 1,
        };
      });
      setQuote(verified);
      setQuoteContextKey(requestedQuoteKey);
      const activeCart = cartRef.current;
      if (activeCart.items.length > 0 &&
          !bookingCartSelectionMatchesItems(activeCart.items, {
            propertyId, checkIn: request.checkInDate, checkOut: request.checkOutDate,
            adults: request.adults, children: request.childAges.length,
            childAges: request.childAges, stayRooms: guests.rooms,
          })) {
        setPendingMultiReplacement({ key: requestedQuoteKey, selections });
        setMultiReplacementOpen(true);
      } else if (activeCart.bookingMode === selections[0].bookingMode &&
          activeCart.items.length === selections.length &&
          activeCart.items.every((item, index) =>
            item.roomTypeId === selections[index].roomTypeId &&
            item.ratePlanId === (selections[index].ratePlanId ?? null))) {
        activeCart.replaceItems(activeCart.items.map((item, index) => {
          const { quantity: _quantity, ...quoted } = selections[index];
          return { ...item, ...quoted, id: item.id, roomId: item.roomId,
            roomName: item.roomName, ratePlanId: selections[index].ratePlanId ?? null };
        }));
      } else {
        activeCart.replaceWithSelections(selections);
      }
    }).catch((error) => {
      if (requestId !== quoteRequestId.current ||
          requestedQuoteKey !== currentQuoteKeyRef.current) return;
      setQuoteError(error instanceof Error ? error.message : "قیمت‌گذاری ترکیب اتاق‌ها انجام نشد.");
    }).finally(() => {
      if (requestId === quoteRequestId.current &&
          requestedQuoteKey === currentQuoteKeyRef.current) setQuoteLoading(false);
    });
  }, [candidates, currentQuoteKey, dates.endDate, dates.startDate, guests.adults,
    guests.childAges, guests.rooms, hasCandidateResults, propertyId, propertyName,
    propertySlug, quoteRetry, selectedOffersKey, selectedRoomCount]);

  const checkAvailability = useCallback(async () => {
    const requestId = ++availabilityRequestId.current;
    const requestedContextKey = searchContextKey;
    setOptions(null);
    setCandidates(null);
    setOptionsContextKey(null);
    setHasSuccessfulAvailabilitySearch(false);
    if (!dates.startDate || !dates.endDate) {
      setMessage({ tone: "error", text: "تاریخ ورود و خروج را انتخاب کنید." });
      return;
    }
    if (isMultiRoomSearch && guests.adults < guests.rooms) {
      setMessage({ tone: "error", text: "برای هر اتاق انتخاب‌شده دست‌کم یک بزرگسال لازم است." });
      return;
    }
    setLoadingOptions(true);
    setMessage(null);
    try {
      const query = {
        checkIn: dates.startDate,
        checkOut: dates.endDate,
        adults: guests.adults,
        children: guests.children,
        childAges: guests.childAges,
      };
      const response = isMultiRoomSearch
        ? await fetchBookingCandidates(propertySlug, { ...query, rooms: guests.rooms })
        : await fetchBookingOptions(propertySlug, query);
      if (requestId !== availabilityRequestId.current || requestedContextKey !== currentContextKey.current) return;
      if (isMultiRoomSearch) {
        const result = response as PublicBookingCandidates;
        if (result.propertyId !== propertyId || result.checkInDate !== dates.startDate ||
            result.checkOutDate !== dates.endDate || result.rooms !== guests.rooms ||
            result.adults !== guests.adults || !result.requiresBookingQuote ||
            result.childAges.length !== guests.childAges.length ||
            result.childAges.some((age, index) => age !== guests.childAges[index])) {
          throw new Error("نتیجه بررسی اتاق‌ها با جست‌وجوی فعلی مطابقت ندارد.");
        }
        setMultiDraft((draft) => draft?.contextKey === requestedContextKey
          ? { contextKey: requestedContextKey,
              selections: reconcileMultiSelections(draft.selections, result) }
          : draft);
        setCandidates(result);
      } else {
        setOptions(response as PublicBookingOptions);
      }
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
  }, [dates.startDate, dates.endDate, guests.adults, guests.children, guests.childAges,
    guests.rooms, isMultiRoomSearch, propertyId, propertySlug, searchContextKey]);

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

  function changeMultiSelection(roomTypeId: number, ratePlanId: number | null, change: 1 | -1) {
    if (!hasCandidateResults || !candidates) return;
    const candidate = candidates.roomTypes.find((room) => room.roomTypeId === roomTypeId);
    if (!candidate || (ratePlanId !== null &&
        !candidate.ratePlans.some((plan) => plan.ratePlanId === ratePlanId))) return;
    const current = selectedOffers.find((selection) =>
      selection.roomTypeId === roomTypeId && selection.ratePlanId === ratePlanId);
    const roomQuantity = selectedOffers.filter((selection) => selection.roomTypeId === roomTypeId)
      .reduce((sum, selection) => sum + selection.quantity, 0);
    if (change > 0 && selectedOffers.some((selection) =>
        candidates.roomTypes.find((room) => room.roomTypeId === selection.roomTypeId)?.bookingMode !== candidate.bookingMode)) {
      setQuoteError("رزرو آنی و رزرو نیازمند تأیید را نمی‌توان در یک انتخاب ترکیب کرد.");
      return;
    }
    if (change > 0 && (selectedRoomCount >= guests.rooms || roomQuantity >= candidate.availableCount)) return;
    if (change < 0 && !current) return;
    const next = current
      ? selectedOffers.map((selection) => selection === current
          ? { ...selection, quantity: selection.quantity + change } : selection)
          .filter((selection) => selection.quantity > 0)
      : [...selectedOffers, { roomTypeId, ratePlanId, quantity: 1 }];
    quoteRequestId.current += 1;
    setQuote(null);
    setQuoteContextKey(null);
    setQuoteError(null);
    setMultiDraft({ contextKey: searchContextKey, selections: next });
    if (cartMatchesCurrentStay && cart.items.length > 0) cart.clear();
  }

  function removeMultiCartItem(id: string) {
    const item = cart.items.find((entry) => entry.id === id);
    if (!item || !cartMatchesCurrentStay) return;
    quoteRequestId.current += 1;
    setQuote(null);
    setQuoteContextKey(null);
    setMultiDraft((draft) => draft?.contextKey === searchContextKey
      ? { contextKey: searchContextKey, selections: draft.selections.map((selection) =>
          selection.roomTypeId === item.roomTypeId && selection.ratePlanId === item.ratePlanId
            ? { ...selection, quantity: selection.quantity - 1 } : selection)
          .filter((selection) => selection.quantity > 0) }
      : draft);
    cart.removeItem(id);
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

  const hasLegacyResults = Boolean(
    !isMultiRoomSearch && !loadingOptions && hasSuccessfulAvailabilitySearch && options &&
    optionsContextKey === searchContextKey && optionsMatchSearch &&
    options.propertyId === propertyId && options.propertySlug === propertySlug,
  );
  const hasSearchResults = hasLegacyResults || hasCandidateResults;
  const quotedCartMatches = Boolean(
    quote && quoteContextKey === currentQuoteKey && !quoteLoading && !quoteError &&
    cartMatchesCurrentStay && cart.items.length === guests.rooms &&
    cart.total === quote.totalAmount && cart.items.every((item, index) => {
      const room = quote.rooms[index];
      return room && item.roomTypeId === room.roomTypeId && item.ratePlanId === room.ratePlanId &&
        item.bookingMode === room.bookingMode && item.displayAmount === room.finalAmount &&
        item.currency === room.currency && item.allocatedAdults === room.adults &&
        JSON.stringify(item.allocatedChildAges) === JSON.stringify(room.childAges);
    }),
  );
  const canCheckout = isMultiRoomSearch
    ? Boolean(hasCandidateResults && selectedRoomCount === guests.rooms && quotedCartMatches &&
        !pendingMultiReplacement)
    : Boolean(
    hasLegacyResults && cartMatchesCurrentStay && cart.items.length > 0 && options &&
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
    cart.items.length > 0 &&
    !bookingCartSelectionMatchesItems(cart.items, {
      propertyId,
      checkIn: dates.startDate ?? "",
      checkOut: dates.endDate ?? "",
      adults: guests.adults,
      children: guests.children,
      childAges: guests.childAges,
      stayRooms: guests.rooms,
    }),
  );
  const showCartSummary = isMultiRoomSearch ? canCheckout : hasSearchResults && (cart.items.length === 0 || canCheckout);
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
      onRemove={isMultiRoomSearch ? removeMultiCartItem : cart.removeItem}
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
          {isMultiRoomSearch && pendingMultiReplacement?.key === currentQuoteKey && (
            <KoochButton className="mt-2" onClick={() => setMultiReplacementOpen(true)} size="sm" variant="outline">
              جایگزینی سبد با انتخاب جدید
            </KoochButton>
          )}
        </KoochAlert>
      )}
      {isMultiRoomSearch && hasCandidateResults && (
        <div className="mt-4" role="status">
          <p className="text-sm font-semibold text-foreground">
            {selectedRoomCount.toLocaleString("fa-IR")} از {guests.rooms.toLocaleString("fa-IR")} اتاق انتخاب شده
          </p>
          {selectedRoomCount < guests.rooms && (
            <p className="mt-1 text-sm text-muted-foreground">برای دریافت قیمت نهایی، همه اتاق‌ها را انتخاب کنید.</p>
          )}
          {quoteLoading && <p className="mt-1 text-sm text-muted-foreground">در حال بررسی ترکیب اتاق‌ها و قیمت نهایی…</p>}
          {quoteError && (
            <KoochAlert className="mt-2" variant="destructive">
              {quoteError}
              <KoochButton className="mt-2" onClick={() => setQuoteRetry((value) => value + 1)} size="sm" variant="outline">
                تلاش دوباره
              </KoochButton>
            </KoochAlert>
          )}
        </div>
      )}
      {cart.items.length > 0 && !canCheckout && !searchContextDiffersFromCart && !isMultiRoomSearch && (
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
            const option = hasLegacyResults
              ? (options?.roomTypes.find(
                  (item) => item.roomTypeId === roomType.id,
                ) ?? null)
              : null;
            const unavailable = hasLegacyResults
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
            const candidate = hasCandidateResults
              ? candidates?.roomTypes.find((item) => item.roomTypeId === roomType.id) ?? null : null;
            const candidateSelected = selectedOffers.filter((selection) => selection.roomTypeId === roomType.id);
            const candidateTotalSelected = candidateSelected.reduce((sum, selection) => sum + selection.quantity, 0);
            const candidateAvailableToAdd = candidate
              ? Math.max(0, Math.min(guests.rooms - selectedRoomCount,
                  candidate.availableCount - candidateTotalSelected)) : 0;

            return (
              <PublicRoomTypeCard
                booking={
                  hasLegacyResults
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
                candidateBooking={hasCandidateResults ? {
                  option: candidate,
                  availableToAdd: candidateAvailableToAdd,
                  selectedQuantity: candidateSelected.find((selection) => selection.ratePlanId === null)?.quantity ?? 0,
                  totalSelectedQuantity: candidateTotalSelected,
                  onAdd: () => changeMultiSelection(roomType.id, null, 1),
                  onRemove: () => changeMultiSelection(roomType.id, null, -1),
                  ratePlans: candidate?.ratePlans.map((plan) => ({
                    ...plan,
                    selectedQuantity: candidateSelected.find((selection) => selection.ratePlanId === plan.ratePlanId)?.quantity ?? 0,
                    onAdd: () => changeMultiSelection(roomType.id, plan.ratePlanId, 1),
                    onRemove: () => changeMultiSelection(roomType.id, plan.ratePlanId, -1),
                  })) ?? [],
                } : undefined}
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
      <KoochConfirmDialog
        cancelText="حفظ سبد فعلی"
        confirmText="شروع رزرو جدید"
        description="برای ادامه، سبد رزرو فعلی با اتاق‌های انتخاب‌شده و قیمت تأییدشده جایگزین می‌شود."
        onConfirm={() => {
          if (!pendingMultiReplacement || pendingMultiReplacement.key !== currentQuoteKey) return;
          cart.replaceWithSelections(pendingMultiReplacement.selections);
          setPendingMultiReplacement(null);
          setMultiReplacementOpen(false);
        }}
        onOpenChange={setMultiReplacementOpen}
        open={pendingMultiReplacement !== null && multiReplacementOpen}
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
