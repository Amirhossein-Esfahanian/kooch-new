"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import {
  apiRequest,
  PricingGuestType,
  PropertyPricingResponse,
  PropertyResponse,
} from "@/lib/owner-api";

export type PricingWarningKey = "missingChildPrice" | "missingExtraGuestPrice";

export type PropertyPriceBounds = {
  minimum: number | null;
  maximum: number | null;
};

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function currentMonthRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function positivePrices(pricing: PropertyPricingResponse | null) {
  return (
    pricing?.roomTypes
      .flatMap((roomType) => roomType.days)
      .map((day) => day.basePrice)
      .filter((price) => Number.isFinite(price) && price > 0) ?? []
  );
}

export function getPropertyPriceBounds(
  pricing: PropertyPricingResponse | null,
): PropertyPriceBounds {
  const prices = positivePrices(pricing);
  return prices.length
    ? { minimum: Math.min(...prices), maximum: Math.max(...prices) }
    : { minimum: null, maximum: null };
}

export function getPricingWarnings(
  pricing: PropertyPricingResponse | null,
): PricingWarningKey[] {
  return [];
}

export function getPropertyFinancialWarnings(
  property: PropertyResponse | null,
): PricingWarningKey[] {
  if (!property) return [];

  const warnings: PricingWarningKey[] = [];
  if (property.childPrice == null || property.childPrice <= 0) {
    warnings.push("missingChildPrice");
  }
  if (property.extraGuestPrice == null || property.extraGuestPrice <= 0) {
    warnings.push("missingExtraGuestPrice");
  }
  return warnings;
}

export function isOutlierPrice(price: number, bounds: PropertyPriceBounds) {
  return (
    Number.isFinite(price) &&
    ((bounds.minimum !== null && price < bounds.minimum * 0.2) ||
      (bounds.maximum !== null && price > bounds.maximum * 4))
  );
}

export function usePropertyPricingStatus(
  propertyId: number,
  guestType: PricingGuestType = "Iranian",
) {
  const [pricing, setPricing] = useState<PropertyPricingResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!propertyId) return;

    const { from, to } = currentMonthRange();
    setLoading(true);
    apiRequest<PropertyPricingResponse>(
      `/owner/properties/${propertyId}/pricing?from=${from}&to=${to}&guestType=${guestType}`,
    )
      .then(setPricing)
      .catch(() => setPricing(null))
      .finally(() => setLoading(false));
  }, [guestType, propertyId]);

  const warnings = useMemo(() => getPricingWarnings(pricing), [pricing]);
  const priceBounds = useMemo(() => getPropertyPriceBounds(pricing), [pricing]);

  return { loading, priceBounds, pricing, warnings };
}

export function PricingSettingsWarning({
  className = "",
  editHref,
  warnings,
}: {
  className?: string;
  editHref: string;
  warnings: PricingWarningKey[];
}) {
  const router = useRouter();
  if (warnings.length === 0) return null;

  const messages = [
    warnings.includes("missingChildPrice")
      ? "نرخ کودک برای این اقامتگاه تعریف نشده است."
      : null,
    warnings.includes("missingExtraGuestPrice")
      ? "نرخ نفر اضافه برای این اقامتگاه تعریف نشده است."
      : null,
  ].filter(Boolean);

  return (
    <KoochAlert
      className={className}
      dir="rtl"
      title="خظای تنظیمات بخش مالی"
      variant="warning"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <ul className="grid gap-1">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            ذخیره قیمت‌ها فعلا مسدود نمی‌شود، اما بهتر است تنظیمات مالی را کامل
            کنید.
          </p>
        </div>
        <KoochButton
          onClick={() => router.push(editHref)}
          type="button"
          variant="primary"
        >
          تکمیل تنظیمات مالی
        </KoochButton>
      </div>
    </KoochAlert>
  );
}
