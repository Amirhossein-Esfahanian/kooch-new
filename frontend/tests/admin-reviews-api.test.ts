import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", async original => ({ ...await original<typeof import("@/lib/owner-api")>(), apiRequest: request }));
import { getAdminReview, getAdminReviews, moderateReview } from "@/lib/admin-reviews";
beforeEach(() => vi.clearAllMocks());
it("uses authenticated no-store bounded lists with encoded filters and explicit all behavior", async () => {
  await getAdminReviews({ status: "PendingApproval", propertyId: "2", search: "سرای &" }, 2);
  const url = new URL(request.mock.calls[0][0], "http://test.invalid");
  expect(url.pathname).toBe("/admin/reviews"); expect(url.searchParams.get("search")).toBe("سرای &");
  expect(url.searchParams.get("propertyId")).toBe("2"); expect(url.searchParams.get("status")).toBe("PendingApproval");
  expect(url.searchParams.get("page")).toBe("2"); expect(request.mock.calls[0][1].cache).toBe("no-store");
  await getAdminReviews({ status: "All", propertyId: "", search: "" }, 1);
  expect(request.mock.calls[1][0]).toBe("/admin/reviews?page=1&pageSize=20");
  await getAdminReview(1); expect(request.mock.calls[2][0]).toBe("/admin/reviews/1");
});
it("sends revision and safe rejection feedback, never scores, actor or publication flags", async () => {
  await moderateReview(1, 3, "approve", "ignored");
  await moderateReview(1, 4, "reject", "Remove personal information.");
  expect(request.mock.calls[0]).toEqual(["/admin/reviews/1/approve", expect.objectContaining({ method: "PUT", body: JSON.stringify({ revision: 3 }) })]);
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ revision: 4, rejectionReason: "Remove personal information." });
});
