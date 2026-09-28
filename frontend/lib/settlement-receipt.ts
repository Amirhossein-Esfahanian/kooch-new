import { apiRequest } from "@/lib/owner-api";

export type SettlementReceiptItem = { reservationNumber: string; payableDueDate: string; amount: number };
export type PropertySettlementReceipt = {
  settlementNumber: string;
  propertyName: string;
  totalAmount: number;
  currency: string;
  paidAtUtc: string;
  paymentMethod: "BankTransfer" | "CardToCard" | "Other";
  referenceNumber: string;
  itemCount: number;
  items: SettlementReceiptItem[];
};
export type AdminSettlementReceipt = PropertySettlementReceipt & { recordedAtUtc: string; note: string | null };

export function getAdminSettlementReceipt(settlementNumber: string, signal?: AbortSignal) {
  return apiRequest<AdminSettlementReceipt>(
    `/admin/settlements/${encodeURIComponent(settlementNumber)}/receipt`, { signal });
}

export function getPropertySettlementReceipt(propertyId: number, settlementNumber: string, signal?: AbortSignal) {
  return apiRequest<PropertySettlementReceipt>(
    `/owner/properties/${propertyId}/settlements/${encodeURIComponent(settlementNumber)}/receipt`, { signal });
}
