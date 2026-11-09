import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", async original => ({ ...await original<typeof import("@/lib/owner-api")>(), apiRequest: request }));
import { getEligibleReviewStays, getGuestReview, getGuestReviews, saveGuestReview } from "@/lib/guest-reviews";

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
