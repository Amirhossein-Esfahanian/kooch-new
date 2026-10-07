import { apiRequest } from "@/lib/owner-api";

export interface GuestVoucher {
  voucherNumber: string;
  reservationNumber: string;
  issuedAtUtc: string;
  propertyName: string;
  guestName: string;
  roomTypeName: string;
  roomName: string | null;
  hasExplicitRatePlan: boolean;
  ratePlanName: string | null;
  mealPlanName: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  adultCount: number;
  childCount: number;
  grossAmount: number;
  currency: string;
}

export function getGuestVoucher(reservationNumber: string, signal?: AbortSignal) {
  return apiRequest<GuestVoucher>(
    `/account/reservations/${encodeURIComponent(reservationNumber)}/voucher`,
    { signal },
  );
}
