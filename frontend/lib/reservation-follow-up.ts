import { apiRequest } from "@/lib/owner-api";

export interface ReservationFollowUpRecipient {
  userId: number;
  fullName: string;
  email: string | null;
  phoneNumber: string | null;
  isActive: boolean;
}

export interface ReservationFollowUpCandidate {
  userId: number;
  fullName: string;
  email: string | null;
  phoneNumber: string | null;
}

const basePath = (propertyId: number) =>
  `/admin/properties/${propertyId}/reservation-follow-up-recipients`;

export function getReservationFollowUpRecipients(propertyId: number) {
  return apiRequest<ReservationFollowUpRecipient[]>(basePath(propertyId));
}

export function searchReservationFollowUpCandidates(
  propertyId: number,
  search = "",
) {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  const suffix = query.size ? `?${query.toString()}` : "";
  return apiRequest<ReservationFollowUpCandidate[]>(
    `${basePath(propertyId)}/candidates${suffix}`,
  );
}

export function assignReservationFollowUpRecipient(
  propertyId: number,
  userId: number,
) {
  return apiRequest<ReservationFollowUpRecipient>(basePath(propertyId), {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function deactivateReservationFollowUpRecipient(
  propertyId: number,
  userId: number,
) {
  return apiRequest<void>(`${basePath(propertyId)}/${userId}`, {
    method: "DELETE",
  });
}
