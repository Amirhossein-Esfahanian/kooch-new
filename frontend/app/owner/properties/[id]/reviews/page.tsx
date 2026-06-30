"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  apiRequest,
  getToken,
  ownerPropertyKey,
  PropertyResponse,
} from "@/lib/owner-api";

export default function OwnerReviewsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    localStorage.setItem(ownerPropertyKey, propertyId.toString());
    apiRequest<PropertyResponse>(`/owner/properties/${propertyId}`)
      .then(setProperty)
      .catch((caught: Error) => setError(caught.message));
  }, [propertyId, router]);

  return (
    <OwnerLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <>
              <Link
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                href="/owner/select-property"
              >
                تغییر اقامتگاه
              </Link>
              {property?.slug && (
                <Link
                  className="inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-[var(--primary-hover)] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  href={`/properties/${property.slug}`}
                >
                  مشاهده صفحه عمومی
                </Link>
              )}
            </>
          }
          description={property?.name ?? "در حال بارگذاری..."}
          eyebrow="اقامتگاه فعال"
          title="نظرات"
        />

        {error && (
          <KoochCard className="border-destructive/30 bg-destructive/10 text-destructive" padding="sm">
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )}

        <KoochCard variant="elevated">
          <h2 className="text-xl font-black text-foreground">نظرات</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            نمایش و پاسخ به نظرات در مرحله بعد تکمیل می‌شود.
          </p>
        </KoochCard>
      </main>
    </OwnerLayout>
  );
}
