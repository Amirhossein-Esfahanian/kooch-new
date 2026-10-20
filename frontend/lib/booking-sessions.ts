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

export interface PublicBookingRatePlanOption {
  ratePlanId: number;
  name: string;
  mealPlanName: string | null;
  mealPlanSlug: string | null;
  minimumNights: number | null;
  finalAmount: number;
  currency: string;
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
  defaultMealPlanName: string | null;
  defaultMealPlanSlug: string | null;
  rooms: PublicBookingRoom[];
  ratePlans?: PublicBookingRatePlanOption[];
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
      | "InsufficientAvailability"
      | "IncompleteDailyPricing";
  }>;
}

export interface PublicBookingRatePlanCandidate {
  ratePlanId: number;
  name: string;
  mealPlanName: string | null;
  mealPlanSlug: string | null;
  minimumNights: number | null;
}

export interface PublicBookingRoomTypeCandidate {
  roomTypeId: number;
  name: string;
  roomKind: RoomKind;
  inventoryMode: BookingInventoryMode;
  availableCount: number;
  bookingMode: BookingMode;
  maxAdults: number;
  maxChildren: number;
  allowExtraGuest: boolean;
  maxExtraGuests: number;
  defaultMealPlanName: string | null;
  defaultMealPlanSlug: string | null;
  rooms: PublicBookingRoom[];
  ratePlans: PublicBookingRatePlanCandidate[];
}

export interface PublicBookingCandidates {
  propertyId: number;
  checkInDate: string;
  checkOutDate: string;
  rooms: number;
  adults: number;
  childAges: number[];
  requiresBookingQuote: true;
  roomTypes: PublicBookingRoomTypeCandidate[];
}

export interface PublicBookingQuoteRequest {
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  childAges: number[];
  selections: Array<{ roomTypeId: number; quantity: number; ratePlanId: number | null }>;
}

export interface PublicBookingQuote {
  propertyId: number;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  childAges: number[];
  rooms: Array<{
    selectedRoomIndex: number;
    roomTypeId: number;
    ratePlanId: number | null;
    adults: number;
    childAges: number[];
    bookingMode: BookingMode;
    finalAmount: number;
    currency: string;
  }>;
  totalAmount: number;
  currency: string;
}

export interface AccountBookingSessionItemRequest {
  roomTypeId: number;
  ratePlanId: number | null;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  childAges: number[];
  notes?: string | null;
}

export interface AccountBookingSessionCreateRequest {
  idempotencyKey: string;
  bookingForSelf: boolean;
  primaryGuest: AccountBookingSessionPrimaryGuestRequest | null;
  expectedArrivalTime: string | null;
  expectedArrivalDayOffset: 0 | 1 | null;
  specialRequest: string | null;
  stayGuests?: { adults: number; childAges: number[] };
  items: AccountBookingSessionItemRequest[];
}

export interface AccountBookingSessionPrimaryGuestRequest {
  firstName: string | null;
  lastName: string | null;
  mobile: string | null;
  email: string | null;
  nationalCode?: string | null;
}

export interface AccountBookingSessionPrimaryGuestResponse {
  firstName: string;
  lastName: string;
  mobile: string | null;
  email: string | null;
  nationalCode?: string | null;
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
  originalTotalAmount: number;
  earliestCheckInDate: string | null;
  latestCheckOutDate: string | null;
  isPaymentReady: boolean;
  canContinueWithApprovedReservations: boolean;
  payableReservationCount: number;
  payableAmount: number;
  continuationPaymentDeadlineUtc: string | null;
  hasPendingApprovals: boolean;
  hasRejectedReservations: boolean;
  hasInconsistentPaymentDeadlines: boolean;
  earliestPaymentDeadlineUtc: string | null;
  earliestApprovalDeadlineUtc: string | null;
  statusCounts: Array<{ status: string; count: number }>;
}

