import { apiRequest, ApiRequestError } from "@/lib/owner-api";
import type { PagedResult } from "@/lib/account-reservations";

export const reviewCategories = [
  ["cleanlinessRating", "نظافت"],
  ["staffRating", "برخورد کارکنان"],
  ["comfortRating", "راحتی و آسایش"],
  ["facilitiesRating", "امکانات"],
  ["locationRating", "موقعیت و دسترسی"],
  ["valueRating", "ارزش برای رزرو"],
] as const;
export type ReviewScoreKey = (typeof reviewCategories)[number][0];
export type GuestReviewRequest = Record<ReviewScoreKey, number> & {
  comment?: string;
  revision?: number;
};
export type GuestReview = Record<ReviewScoreKey, number> & {
  id: number;
  reservationId: number;
  propertyId: number;
  ratingSum: number;
  overallRating: number;
  comment: string;
  moderationStatus: "PendingApproval" | "Approved" | "Rejected";
  isPublished: boolean;
  revision: number;
  rejectionReason?: string | null;
};
export interface EligibleReviewStay {
  reservationId: number;
  reservationNumber: string | null;
  propertyId: number;
  propertyName: string;
  checkOutDate: string;
  submissionDeadlineLocalDate: string;
  reviewId: number | null;
  revision: number | null;
  invitationSuppressed?: boolean;
  invitationPreferenceAvailable?: boolean;
  invitationPage?: number;
}
export interface GuestReviewListItem {
  reservationNumber: string | null;
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
  submissionDeadlineLocalDate: string;
  review: GuestReview;
  canEdit: boolean;
}
export const getEligibleReviewStays = (page = 1, signal?: AbortSignal) =>
  apiRequest<PagedResult<EligibleReviewStay>>(
    `/account/reviews/eligible-reservations?page=${page}&pageSize=20`,
    { signal, cache: "no-store" },
  );
export const getGuestReviews = (page = 1, signal?: AbortSignal) =>
  apiRequest<PagedResult<GuestReviewListItem>>(
    `/account/reviews?page=${page}&pageSize=20`,
    { signal, cache: "no-store" },
  );
export const getGuestReview = (reservationId: number, signal?: AbortSignal) =>
  apiRequest<GuestReview>(`/account/reviews/reservations/${reservationId}`, {
    signal,
    cache: "no-store",
  });
export const guestReviewsChangedEvent = "kooch:guest-reviews-changed";
export function notifyGuestReviewsChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(guestReviewsChangedEvent));
}
export const saveGuestReview = async (
  reservationId: number,
  body: GuestReviewRequest,
  edit: boolean,
  signal?: AbortSignal,
) => {
  const result = await apiRequest<GuestReview>(
    `/account/reviews/reservations/${reservationId}`,
    {
      method: edit ? "PUT" : "POST",
      body: JSON.stringify(body),
      signal,
    },
  );
  notifyGuestReviewsChanged();
  return result;
};
export async function suppressReviewInvitation(
  reservationId: number,
  signal?: AbortSignal,
) {
  const result = await apiRequest<{
    reservationId: number;
    invitationSuppressed: boolean;
  }>(`/account/reviews/reservations/${reservationId}/invitation-suppression`, {
    method: "PUT",
    signal,
  });
  notifyGuestReviewsChanged();
  return result;
}

// The first page may contain only suppressed or already submitted stays.
export async function getAllReviewInvitationStays(
  signal?: AbortSignal,
): Promise<EligibleReviewStay[]> {
  const stays = new Map<number, EligibleReviewStay>();
  let page = 1;
  let pages = 1;
  do {
    const result = await getEligibleReviewStays(page, signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (
      !Number.isInteger(result.totalPages) ||
      result.totalPages < 0 ||
      result.totalPages > 100000
    )
      throw new Error("Invalid invitation pagination");
    pages = result.totalPages;
    for (const stay of result.items) {
      if (stay.reviewId === null && !stay.invitationSuppressed)
        stays.set(stay.reservationId, { ...stay, invitationPage: page });
    }
    page++;
  } while (page <= pages);
  return [...stays.values()].sort(
    (a, b) =>
      b.checkOutDate.localeCompare(a.checkOutDate) ||
      a.reservationId - b.reservationId,
  );
}

export function reviewError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401)
      return "نشست شما منقضی شده است. برای ادامه دوباره وارد شوید.";
    if (error.status === 403) return "اجازه دسترسی به این نظر را ندارید.";
    if (error.status === 503)
      return "این قابلیت هنوز آماده نیست؛ پس از تکمیل راه‌اندازی دوباره تلاش کنید.";
    if (error.status === 404)
      return "رزرو یا نظر در دسترس نیست. فهرست را دوباره دریافت کنید.";
    if (error.message.includes("ReviewRevisionConflict"))
      return "این نظر در پنجره دیگری تغییر کرده است. پیش از ویرایش، فهرست را دوباره دریافت کنید.";
    if (error.message.includes("ReviewAlreadyExists"))
      return "برای این اقامت قبلاً نظر ثبت شده است. فهرست را دوباره دریافت کنید.";
    if (
      error.message.includes("ReviewNotEligible") ||
      error.message.includes("ReviewNotEditable")
    )
      return "این اقامت اکنون قابل ثبت یا ویرایش نظر نیست. فهرست را دوباره دریافت کنید.";
    if (error.status === 409)
      return "اطلاعات نظر تغییر کرده است. فهرست را دوباره دریافت کنید.";
    if (error.status === 400)
      return "اطلاعات پذیرفته نشد. شش امتیاز و محدودیت متن را بررسی کنید.";
  }
  return "ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کنید.";
}

export function reviewStatus(review: GuestReview): string {
  if (review.moderationStatus === "Approved")
    return review.isPublished ? "منتشرشده" : "تأییدشده؛ هنوز منتشر نشده";
  if (review.moderationStatus === "Rejected") return "ردشده";
  if (review.moderationStatus === "PendingApproval") return "در انتظار تأیید";
  return "وضعیت نامشخص";
}

export function reviewDate(value: string): string {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(`${value}T12:00:00+03:30`));
}

export const reviewLinkClass =
  "inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
