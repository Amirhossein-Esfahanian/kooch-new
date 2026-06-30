"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  apiRequest,
  PricingGuestType,
  PropertyPricingResponse,
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
  if (!pricing) return [];

  const days = pricing.roomTypes.flatMap((roomType) => roomType.days);
  if (days.length === 0) return [];

  const warnings: PricingWarningKey[] = [];
  if (!days.some((day) => day.childPrice > 0)) warnings.push("missingChildPrice");
  if (!days.some((day) => day.extraGuestPrice > 0)) warnings.push("missingExtraGuestPrice");
  return warnings;
}

export function isOutlierPrice(
  price: number,
  bounds: PropertyPriceBounds,
) {
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
  if (warnings.length === 0) return null;

  const missingLabels = [
    warnings.includes("missingChildPrice") ? "قیمت کودک" : null,
    warnings.includes("missingExtraGuestPrice") ? "قیمت نفر اضافه" : null,
  ].filter(Boolean);

  return (
    <div
      className={`rounded-xl border border-border bg-muted p-4 text-foreground ${className}`}
      dir="rtl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-black">تنظیمات مالی اقامتگاه کامل نیست.</p>
          <p className="mt-1 text-sm font-semibold leading-6">
            {missingLabels.join(" و ")} برای این اقامتگاه ثبت نشده است. ذخیره قیمت‌ها فعلا مسدود نمی‌شود، اما بهتر است تنظیمات مالی را کامل کنید.
          </p>
        </div>
        <Link
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 py-2 text-sm font-black text-primary-foreground transition hover:bg-[var(--primary-hover)]"
          href={editHref}
        >
          تکمیل تنظیمات مالی
        </Link>
      </div>
    </div>
  );
}
