"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import type { BookingMode } from "@/lib/booking-sessions";

export const bookingCartStorageKey = "kooch_booking_cart_v1";
export const lastBookingSessionCodeKey = "kooch_last_booking_session_code";

export interface BookingCartItem {
  id: string;
  propertyId: number;
  propertyName: string;
  propertySlug: string;
  bookingMode: BookingMode;
  roomTypeId: number;
  roomTypeName: string;
  roomId: number | null;
  roomName: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childAges: number[];
  notes: string | null;
  displayAmount: number;
  currency: string;
}

export interface BookingCartSelection
  extends Omit<BookingCartItem, "id" | "roomId" | "roomName"> {
  quantity: number;
}

export interface BookingCartState {
  hydrated: boolean;
  propertyId: number | null;
  propertyName: string;
  propertySlug: string;
  bookingMode: BookingMode | null;
  idempotencyKey: string | null;
  checkoutRequested: boolean;
  items: BookingCartItem[];
}

export interface BookingCartStayContext {
  propertyId: number;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childAges: number[];
}

interface CartAwareAvailabilityInput {
  items: BookingCartItem[];
  propertyId: number;
  roomTypeId: number;
  checkIn: string;
  checkOut: string;
  serverAvailableCount: number;
}

type StoredBookingCart = Omit<BookingCartState, "hydrated">;
type BookingCartAction =
  | { type: "hydrate"; payload: StoredBookingCart | null }
  | { type: "replace"; payload: BookingCartState }
  | { type: "remove"; itemId: string }
  | { type: "checkout-requested"; value: boolean }
  | { type: "clear" };

const emptyCart: BookingCartState = {
  hydrated: false,
  propertyId: null,
  propertyName: "",
  propertySlug: "",
  bookingMode: null,
  idempotencyKey: null,
  checkoutRequested: false,
  items: [],
};

function cartReducer(
  state: BookingCartState,
  action: BookingCartAction,
): BookingCartState {
  if (action.type === "hydrate") {
    return action.payload
      ? { ...action.payload, hydrated: true }
      : { ...emptyCart, hydrated: true };
  }
  if (action.type === "replace") return action.payload;
  if (action.type === "checkout-requested") {
    return { ...state, checkoutRequested: action.value };
  }
  if (action.type === "remove") {
    const items = state.items.filter((item) => item.id !== action.itemId);
    return items.length > 0
      ? { ...state, items }
      : { ...emptyCart, hydrated: true };
  }
  return { ...emptyCart, hydrated: true };
}

function createIdentifier() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function expandStayNights(checkIn: string, checkOut: string): string[] {
  const start = parseIsoDate(checkIn);
  const end = parseIsoDate(checkOut);
  if (start === null || end === null || start >= end) return [];

  const nights: string[] = [];
  for (let current = start; current < end; current += 86_400_000) {
    nights.push(new Date(current).toISOString().slice(0, 10));
  }
  return nights;
}

export function getCartAwareAvailableCount({
  items,
  propertyId,
  roomTypeId,
  checkIn,
  checkOut,
  serverAvailableCount,
}: CartAwareAvailabilityInput): number {
  const requestedNights = expandStayNights(checkIn, checkOut);
  if (requestedNights.length === 0) return 0;

  const requestedNightSet = new Set(requestedNights);
  const demandByNight = new Map<string, number>();
  for (const item of items) {
    if (item.propertyId !== propertyId || item.roomTypeId !== roomTypeId) continue;
    for (const night of expandStayNights(item.checkIn, item.checkOut)) {
      if (!requestedNightSet.has(night)) continue;
      demandByNight.set(night, (demandByNight.get(night) ?? 0) + 1);
    }
  }

  return Math.max(
    0,
    Math.min(
      ...requestedNights.map(
        (night) => Math.floor(serverAvailableCount) - (demandByNight.get(night) ?? 0),
      ),
    ),
  );
}

function parseIsoDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? timestamp
    : null;
}

export function expandBookingCartSelection(
  selection: BookingCartSelection,
): BookingCartItem[] {
  const quantity = Math.max(1, Math.floor(selection.quantity));
  const { quantity: _quantity, ...item } = selection;
  return Array.from({ length: quantity }, () => ({
    ...item,
    id: createIdentifier(),
    roomId: null,
    roomName: null,
    childAges: [...selection.childAges],
    notes: selection.notes?.trim() || null,
  }));
}

