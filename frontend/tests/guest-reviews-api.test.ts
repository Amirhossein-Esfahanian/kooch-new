import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", async original => ({ ...await original<typeof import("@/lib/owner-api")>(), apiRequest: request }));
import { getAllReviewInvitationStays, getEligibleReviewStays, getGuestReview, getGuestReviews, saveGuestReview, suppressReviewInvitation, guestReviewsChangedEvent } from "@/lib/guest-reviews";

beforeEach(() => vi.clearAllMocks());
it("uses shared authenticated paginated no-store GETs", async () => {
  await getGuestReviews(2); await getEligibleReviewStays(3); await getGuestReview(7);
  expect(request.mock.calls.map(call => call[0])).toEqual([
    "/account/reviews?page=2&pageSize=20", "/account/reviews/eligible-reservations?page=3&pageSize=20", "/account/reviews/reservations/7",
  ]);
  expect(request.mock.calls.every(call => call[1].cache === "no-store")).toBe(true);
});
it("POSTs new reviews and PUTs revisions without user or property attribution fields", async () => {
  const body = { cleanlinessRating: 1, staffRating: 2, comfortRating: 3, facilitiesRating: 4, locationRating: 5, valueRating: 6, comment: "" };
  await saveGuestReview(7, body, false); await saveGuestReview(7, { ...body, revision: 3 }, true);
  expect(request.mock.calls[0]).toEqual(["/account/reviews/reservations/7", expect.objectContaining({ method: "POST", body: JSON.stringify(body) })]);
  expect(request.mock.calls[1][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ ...body, revision: 3 }) });
});

it("reads every eligibility page and excludes all submitted and individually suppressed stays", async () => {
  const stay = { reservationId: 1, propertyId: 2, propertyName: "Stay", checkOutDate: "2026-11-07", reviewId: null };
  request.mockResolvedValueOnce({ items: [{ ...stay, invitationSuppressed: true }, { ...stay, reservationId: 2, reviewId: 8 }], totalPages: 2 });
  request.mockResolvedValueOnce({ items: [{ ...stay, reservationId: 3 }], totalPages: 2 });
  expect(await getAllReviewInvitationStays()).toEqual([{ ...stay, reservationId: 3, invitationPage: 2 }]);
  expect(request.mock.calls.map(call => call[0])).toEqual(["/account/reviews/eligible-reservations?page=1&pageSize=20", "/account/reviews/eligible-reservations?page=2&pageSize=20"]);
});
it("sends no user/property identity on opt-out and refreshes invitation state after success", async () => {
  const changed = vi.fn(); window.addEventListener(guestReviewsChangedEvent, changed);
  request.mockResolvedValueOnce({ reservationId: 7, invitationSuppressed: true });
  await suppressReviewInvitation(7);
  expect(request).toHaveBeenCalledWith("/account/reviews/reservations/7/invitation-suppression", { method: "PUT", signal: undefined });
  expect(changed).toHaveBeenCalledOnce(); window.removeEventListener(guestReviewsChangedEvent, changed);
});
