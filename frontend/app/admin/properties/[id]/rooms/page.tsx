"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPage } from "@/components/admin/AdminPage";
import { RoomManagement } from "@/components/owner/RoomManagement";

export default function AdminPropertyRoomsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return (
    <AdminPage title="مدیریت اتاق‌ها">
      <div className="mb-4 flex flex-wrap gap-2">
        <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-blue-300" href={`/admin/properties/${propertyId}`}>
          بازگشت به ویرایش اقامتگاه
        </Link>
        <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-blue-300" href="/admin/properties">
          لیست اقامتگاه‌ها
        </Link>
      </div>
      <RoomManagement propertyId={propertyId} />
    </AdminPage>
  );
}