export function getBookingCartStayContext(
  items: BookingCartItem[],
): BookingCartStayContext | null {
  if (items.length === 0) return null;
  const first = items[0];
  return {
    propertyId: first.propertyId,
    checkIn: first.checkIn,
    checkOut: first.checkOut,
    adults: first.adults,
    children: first.children,
    childAges: [...first.childAges],
  };
}

export function bookingCartContextMatches(
  context: BookingCartStayContext,
  candidate: BookingCartStayContext,
) {
  return context.propertyId === candidate.propertyId &&
    context.checkIn === candidate.checkIn &&
    context.checkOut === candidate.checkOut &&
    context.adults === candidate.adults &&
    context.children === candidate.children &&
    context.childAges.length === candidate.childAges.length &&
    context.childAges.every((age, index) => age === candidate.childAges[index]);
}

export function bookingCartSelectionMatchesItems(
  items: BookingCartItem[],
  selection: BookingCartStayContext,
) {
  const context = getBookingCartStayContext(items);
  return context === null || bookingCartContextMatches(context, selection);
}

export function bookingCartItemsShareContext(items: BookingCartItem[]) {
  const context = getBookingCartStayContext(items);
  if (context === null) return true;
  const bookingMode = items[0].bookingMode;
  return items.every(
    (item) =>
      bookingCartContextMatches(context, item) &&
      item.bookingMode === bookingMode,
  );
}

export function addItemsToBookingCart(
  state: BookingCartState,
  additions: BookingCartItem[],
): BookingCartState {
  if (additions.length === 0) return state;
  const first = additions[0];
  if (state.propertyId !== null && state.propertyId !== first.propertyId) {
    throw new Error("سبد رزرو فقط می‌تواند شامل یک اقامتگاه باشد.");
  }
  if (state.bookingMode !== null && state.bookingMode !== first.bookingMode) {
    throw new Error("رزرو آنی و رزرو نیازمند تأیید را نمی‌توان در یک سبد ترکیب کرد.");
  }
  if (
    additions.some(
      (item) =>
        item.propertyId !== first.propertyId ||
        item.bookingMode !== first.bookingMode,
    )
  ) {
    throw new Error("همه اتاق‌های افزوده‌شده باید شرایط یکسان داشته باشند.");
  }
  if (!bookingCartItemsShareContext(additions)) {
    throw new Error("همه اتاق‌های افزوده‌شده باید یک تاریخ و ترکیب مهمان داشته باشند.");
  }
  if (!bookingCartItemsShareContext(state.items)) {
    throw new Error("سبد رزرو فعلی دارای اطلاعات اقامت ناسازگار است و باید دوباره ساخته شود.");
  }
  if (!bookingCartSelectionMatchesItems(state.items, first)) {
    throw new Error("سبد رزرو فقط می‌تواند شامل یک تاریخ اقامت و ترکیب مهمان باشد.");
  }

  const existingRoomIds = new Set(
    state.items.flatMap((item) => (item.roomId === null ? [] : [item.roomId])),
  );
  for (const item of additions) {
    if (item.roomId !== null && existingRoomIds.has(item.roomId)) {
      throw new Error("این اتاق قبلاً به سبد رزرو اضافه شده است.");
    }
    if (item.roomId !== null) existingRoomIds.add(item.roomId);
  }

  return {
    ...state,
    hydrated: true,
    propertyId: first.propertyId,
    propertyName: first.propertyName,
    propertySlug: first.propertySlug,
    bookingMode: first.bookingMode,
    idempotencyKey: state.idempotencyKey ?? createIdentifier(),
    items: [...state.items, ...additions],
  };
}

export function restoreBookingCart(value: string | null): StoredBookingCart | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredBookingCart>;
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    if (
      typeof parsed.propertyId !== "number" ||
      typeof parsed.propertySlug !== "string" ||
      (parsed.bookingMode !== "Instant" && parsed.bookingMode !== "OnRequest") ||
      typeof parsed.idempotencyKey !== "string"
    ) {
      return null;
    }
    if (!parsed.items.every(isBookingCartItem)) return null;
    const items = parsed.items;
    if (
      !bookingCartItemsShareContext(items) ||
      items.some(
        (item) =>
          item.propertyId !== parsed.propertyId ||
          item.bookingMode !== parsed.bookingMode,
      )
    ) {
      return null;
    }
    return {
      propertyId: parsed.propertyId,
      propertyName: parsed.propertyName ?? "",
      propertySlug: parsed.propertySlug,
      bookingMode: parsed.bookingMode,
      idempotencyKey: parsed.idempotencyKey,
      checkoutRequested: Boolean(parsed.checkoutRequested),
      items,
    };
  } catch {
    return null;
  }
}

