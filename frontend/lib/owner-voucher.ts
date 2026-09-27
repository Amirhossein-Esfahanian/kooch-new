import { apiRequest } from "@/lib/owner-api";

export interface OwnerVoucher {
  voucherNumber: string;
  reservationNumber: string;
  issuedAtUtc: string;
  propertyName: string;
  guestName: string;
  guestMobile?: string | null;
  roomTypeName: string;
  roomName: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  adultCount: number;
  childCount: number;
  grossAmount: number;
  currency: string;
  commissionRate: number;
  commissionAmount: number;
  propertyPayableAmount: number;
}

export function getOwnerVoucher(propertyId: number, reservationId: number, signal?: AbortSignal) {
  return apiRequest<OwnerVoucher>(
    `/owner/properties/${propertyId}/reservations/${reservationId}/voucher`,
    { signal },
  );
}
