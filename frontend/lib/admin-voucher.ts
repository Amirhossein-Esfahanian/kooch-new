import { apiRequest } from "@/lib/owner-api";
import type { OwnerVoucher } from "@/lib/owner-voucher";

export function getAdminVoucher(reservationId: number, signal?: AbortSignal) {
  return apiRequest<OwnerVoucher>(`/admin/reservations/${reservationId}/voucher`, { signal });
}
