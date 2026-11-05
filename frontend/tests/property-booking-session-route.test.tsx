import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ property: vi.fn(), detail: vi.fn() }));
vi.mock("@/components/booking/PropertyGuestAccount", () => ({ PropertyGuestAccount: () => null }));
vi.mock("@/lib/public-properties.server", () => ({ getPublicBookingProperty: api.property }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/booking/BookingSessionDetail", () => ({
  BookingSessionDetail: (props: unknown) => { api.detail(props); return <p>جزئیات احراز‌شده</p>; },
}));

import PropertyBookingSessionPage, { metadata } from "@/app/book/[slug]/reservations/[sessionCode]/page";
import { metadata as successMetadata } from "@/app/book/[slug]/reservations/[sessionCode]/success/page";
import { metadata as failureMetadata } from "@/app/book/[slug]/reservations/[sessionCode]/payment-failure/page";
import MockPage, { metadata as mockMetadata } from "@/app/book/[slug]/reservations/[sessionCode]/mock-payment/page";
import { metadata as genericSuccessMetadata } from "@/app/booking/sessions/[sessionCode]/success/page";
import { metadata as genericFailureMetadata } from "@/app/booking/sessions/[sessionCode]/payment-failure/page";
import { metadata as genericMockMetadata } from "@/app/booking/sessions/[sessionCode]/mock-payment/page";

describe("private Property booking route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.property.mockResolvedValue({ id: 2, name: "اقامتگاه باغ", slug: "garden-house" });
  });

  it("resolves Property server-side and passes only its identity to the authenticated adapter", async () => {
    render(await PropertyBookingSessionPage({ params: Promise.resolve({ slug: "garden-house", sessionCode: "SESSION-1" }) }));
    expect(api.property).toHaveBeenCalledWith("garden-house");
    expect(screen.getByRole("link", { name: "اقامتگاه باغ" }).getAttribute("href")).toBe("/book/garden-house");
    expect(api.detail).toHaveBeenCalledWith({ directProperty: { id: 2, name: "اقامتگاه باغ", slug: "garden-house" } });
  });

  it.each([null, { id: 2, slug: "different-house" }])("rejects absent or mismatched public Property", async (property) => {
    api.property.mockResolvedValue(property);
    await expect(PropertyBookingSessionPage({ params: Promise.resolve({ slug: "garden-house", sessionCode: "SESSION-1" }) })).rejects.toThrow("NOT_FOUND");
    expect(api.detail).not.toHaveBeenCalled();
  });

  it("marks private details noindex without Marketplace title branding", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toEqual({ absolute: "جزئیات رزرو اقامتگاه" });
  });

  it("marks all private payment entry/result routes noindex", () => {
    for (const value of [successMetadata, failureMetadata, mockMetadata, genericSuccessMetadata, genericFailureMetadata, genericMockMetadata]) {
      expect(value.robots).toEqual({ index: false, follow: false });
    }
    expect(successMetadata.title).toEqual({ absolute: "نتیجه پرداخت رزرو اقامتگاه" });
  });

  it("preserves the existing test-provider feature gate on the branded mock route", async () => {
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_TEST_PAYMENTS_ENABLED", "false");
    try {
      await expect(MockPage({ params: Promise.resolve({ slug: "garden-house", sessionCode: "SESSION-1" }) })).rejects.toThrow("NOT_FOUND");
      expect(api.property).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
