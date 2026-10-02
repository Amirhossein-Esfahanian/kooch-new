import type { PagedResult } from "@/lib/account-reservations";
import { apiRequest } from "@/lib/owner-api";

export interface AccountNotification {
  id: number;
  eventType: string;
  subject: string | null;
  message: string;
  createdAtUtc: string;
  readAtUtc: string | null;
  isRead: boolean;
  reservationNumber: string | null;
  propertyId: number | null;
}

export function getNotifications(signal?: AbortSignal) {
  return apiRequest<PagedResult<AccountNotification>>(
    "/account/notifications?page=1&pageSize=20",
    { signal },
  );
}

export function getNotificationUnreadCount() {
  return apiRequest<{ unreadCount: number }>(
    "/account/notifications/unread-count",
  );
}

export function markNotificationRead(id: number) {
  return apiRequest<void>(`/account/notifications/${id}/read`, {
    method: "PUT",
  });
}

export function markAllNotificationsRead() {
  return apiRequest<void>("/account/notifications/read-all", {
    method: "PUT",
  });
}
