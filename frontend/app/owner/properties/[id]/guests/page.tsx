"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { GuestManagement } from "@/components/guests/GuestManagement";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  apiRequest,
  getToken,
  ownerPropertyKey,
  PropertyResponse,
} from "@/lib/owner-api";

export default function OwnerGuestsPage() {
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
            <Link href={`/owner/properties/${propertyId}/dashboard`}>
              <KoochButton variant="outline">بازگشت به داشبورد</KoochButton>
            </Link>
          }
          description={property?.name ?? "در حال بارگذاری..."}
          eyebrow="اقامتگاه فعال"
          title="مدیریت مهمان‌ها"
        />

        {error && (
          <KoochCard
            className="border-destructive/30 bg-destructive/10 text-destructive"
            padding="sm"
          >
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )}

        <GuestManagement context="owner" propertyId={propertyId} />
      </main>
    </OwnerLayout>
  );
}
