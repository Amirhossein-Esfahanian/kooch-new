"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { OwnerPanel } from "@/components/owner/OwnerPanel";
import {
  apiRequest,
  bedTypeLabel,
  RoomResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";

type RoomTypeWithRooms = RoomTypeResponse & { rooms: RoomResponse[] };

export default function OwnerRoomsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  const [roomTypes, setRoomTypes] = useState<RoomTypeWithRooms[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<RoomTypeResponse[]>(`/owner/properties/${propertyId}/room-types`)
      .then(async (items) => {
        const withRooms = await Promise.all(
          items.map(async (roomType) => ({
            ...roomType,
            rooms: await apiRequest<RoomResponse[]>(
              `/owner/room-types/${roomType.id}/rooms`,
            ).catch(() => []),
          })),
        );
        setRoomTypes(withRooms);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  return (
    <OwnerPanel propertyId={propertyId} title="اتاق‌ها">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">اتاق‌ها و نوع اتاق</h2>
            <p className="mt-1 text-sm text-slate-500">
              برای افزودن یا ویرایش کامل اتاق‌ها از فرم کامل اقامتگاه استفاده
              کنید.
            </p>
          </div>
          <Link
            className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700"
            href={`/owner/properties/${propertyId}`}
          >
            افزودن / ویرایش
          </Link>
        </div>

        {loading && (
          <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            در حال بارگذاری اتاق‌ها...
          </p>
        )}
        {error && (
          <p className="mt-5 text-sm font-semibold text-red-600">{error}</p>
        )}
        <div className="mt-5 grid gap-4">
          {roomTypes.map((roomType) => (
            <article
              className="rounded-2xl border border-slate-200 p-4"
              key={roomType.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black">{roomType.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {roomType.maxAdults + roomType.maxChildren} نفر · موجودی کل{" "}
                    {roomType.totalInventory}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {roomType.inventoryMode === "NamedRooms"
                      ? "اتاق نام‌دار"
                      : "موجودی تعدادی"}
                  </p>
                </div>
                <Link
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
                  href={`/owner/properties/${propertyId}`}
                >
                  ویرایش
                </Link>
              </div>
              {roomType.bedConfigurations.length > 0 && (
                <p className="mt-3 text-sm text-slate-600">
                  {roomType.bedConfigurations
                    .map(
                      (bed) =>
                        `${bed.quantity} × ${bedTypeLabel(bed.bedTypeSlug, bed.bedTypeName)}`,
                    )
                    .join("، ")}
                </p>
              )}
              {roomType.rooms.length > 0 && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {roomType.rooms.map((room) => (
                    <div
                      className="rounded-xl bg-slate-50 p-3 text-sm"
                      key={room.id}
                    >
                      <strong>{room.name}</strong>
                      <span className="mt-1 block text-xs text-slate-500">
                        طبقه {room.floorNumber ?? "-"} · پله{" "}
                        {room.stairCount ?? "-"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
        {!loading && roomTypes.length === 0 && (
          <p className="mt-5 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            هنوز اتاقی ثبت نشده است.
          </p>
        )}
      </section>
    </OwnerPanel>
  );
}
