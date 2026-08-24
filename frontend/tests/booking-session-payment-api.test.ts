import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerApi = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: ownerApi.apiRequest };
});

import {
  fetchAccountPaymentProviders,
  initiateAccountBookingSessionPayment,
} from "@/lib/booking-sessions";

describe("booking-session payment API contract", () => {
  beforeEach(() => {
    ownerApi.apiRequest.mockReset();
  });

  it("returns the typed account payment-provider catalog", async () => {
    const providers = [
      { value: "internal-test", label: "درگاه آزمایشی" },
      { value: "bank", label: "درگاه بانکی" },
    ];
    ownerApi.apiRequest.mockResolvedValue(providers);

    await expect(fetchAccountPaymentProviders()).resolves.toEqual(providers);
    expect(ownerApi.apiRequest).toHaveBeenCalledWith(
      "/account/booking-sessions/payment-providers",
    );
  });

  it("sends the explicitly selected providerKey when initiating payment", async () => {
    ownerApi.apiRequest.mockResolvedValue({ paymentId: 42 });

    await initiateAccountBookingSessionPayment(
      "BS/1405-001",
      "payment-attempt-key",
      "bank",
    );

    expect(ownerApi.apiRequest).toHaveBeenCalledWith(
      "/account/booking-sessions/BS%2F1405-001/payments",
      {
        method: "POST",
        body: JSON.stringify({
          providerKey: "bank",
          idempotencyKey: "payment-attempt-key",
        }),
      },
    );
  });
});
