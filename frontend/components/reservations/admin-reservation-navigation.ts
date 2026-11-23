import type { ReservationTableStatus } from "./ReservationTable";

type ReservationStatusFilter = "" | ReservationTableStatus;
type ReservationBookingModeFilter = "" | "Instant" | "OnRequest";
type ReservationSourceFilter =
  | ""
  | "Website"
  | "PhoneReferral"
  | "AdminCreated"
  | "ExternalChannel";
type PaymentStatusFilter =
  | ""
  | "Pending"
  | "Successful"
  | "Failed"
  | "Refunded";

export interface ReservationListQuery {
  propertyId: string;
  reservationNumber: string;
  status: ReservationStatusFilter;
  pendingCancellationRequest: "" | "true";
  bookingMode: ReservationBookingModeFilter;
  roomTypeId: string;
  roomId: string;
  roomSearch: string;
  checkInFrom: string;
  checkInTo: string;
  checkOutFrom: string;
  checkOutTo: string;
  createdFrom: string;
  createdTo: string;
  guestSearch: string;
  totalPriceMin: string;
  totalPriceMax: string;
  paidAmountMin: string;
  paidAmountMax: string;
  remainingAmountMin: string;
  remainingAmountMax: string;
  source: ReservationSourceFilter;
  createdBy: string;
  paymentStatus: PaymentStatusFilter;
}


export const initialFilters: ReservationListQuery = {
  propertyId: "",
  reservationNumber: "",
  status: "",
  pendingCancellationRequest: "",
  bookingMode: "",
  roomTypeId: "",
  roomId: "",
  roomSearch: "",
  checkInFrom: "",
  checkInTo: "",
  checkOutFrom: "",
  checkOutTo: "",
  createdFrom: "",
  createdTo: "",
  guestSearch: "",
  totalPriceMin: "",
  totalPriceMax: "",
  paidAmountMin: "",
  paidAmountMax: "",
  remainingAmountMin: "",
  remainingAmountMax: "",
  source: "",
  createdBy: "",
  paymentStatus: "",
};

const listPath = "/admin/reservations";
type Query = Pick<URLSearchParams, "get">;

export function readReservationListState(params: Query) {
  const filters = { ...initialFilters };
  for (const key of Object.keys(filters) as Array<keyof ReservationListQuery>) {
    Object.assign(filters, { [key]: (params.get(key === "reservationNumber" ? "filterReservationNumber" : key) ?? "").trim() });
  }
  const rawPage = params.get("page");
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) ? Number(rawPage) : 1;
  return { filters, page };
}

export function reservationListHref(filters: ReservationListQuery, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim()) params.set(key === "reservationNumber" ? "filterReservationNumber" : key, value.trim());
  }
  if (page > 1) params.set("page", String(page));
  return listPath + (params.size ? `?${params}` : "");
}

export function safeReservationReturnHref(value: string | null) {
  if (!value || !value.startsWith(listPath) || value.startsWith("//")) return listPath;
  try {
    const url = new URL(value, "https://kooch.invalid");
    if (url.origin !== "https://kooch.invalid" || url.pathname !== listPath || url.hash) return listPath;
    const { filters, page } = readReservationListState(url.searchParams);
    return reservationListHref(filters, page);
  } catch { return listPath; }
}

export function reservationDetailsHref(id: number, returnTo = listPath) {
  const target = safeReservationReturnHref(returnTo);
  return `${listPath}/${id}${target === listPath ? "" : `?returnTo=${encodeURIComponent(target)}`}`;
}

export function reservationFinancialHref(id: number, returnTo = listPath) {
  const href = reservationDetailsHref(id, returnTo);
  return `${href}${href.includes("?") ? "&" : "?"}tab=financial`;
}
