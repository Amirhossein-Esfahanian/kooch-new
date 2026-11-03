import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBookingSessionRequestFromCart } from "@/components/booking/booking-checkout";
import {
  createPropertyDirectBookingSession,
  replayPropertyDirectBookingSession,
  DirectBookingCheckoutError,
} from "@/components/booking/direct-booking-checkout";
import { expandBookingCartSelection } from "@/components/booking/BookingCartProvider";
import { ApiRequestError } from "@/lib/owner-api";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/owner-api", async (original) => ({
  ...await original<typeof import("@/lib/owner-api")>(), apiRequest: api.request,
}));
import { createAccountBookingSession, issuePropertyDirectBookingContext } from "@/lib/booking-sessions";

const property = { propertyId: 10, propertySlug: "garden-house" };
const details = { bookingForSelf: true, primaryGuest: null,
  expectedArrivalTime: null, expectedArrivalDayOffset: null, specialRequest: null };
const created = { bookingSessionId: 100, sessionCode: "O-100", propertyId: 10, currency: "IRR", reservations: [] };
function request() {
  return buildBookingSessionRequestFromCart(expandBookingCartSelection({
    ...property, propertyName: "خانه باغ", bookingMode: "Instant", roomTypeId: 20,
    ratePlanId: 30, roomTypeName: "اتاق باغ", checkIn: "2030-08-10", checkOut: "2030-08-12",
    adults: 2, children: 2, childAges: [4, 9], notes: null, displayAmount: 100, currency: "IRR", quantity: 1,
  }), "stable-key", details);
}
function context() { return { propertyId: 10, token: "opaque-protected-token", expiresAtUtc: new Date(Date.now() + 1_200_000).toISOString() }; }

beforeEach(() => { vi.clearAllMocks(); });

