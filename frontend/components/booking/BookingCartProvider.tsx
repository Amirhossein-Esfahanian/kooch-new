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
  rooms?: Array<{ roomId: number; roomName: string }>;
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

export function expandBookingCartSelection(
  selection: BookingCartSelection,
): BookingCartItem[] {
  const quantity = Math.max(1, Math.floor(selection.quantity));
  const rooms = selection.rooms ?? [];
  if (rooms.length > 0 && rooms.length !== quantity) {
    throw new Error("برای هر اتاق انتخاب‌شده باید یک شناسه اتاق مشخص باشد.");
  }

  const { quantity: _quantity, rooms: _rooms, ...item } = selection;
  return Array.from({ length: quantity }, (_, index) => ({
    ...item,
    id: createIdentifier(),
    roomId: rooms[index]?.roomId ?? null,
    roomName: rooms[index]?.roomName ?? null,
    childAges: [...selection.childAges],
    notes: selection.notes?.trim() || null,
  }));
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
    return {
      propertyId: parsed.propertyId,
      propertyName: parsed.propertyName ?? "",
      propertySlug: parsed.propertySlug,
      bookingMode: parsed.bookingMode,
      idempotencyKey: parsed.idempotencyKey,
      checkoutRequested: Boolean(parsed.checkoutRequested),
      items: parsed.items as BookingCartItem[],
    };
  } catch {
    return null;
  }
}

interface BookingCartContextValue extends BookingCartState {
  total: number;
  addSelection: (selection: BookingCartSelection) => void;
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
    dispatch({ type: "replace", payload: { ...state, items } });
  }, [state]);

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
      removeItem: (itemId) => dispatch({ type: "remove", itemId }),
      setCheckoutRequested,
      replaceItems,
      clear,
    }),
    [addSelection, clear, replaceItems, setCheckoutRequested, state],
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
