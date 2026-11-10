import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", async original => ({ ...await original<typeof import("@/lib/owner-api")>(), apiRequest: request }));
import { getPublicPropertyReviews, getOwnerReviews, saveOwnerReply, getAdminReplies, moderateOwnerReply } from "@/lib/property-reviews";
import { getAdminReviews, setReviewPublication } from "@/lib/admin-reviews";
beforeEach(() => vi.clearAllMocks());
it("requests bounded fresh public and property-scoped pages", async () => {
  await getPublicPropertyReviews("stay / خانه", 2); expect(request.mock.calls[0][0]).toBe(`/properties/${encodeURIComponent("stay / خانه")}/reviews?page=2&pageSize=10`);
  expect(request.mock.calls[0][1].cache).toBe("no-store");
  await getOwnerReviews(2, "Unanswered", 3); expect(request.mock.calls[1][0]).toBe("/owner/properties/2/reviews?filter=Unanswered&page=3&pageSize=20");
  await getAdminReplies("All", 1); expect(request.mock.calls[2][0]).not.toContain("status=");
  await getAdminReviews({ status: "Unpublished", search: "", propertyId: "" }, 1);
  expect(request.mock.calls[3][0]).toContain("status=Approved"); expect(request.mock.calls[3][0]).toContain("published=false");
});
it("sends only revision/text or explicit moderation decision, never guest ratings or actor", async () => {
  await saveOwnerReply(2, 1, "پاسخ", 3); expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ body: "پاسخ", revision: 3 });
  await moderateOwnerReply(4, 3, "reject", "دلیل روشن"); expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ revision: 3, rejectionReason: "دلیل روشن" });
  await moderateOwnerReply(4, 4, "approve", "ignored"); expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ revision: 4 });
  await setReviewPublication(1, 2, false, "دلیل داخلی"); expect(request.mock.calls[3][0]).toBe("/admin/reviews/1/unpublish");
  expect(JSON.parse(request.mock.calls[3][1].body)).toEqual({ revision: 2, reason: "دلیل داخلی" });
});