describe("trusted Property Direct checkout", () => {
  it("issues using the canonical slug and finalized key, then adds only the backend context object", async () => {
    const body = request();
    const issue = vi.fn().mockResolvedValue(context());
    const create = vi.fn().mockResolvedValue(created);
    const mark = vi.fn();
    expect(await createPropertyDirectBookingSession(body, property, mark, () => true, issue, create)).toEqual(created);
    expect(issue).toHaveBeenCalledExactlyOnceWith("garden-house", "stable-key");
    expect(create).toHaveBeenCalledExactlyOnceWith({ ...body, propertyDirectContext: { propertyId: 10, token: "opaque-protected-token" } });
    expect(mark).toHaveBeenCalledOnce();
    expect(body).not.toHaveProperty("propertyDirectContext");
    expect(JSON.stringify(body)).not.toContain("opaque-protected-token");
    expect(JSON.stringify(create.mock.calls[0][0])).not.toMatch(/commissionType|percentage|referralOrigin/i);
  });

  it("renews an already expired issued context once, with the SAME key and no premature create", async () => {
    const issue = vi.fn().mockResolvedValueOnce({ ...context(), expiresAtUtc: "2000-01-01T00:00:00Z" }).mockResolvedValue(context());
    const create = vi.fn().mockResolvedValue(created);
    await createPropertyDirectBookingSession(request(), property, vi.fn(), () => true, issue, create);
    expect(issue.mock.calls).toEqual([["garden-house", "stable-key"], ["garden-house", "stable-key"]]);
    expect(create).toHaveBeenCalledOnce();
  });

  it("renews once on the backend's invalid/expired context response without altering creation identity", async () => {
    const issue = vi.fn().mockResolvedValueOnce(context()).mockResolvedValue({ ...context(), token: "renewed-token" });
    const create = vi.fn().mockRejectedValueOnce(new ApiRequestError("Property Direct booking context is invalid or expired.", 400)).mockResolvedValue(created);
    const body = request();
    await createPropertyDirectBookingSession(body, property, vi.fn(), () => true, issue, create);
    expect(issue).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([value]) => value.idempotencyKey)).toEqual(["stable-key", "stable-key"]);
    expect(create.mock.calls.map(([{ propertyDirectContext: _context, ...value }]) => value)).toEqual([body, body]);
  });

  it("bounds expiry renewal and never automatically retries unrelated validation failures", async () => {
    const issue = vi.fn().mockResolvedValue(context());
    const create = vi.fn().mockRejectedValue(new ApiRequestError("Capacity changed", 400));
    await expect(createPropertyDirectBookingSession(request(), property, vi.fn(), () => true, issue, create)).rejects.toBeInstanceOf(DirectBookingCheckoutError);
    expect(issue).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    issue.mockClear(); create.mockClear();
    issue.mockResolvedValue({ ...context(), expiresAtUtc: "2000-01-01T00:00:00Z" });
    await expect(createPropertyDirectBookingSession(request(), property, vi.fn(), () => true, issue, create)).rejects.toThrow(/منقضی/);
    expect(issue).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 429, 503])("fails closed on issuance %s without creating, logging or falling back", async (status) => {
    const issue = vi.fn().mockRejectedValue(new ApiRequestError("secret-token must never appear", status));
    const create = vi.fn();
    const caught = await createPropertyDirectBookingSession(request(), property, vi.fn(), () => true, issue, create).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(DirectBookingCheckoutError);
    expect((caught as DirectBookingCheckoutError).status).toBe(status);
    expect(String(caught)).not.toContain("secret-token");
    expect(issue).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves the request on network failure and does not automatically repeat a potentially successful POST", async () => {
    const body = request();
    const create = vi.fn().mockRejectedValue(new TypeError("Lost creation response"));
    const mark = vi.fn();
    await expect(createPropertyDirectBookingSession(body, property, mark, () => true, vi.fn().mockResolvedValue(context()), create)).rejects.toThrow(/همان انتخاب‌ها/);
    expect(create).toHaveBeenCalledOnce();
    expect(mark).toHaveBeenCalledOnce();
    expect(body.idempotencyKey).toBe("stable-key");
    const replay = vi.fn().mockResolvedValue(created);
    await replayPropertyDirectBookingSession(body, 10, replay);
    expect(replay).toHaveBeenCalledExactlyOnceWith({ ...body, propertyDirectContext: { propertyId: 10, token: null } });
  });

  it.each([401, 403, 404, 429, 503])("does not automatically retry creation %s or change the key", async (status) => {
    const issue = vi.fn().mockResolvedValue(context());
    const create = vi.fn().mockRejectedValue(new ApiRequestError("protected-data", status));
    const mark = vi.fn();
    await expect(createPropertyDirectBookingSession(request(), property, mark, () => true, issue, create))
      .rejects.toMatchObject({ status });
    expect(issue).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(mark).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].idempotencyKey).toBe("stable-key");
  });

  it.each([
    { propertyId: 11 }, { token: "" }, { expiresAtUtc: "not-a-date" },
  ])("rejects malformed or cross-Property issuance $propertyId $expiresAtUtc", async (overrides) => {
    const create = vi.fn();
    await expect(createPropertyDirectBookingSession(request(), property, vi.fn(), () => true,
      vi.fn().mockResolvedValue({ ...context(), ...overrides }), create)).rejects.toThrow(/مطابقت ندارد/);
    expect(create).not.toHaveBeenCalled();
  });

  it("does not create after the account or cart changes while issuance is pending", async () => {
    let current = true;
    const issue = vi.fn().mockImplementation(async () => { current = false; return context(); });
    const create = vi.fn();
    await expect(createPropertyDirectBookingSession(request(), property, vi.fn(), () => current, issue, create)).rejects.toThrow(/تغییر کرده/);
    expect(create).not.toHaveBeenCalled();
  });

  it("only the exact Phase 3 missing-token rejection allows a new validated attempt after tokenless replay", async () => {
    const create = vi.fn().mockRejectedValue(new ApiRequestError("A matching Property Direct booking context token is required for creation.", 400));
    expect(await replayPropertyDirectBookingSession(request(), 10, create)).toBeNull();
    create.mockRejectedValue(new ApiRequestError("Different booking payload", 409));
    await expect(replayPropertyDirectBookingSession(request(), 10, create)).rejects.toMatchObject({ status: 409 });
    create.mockRejectedValue(new ApiRequestError("Other validation error", 400));
    await expect(replayPropertyDirectBookingSession(request(), 10, create)).rejects.toBeInstanceOf(DirectBookingCheckoutError);
  });

  it("uses the existing authenticated API transport and matches Phase 2/3 DTO field names", async () => {
    api.request.mockResolvedValue(context());
    await issuePropertyDirectBookingContext("garden-house", "stable-key");
    expect(api.request).toHaveBeenCalledWith("/account/property-direct-booking-contexts", {
      method: "POST", body: JSON.stringify({ propertySlug: "garden-house", idempotencyKey: "stable-key" }),
    });
    const body = { ...request(), propertyDirectContext: { propertyId: 10, token: "opaque-protected-token" } };
    await createAccountBookingSession(body);
    expect(api.request).toHaveBeenLastCalledWith("/account/booking-sessions", { method: "POST", body: JSON.stringify(body) });
    const issuanceDto = readFileSync("../backend/Kooch.Api/Dtos/BookingSessions/PropertyDirectBookingContextDtos.cs", "utf8");
    const creationDto = readFileSync("../backend/Kooch.Api/Dtos/BookingSessions/BookingSessionDtos.cs", "utf8");
    expect(issuanceDto).toContain("string PropertySlug");
    expect(issuanceDto).toContain("string IdempotencyKey");
    expect(creationDto).toContain("AccountPropertyDirectBookingContextRequest? PropertyDirectContext");
    expect(creationDto).toContain("string? Token");
    expect(creationDto).toContain("int PropertyId");
  });
});
