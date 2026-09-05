"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { RoomManagement } from "@/components/owner/RoomManagement";
import { apiRequest, PropertyResponse } from "@/lib/owner-api";

const headerLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function OwnerRoomsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  const { authenticated, loading, workspaces } = useAuthSession();
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || !authenticated || !workspaces.includes("owner")) return;
    apiRequest<PropertyResponse>(`/owner/properties/${propertyId}`)
      .then(setProperty)
      .catch((caught: Error) => setError(caught.message));
  }, [authenticated, loading, propertyId, workspaces]);

  return (
    <OwnerLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <>
              <Link className={headerLinkClass} href="/owner/select-property">
                تغییر اقامتگاه
              </Link>
              {property?.slug && (
                <Link
                  className={headerLinkClass}
                  href={`/properties/${property.slug}`}
                >
                  مشاهده صفحه عمومی
                </Link>
              )}
            </>
          }
          description={property?.name ?? "در حال بارگذاری..."}
          eyebrow="اقامتگاه فعال"
          title="اتاق‌ها"
        />
        {/* {error && (
          <KoochCard className="border-destructive text-destructive" variant="elevated">
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )} */}
        <RoomManagement
          headerAction={
            <Link
              className={headerLinkClass}
              href={`/owner/properties/${propertyId}/pricing`}
            >
              قیمت‌گذاری
            </Link>
          }
          propertyId={propertyId}
        />
      </main>
    </OwnerLayout>
  );
}