function isBookingCartItem(value: unknown): value is BookingCartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BookingCartItem>;
  return typeof item.id === "string" &&
    typeof item.propertyId === "number" &&
    typeof item.propertyName === "string" &&
    typeof item.propertySlug === "string" &&
    (item.bookingMode === "Instant" || item.bookingMode === "OnRequest") &&
    typeof item.roomTypeId === "number" &&
    typeof item.roomTypeName === "string" &&
    (item.roomId === null || typeof item.roomId === "number") &&
    (item.roomName === null || typeof item.roomName === "string") &&
    typeof item.checkIn === "string" &&
    typeof item.checkOut === "string" &&
    expandStayNights(item.checkIn, item.checkOut).length > 0 &&
    typeof item.adults === "number" &&
    typeof item.children === "number" &&
    Array.isArray(item.childAges) &&
    item.childAges.every((age) => typeof age === "number") &&
    (item.notes === null || typeof item.notes === "string") &&
    typeof item.displayAmount === "number" &&
    typeof item.currency === "string";
}

interface BookingCartContextValue extends BookingCartState {
  total: number;
  addSelection: (selection: BookingCartSelection) => void;
  replaceWithSelection: (selection: BookingCartSelection) => void;
  removeItem: (itemId: string) => void;
  setCheckoutRequested: (value: boolean) => void;
  replaceItems: (items: BookingCartItem[]) => void;
  clear: () => void;
}

const BookingCartContext = createContext<BookingCartContextValue | null>(null);

export function BookingCartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, emptyCart);

  useEffect(() => {
    dispatch({
      type: "hydrate",
      payload: restoreBookingCart(sessionStorage.getItem(bookingCartStorageKey)),
    });
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    if (state.items.length === 0) {
      sessionStorage.removeItem(bookingCartStorageKey);
      return;
    }
    const { hydrated: _hydrated, ...stored } = state;
    sessionStorage.setItem(bookingCartStorageKey, JSON.stringify(stored));
  }, [state]);

  const addSelection = useCallback((selection: BookingCartSelection) => {
    const additions = expandBookingCartSelection(selection);
    dispatch({
      type: "replace",
      payload: addItemsToBookingCart(state, additions),
    });
  }, [state]);

  const replaceItems = useCallback((items: BookingCartItem[]) => {
    if (!bookingCartItemsShareContext(items)) {
      throw new Error("اطلاعات اقامت سبد رزرو یکسان نیست.");
    }
    dispatch({ type: "replace", payload: { ...state, items } });
  }, [state]);

  const replaceWithSelection = useCallback((selection: BookingCartSelection) => {
    const additions = expandBookingCartSelection(selection);
    dispatch({
      type: "replace",
      payload: addItemsToBookingCart(
        { ...emptyCart, hydrated: true },
        additions,
      ),
    });
  }, []);

  const setCheckoutRequested = useCallback((next: boolean) => {
    const nextState = { ...state, checkoutRequested: next };
    if (nextState.items.length > 0) {
      const { hydrated: _hydrated, ...stored } = nextState;
      sessionStorage.setItem(bookingCartStorageKey, JSON.stringify(stored));
    }
    dispatch({ type: "checkout-requested", value: next });
  }, [state]);

  const clear = useCallback(() => {
    sessionStorage.removeItem(bookingCartStorageKey);
    dispatch({ type: "clear" });
  }, []);

  const value = useMemo<BookingCartContextValue>(
    () => ({
      ...state,
      total: state.items.reduce((sum, item) => sum + item.displayAmount, 0),
      addSelection,
      replaceWithSelection,
      removeItem: (itemId) => dispatch({ type: "remove", itemId }),
      setCheckoutRequested,
      replaceItems,
      clear,
    }),
    [addSelection, clear, replaceItems, replaceWithSelection, setCheckoutRequested, state],
  );

  return (
    <BookingCartContext.Provider value={value}>
      {children}
    </BookingCartContext.Provider>
  );
}

export function useBookingCart() {
  const context = useContext(BookingCartContext);
  if (!context) {
    throw new Error("useBookingCart must be used within BookingCartProvider.");
  }
  return context;
}
