"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { OwnerPanel } from "@/components/owner/OwnerPanel";
import {
  apiRequest,
  PropertyCompletionResponse,
  PropertyResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";

export default function OwnerPropertyDashboardPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [completion, setCompletion] =
    useState<PropertyCompletionResponse | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);

  useEffect(() => {
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
      .catch(() => undefined);
  }, [propertyId]);

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
    <OwnerPanel propertyId={propertyId} title="داشبورد">
      <div className="grid gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <Link
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-300"
            href={card.href}
            key={card.title}
          >
            <p className="text-sm font-bold text-slate-500">{card.title}</p>
            <p className="mt-3 text-2xl font-black text-slate-950">
              {card.value}
            </p>
          </Link>
        ))}
      </div>
      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">کارهای سریع</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700"
            href={`/owner/properties/${propertyId}/inventory`}
          >
            مدیریت ظرفیت
          </Link>
          <Link
            className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-700"
            href={`/owner/properties/${propertyId}/rooms`}
          >
            اتاق‌ها
          </Link>
          <Link
            className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-700"
            href={`/owner/properties/${propertyId}`}
          >
            ویرایش کامل اقامتگاه
          </Link>
        </div>
      </section>
    </OwnerPanel>
  );
}
