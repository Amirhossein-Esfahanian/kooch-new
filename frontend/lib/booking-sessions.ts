import { apiRequest, type RoomKind } from "@/lib/owner-api";
import { fetchPublicApi } from "@/lib/public-properties";

export type BookingMode = "Instant" | "OnRequest";
export type BookingInventoryMode = "NamedRooms" | "TypeBasedInventory";

export interface BookingOptionsQuery {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childAges: number[];
}

export interface PublicBookingRoom {
  roomId: number;
  name: string;
}

export interface PublicBookingRoomTypeOption {
  roomTypeId: number;
  name: string;
  roomKind: RoomKind;
  roomKindCode: string;
  englishName: string | null;
  inventoryMode: BookingInventoryMode;
  availableCount: number;
  bookingMode: BookingMode;
  maxAdults: number;
  maxChildren: number;
  allowExtraGuest: boolean;
  maxExtraGuests: number;
  nightsCount: number;
  finalAmount: number;
  currency: string;
  rooms: PublicBookingRoom[];
}

export interface PublicBookingOptions {
  propertyId: number;
  propertyName: string;
  propertySlug: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  childAges: number[];
  roomTypes: PublicBookingRoomTypeOption[];
  unavailableRoomTypes?: Array<{
    roomTypeId: number;
    name: string;
    roomKind: RoomKind;
    roomKindCode: string;
    reason:
      | "GuestCapacityExceeded"
      | "NoActiveNamedRooms"
      | "InsufficientAvailability";
  }>;
}

export interface AccountBookingSessionItemRequest {
  roomTypeId: number;
  roomId?: number | null;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  childAges: number[];
  notes?: string | null;
}

export interface AccountBookingSessionCreateRequest {
  idempotencyKey: string;
  items: AccountBookingSessionItemRequest[];
}

export interface AccountBookingSessionCreateResponse {
  bookingSessionId: number;
  sessionCode: string;
  propertyId: number;
  currency: string;
  reservations: Array<{
    reservationId: number;
    reservationNumber: string;
    roomTypeId: number;
    roomId: number | null;
    checkInDate: string;
    checkOutDate: string;
    status: string;
    finalAmount: number;
    currency: string;
  }>;
}

export interface AccountBookingSessionSummary {
  derivedStatus: string;
  reservationCount: number;
  totalAmount: number;
  earliestCheckInDate: string | null;
  latestCheckOutDate: string | null;
  isPaymentReady: boolean;
  hasPendingApprovals: boolean;
  hasRejectedReservations: boolean;
  hasInconsistentPaymentDeadlines: boolean;
  earliestPaymentDeadlineUtc: string | null;
  statusCounts: Array<{ status: string; count: number }>;
}

export interface AccountBookingSession {
  sessionCode: string;
  displayCodeLabel: string;
  property: { propertyId: number; name: string; slug: string };
  currency: string;
  totalAmount: number;
  summary: AccountBookingSessionSummary;
  commonPaymentDeadlineUtc: string | null;
  payment: {
    paymentId: number;
    status: string;
    amount: number;
    currency: string;
    provider: string | null;
    appliedAtUtc: string | null;
  } | null;
  reservations: Array<{
    reservationNumber: string;
    roomTypeId: number;
    roomTypeName: string;
    roomId: number | null;
    roomName: string | null;
    checkInDate: string;
    checkOutDate: string;
    status: string;
    paymentExpiresAtUtc: string | null;
    finalAmount: number;
    currency: string;
  }>;
}

export interface AccountBookingSessionListItem {
  sessionCode: string;
  property: { propertyId: number; name: string; slug: string };
  checkInDate: string | null;
  checkOutDate: string | null;
  reservationCount: number;
  totalAmount: number;
  currency: string;
  derivedStatus: string;
  paymentStatus: string | null;
  paymentDeadlineUtc: string | null;
  isPaymentReady: boolean;
}

export interface PagedAccountBookingSessions {
  items: AccountBookingSessionListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AccountBookingSessionPaymentInitiation {
  paymentId: number;
  status: string;
  amount: number;
  currency: string;
  checkoutDestination: string;
  isReplay: boolean;
}

export interface MockPaymentSimulationResult {
  paymentId: number;
  state: "applied" | "failed" | "pending_reconciliation" | "received";
  isDuplicate: boolean;
  redirectDestination: string;
}

export async function fetchBookingOptions(
  slug: string,
  query: BookingOptionsQuery,
) {
  const params = new URLSearchParams({
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    adults: String(query.adults),
    children: String(query.children),
  });
  query.childAges.forEach((age) => params.append("childAges", String(age)));

  return fetchPublicApi<PublicBookingOptions>(
    `/properties/${encodeURIComponent(slug)}/booking-options?${params.toString()}`,
  );
}

export function createAccountBookingSession(
  request: AccountBookingSessionCreateRequest,
) {
  return apiRequest<AccountBookingSessionCreateResponse>(
    "/account/booking-sessions",
    { method: "POST", body: JSON.stringify(request) },
  );
}

export function fetchAccountBookingSession(sessionCode: string) {
  return apiRequest<AccountBookingSession>(
    `/account/booking-sessions/${encodeURIComponent(sessionCode)}`,
  );
}

export function fetchAccountBookingSessions(page = 1, pageSize = 10) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  return apiRequest<PagedAccountBookingSessions>(
    `/account/booking-sessions?${params.toString()}`,
  );
}

export function initiateAccountBookingSessionPayment(
  sessionCode: string,
  idempotencyKey: string,
) {
  return apiRequest<AccountBookingSessionPaymentInitiation>(
    `/account/booking-sessions/${encodeURIComponent(sessionCode)}/payments`,
    { method: "POST", body: JSON.stringify({ idempotencyKey }) },
  );
}

export function simulateMockBookingSessionPayment(
  sessionCode: string,
  succeeded: boolean,
) {
  return apiRequest<MockPaymentSimulationResult>(
    `/dev/booking-sessions/${encodeURIComponent(sessionCode)}/mock-payment`,
    { method: "POST", body: JSON.stringify({ succeeded }) },
  );
}