export interface AccountBookingSession {
  sessionCode: string;
  displayCodeLabel: string;
  property: { propertyId: number; name: string; slug: string };
  primaryGuest?: AccountBookingSessionPrimaryGuestResponse | null;
  currency: string;
  expectedArrivalTime?: string | null;
  expectedArrivalDayOffset?: 0 | 1 | null;
  receptionCoordinationRequired?: boolean;
  receptionCoordinationAcknowledgedAtUtc?: string | null;
  specialRequest?: string | null;
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
    approvalExpiresAtUtc: string | null;
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

export interface AccountPaymentProviderOption {
  value: string;
  label: string;
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
  if (query.childAges.length > 0) {
    params.set("childAges", query.childAges.join(","));
  }

  return fetchPublicApi<PublicBookingOptions>(
    `/properties/${encodeURIComponent(slug)}/booking-options?${params.toString()}`,
  );
}

export function fetchBookingCandidates(
  slug: string,
  query: BookingOptionsQuery & { rooms: number },
) {
  const params = new URLSearchParams({
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    rooms: String(query.rooms),
    adults: String(query.adults),
    children: String(query.children),
  });
  if (query.childAges.length > 0) params.set("childAges", query.childAges.join(","));
  return fetchPublicApi<PublicBookingCandidates>(
    `/properties/${encodeURIComponent(slug)}/booking-options/candidates?${params}`,
  );
}

export function fetchBookingQuote(slug: string, request: PublicBookingQuoteRequest) {
  return apiRequest<PublicBookingQuote>(
    `/properties/${encodeURIComponent(slug)}/booking-quote`,
    { method: "POST", body: JSON.stringify(request) },
  );
}

export function validateBookingQuote(
  quote: PublicBookingQuote,
  request: PublicBookingQuoteRequest,
  propertyId: number,
) {
  const selectedRooms = request.selections.flatMap((selection) =>
    Array.from({ length: selection.quantity }, () => selection));
  const allocatedAges = quote.rooms.flatMap((room) => room.childAges).sort((a, b) => a - b);
  const requestedAges = [...request.childAges].sort((a, b) => a - b);
  const currency = quote.currency?.trim();
  if (quote.propertyId !== propertyId || quote.checkInDate !== request.checkInDate ||
      quote.checkOutDate !== request.checkOutDate || quote.adults !== request.adults ||
      quote.childAges.length !== request.childAges.length ||
      quote.childAges.some((age, index) => age !== request.childAges[index]) ||
      quote.rooms.length !== selectedRooms.length || !currency ||
      !Number.isFinite(quote.totalAmount) || quote.totalAmount < 0 ||
      quote.rooms.some((room, index) =>
        room.selectedRoomIndex !== index ||
        room.roomTypeId !== selectedRooms[index].roomTypeId ||
        room.ratePlanId !== selectedRooms[index].ratePlanId ||
        !Number.isInteger(room.adults) || room.adults <= 0 ||
        !Number.isFinite(room.finalAmount) || room.finalAmount < 0 ||
        room.currency !== currency ||
        (room.bookingMode !== "Instant" && room.bookingMode !== "OnRequest")) ||
      quote.rooms.reduce((sum, room) => sum + room.adults, 0) !== request.adults ||
      allocatedAges.length !== requestedAges.length ||
      allocatedAges.some((age, index) => age !== requestedAges[index]) ||
      quote.rooms.reduce((sum, room) => sum + room.finalAmount, 0) !== quote.totalAmount ||
      quote.rooms.some((room) => room.bookingMode !== quote.rooms[0].bookingMode)) {
    throw new Error("پاسخ قیمت‌گذاری با انتخاب فعلی مطابقت ندارد؛ دوباره تلاش کنید.");
  }
  return quote;
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

export function acknowledgeReceptionCoordination(sessionCode: string) {
  return apiRequest<AccountBookingSession>(
    `/account/booking-sessions/${encodeURIComponent(sessionCode)}/reception-coordination/acknowledge`,
    { method: "POST" },
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

export function fetchAccountPaymentProviders() {
  return apiRequest<AccountPaymentProviderOption[]>(
    "/account/booking-sessions/payment-providers",
  );
}

export function initiateAccountBookingSessionPayment(
  sessionCode: string,
  idempotencyKey: string,
  providerKey: string,
) {
  return apiRequest<AccountBookingSessionPaymentInitiation>(
    `/account/booking-sessions/${encodeURIComponent(sessionCode)}/payments`,
    {
      method: "POST",
      body: JSON.stringify({ providerKey, idempotencyKey }),
    },
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
