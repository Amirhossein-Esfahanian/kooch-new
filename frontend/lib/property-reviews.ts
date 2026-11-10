import { apiRequest, ApiRequestError } from "@/lib/owner-api";
import type { PagedResult } from "@/lib/account-reservations";
import type { GuestReview, ReviewScoreKey } from "@/lib/guest-reviews";

export type ReviewScores = Record<ReviewScoreKey, number>;
export type PublicGuestReview = ReviewScores & {
  id: number; guestDisplayName: string; submittedAtUtc: string; overallRating: number; comment: string;
  ownerReply: { text: string; publishedAtUtc: string | null } | null;
};
export interface PublicReviewPage {
  summary: { count: number; overallRating: number | null; categories: Record<ReviewScoreKey, number | null> };
  reviews: PagedResult<PublicGuestReview>;
}
export interface OwnerReply {
  id: number; reviewId: number; body: string; moderationStatus: GuestReview["moderationStatus"];
  revision: number; rejectionReason: string | null; publishedBody: string | null; publishedAtUtc: string | null;
}
export interface OwnerReview { review: PublicGuestReview; reply: OwnerReply | null }
export type OwnerReviewFilter = "All" | "Unanswered" | "PendingApproval" | "Answered";
export interface AdminOwnerReply { reply: OwnerReply; propertyId: number; propertyName: string;
  guestReview: PublicGuestReview; submittedByUserId: number; moderatedByUserId: number | null; moderatedAtUtc: string | null }

export const getPublicPropertyReviews = (slug: string, page: number, signal?: AbortSignal) =>
  apiRequest<PublicReviewPage>(`/properties/${encodeURIComponent(slug)}/reviews?page=${page}&pageSize=10`, { signal, cache: "no-store" });
export const getOwnerReviews = (propertyId: number, filter: OwnerReviewFilter, page: number, signal?: AbortSignal) =>
  apiRequest<PagedResult<OwnerReview>>(`/owner/properties/${propertyId}/reviews?${new URLSearchParams({ filter, page: String(page), pageSize: "20" })}`, { signal, cache: "no-store" });
export const saveOwnerReply = (propertyId: number, reviewId: number, body: string, revision?: number, signal?: AbortSignal) =>
  apiRequest<OwnerReply>(`/owner/properties/${propertyId}/reviews/${reviewId}/reply`, { method: "PUT", body: JSON.stringify({ body, ...(revision ? { revision } : {}) }), signal });
export const getAdminReplies = (status: string, page: number, signal?: AbortSignal) =>
  apiRequest<PagedResult<AdminOwnerReply>>(`/admin/review-replies?${new URLSearchParams({ page: String(page), pageSize: "20", ...(status === "All" ? {} : { status }) })}`, { signal, cache: "no-store" });
export const moderateOwnerReply = (id: number, revision: number, action: "approve" | "reject", rejectionReason?: string, signal?: AbortSignal) =>
  apiRequest<OwnerReply>(`/admin/review-replies/${id}/${action}`, { method: "PUT", body: JSON.stringify({ revision, ...(action === "reject" ? { rejectionReason } : {}) }), signal });
export function propertyReviewError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return "نشست شما منقضی شده است؛ دوباره وارد شوید.";
    if (error.status === 403) return "اجازهٔ دسترسی یا پاسخ‌گویی به نظرات این اقامتگاه را ندارید.";
    if (error.status === 409) return "اطلاعات تغییر کرده است؛ پیش از اقدام دوباره فهرست را دریافت کنید.";
    if (error.status === 404) return "نظر منتشرشده در دسترس نیست؛ فهرست را دوباره دریافت کنید.";
    if (error.status === 400) return "متن و نسخهٔ پاسخ را بررسی کنید؛ پاسخ حداکثر ۲۰۰۰ نویسه و دلیل رد بین ۵ تا ۱۰۰۰ نویسه است.";
  }
  return "دریافت یا ثبت اطلاعات انجام نشد؛ دوباره تلاش کنید.";
}
