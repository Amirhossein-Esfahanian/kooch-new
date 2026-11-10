import { apiRequest, ApiRequestError } from "@/lib/owner-api";
import type { GuestReview } from "@/lib/guest-reviews";
import type { PagedResult } from "@/lib/account-reservations";
import type { OwnerReply } from "@/lib/property-reviews";

export type ReviewModerationStatus = GuestReview["moderationStatus"];
export interface AdminReview {
  review: GuestReview;
  propertyName: string;
  guestDisplayName: string;
  reservationNumber: string | null;
  checkInDate: string;
  checkOutDate: string;
  submittedAtUtc: string;
  moderatedByUserId: number | null;
  moderatedAtUtc: string | null;
  unpublicationReason?: string | null;
  ownerReply?: OwnerReply | null;
}
export interface AdminReviewFilters {
  status: ReviewModerationStatus | "All" | "Unpublished";
  propertyId: string;
  search: string;
}
export function getAdminReviews(filters: AdminReviewFilters, page: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (filters.status !== "All") query.set("status", filters.status === "Unpublished" ? "Approved" : filters.status);
  if (filters.status === "Unpublished" || filters.status === "Approved") query.set("published", String(filters.status === "Approved"));
  if (filters.propertyId) query.set("propertyId", filters.propertyId);
  if (filters.search.trim()) query.set("search", filters.search.trim());
  return apiRequest<PagedResult<AdminReview>>(`/admin/reviews?${query}`, { signal, cache: "no-store" });
}
export const getAdminReview = (id: number, signal?: AbortSignal) =>
  apiRequest<AdminReview>(`/admin/reviews/${id}`, { signal, cache: "no-store" });
export const moderateReview = (id: number, revision: number, action: "approve" | "reject", rejectionReason?: string, signal?: AbortSignal) =>
  apiRequest<AdminReview>(`/admin/reviews/${id}/${action}`, {
    method: "PUT", body: JSON.stringify({ revision, ...(action === "reject" ? { rejectionReason } : {}) }), signal,
  });
export const setReviewPublication = (id: number, revision: number, publish: boolean, reason?: string, signal?: AbortSignal) =>
  apiRequest<AdminReview>(`/admin/reviews/${id}/${publish ? "republish" : "unpublish"}`, {
    method: "PUT", body: JSON.stringify({ revision, ...(publish ? {} : { reason }) }), signal,
  });
export function moderationError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return "نشست شما منقضی شده است؛ دوباره وارد شوید.";
    if (error.status === 403) return "مدیریت نظرات فقط برای مدیر کل سامانه مجاز است.";
    if (error.status === 409) return "نظر تغییر کرده یا قبلاً بررسی شده است. پیش از تصمیم، اطلاعات را دوباره دریافت کنید.";
    if (error.status === 404) return "این نظر دیگر در دسترس نیست. فهرست را دوباره دریافت کنید.";
    if (error.status === 400) return "دلیل رد باید روشن و بین ۵ تا ۱۰۰۰ نویسه باشد. اطلاعات را بررسی کنید.";
  }
  return "درخواست انجام نشد. اتصال را بررسی و اطلاعات را دوباره دریافت کنید.";
}
