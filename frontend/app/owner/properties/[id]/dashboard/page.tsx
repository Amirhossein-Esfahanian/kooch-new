"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  PricingSettingsWarning,
  usePropertyPricingStatus,
} from "@/components/pricing/PricingWarnings";
import {
  apiRequest,
  getToken,
  ownerPropertyKey,
  PropertyCompletionResponse,
  PropertyResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";

const linkButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function OwnerPropertyDashboardPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);
  const router = useRouter();
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [completion, setCompletion] =
    useState<PropertyCompletionResponse | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [error, setError] = useState("");
  const { warnings: pricingWarnings } = usePropertyPricingStatus(propertyId);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    localStorage.setItem(ownerPropertyKey, propertyId.toString());

    Promise.all([
      apiRequest<PropertyResponse>(`/owner/properties/${propertyId}`),
      apiRequest<PropertyCompletionResponse>(
        `/owner/properties/${propertyId}/completion`,
      ),
      apiRequest<RoomTypeResponse[]>(
        `/owner/properties/${propertyId}/room-types`,
      ),
    ])
      .then(([propertyResult, completionResult, roomTypesResult]) => {
        setProperty(propertyResult);
        setCompletion(completionResult);
        setRoomTypes(roomTypesResult);
      })
      .catch((caught: Error) => setError(caught.message));
  }, [propertyId, router]);

  const cards = [
    {
      title: "تکمیل اطلاعات",
      value: `${completion?.completionPercentage ?? 0}٪`,
      href: `/owner/properties/${propertyId}`,
    },
    {
      title: "نوع اتاق",
      value: roomTypes.length.toString(),
      href: `/owner/properties/${propertyId}/rooms`,
    },
    {
      title: "وضعیت",
      value: property?.status ?? "-",
      href: `/owner/properties/${propertyId}/settings`,
    },
    {
      title: "شهر",
      value: property?.city ?? "-",
      href: `/owner/properties/${propertyId}/settings`,
    },
  ];

  return (
    <OwnerLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <>
              <Link
                className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
                href="/owner/select-property"
              >
                تغییر اقامتگاه
              </Link>
              {property?.slug && (
                <Link
                  className={`${linkButtonClass} border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`}
                  href={`/properties/${property.slug}`}
                >
                  مشاهده صفحه عمومی
                </Link>
              )}
            </>
          }
          description={property?.name ?? "در حال بارگذاری..."}
          eyebrow="اقامتگاه فعال"
          title="داشبورد"
        />

        {error && (
          <KoochCard className="border-destructive/30 bg-destructive/10 text-destructive" padding="sm">
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )}

        <PricingSettingsWarning
          editHref={`/owner/properties/${propertyId}`}
          warnings={pricingWarnings}
        />

        <div className="grid gap-4 md:grid-cols-4">
          {cards.map((card) => (
            <Link href={card.href} key={card.title}>
              <KoochCard
                className="h-full transition hover:border-primary"
                variant="elevated"
              >
                <p className="text-sm font-bold text-muted-foreground">
                  {card.title}
                </p>
                <p className="mt-3 text-2xl font-black text-foreground">
                  {card.value}
                </p>
              </KoochCard>
            </Link>
          ))}
        </div>

        <KoochCard className="mt-5" variant="elevated">
          <h2 className="text-xl font-black text-foreground">کارهای سریع</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              className={`${linkButtonClass} border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`}
              href={`/owner/properties/${propertyId}/inventory`}
            >
              مدیریت ظرفیت
            </Link>
            <Link
              className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
              href={`/owner/properties/${propertyId}/rooms`}
            >
              اتاق‌ها
            </Link>
            <Link
              className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
              href={`/owner/properties/${propertyId}`}
            >
              ویرایش کامل اقامتگاه
            </Link>
          </div>
        </KoochCard>
      </main>
    </OwnerLayout>
  );
}
