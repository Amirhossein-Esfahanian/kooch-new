"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPage } from "@/components/admin/AdminPage";
import { PropertyWizard } from "@/components/owner/PropertyWizard";

export default function AdminPropertyEditPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);

  return (
    <AdminPage title="ویرایش اقامتگاه">
      <div className="mb-4 flex flex-wrap gap-2">
        <Link className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-blue-300" href="/admin/properties">
          بازگشت به مدیریت اقامتگاه‌ها
        </Link>
      </div>
      <PropertyWizard isAdmin mode="edit" propertyId={propertyId} />
    </AdminPage>
  );
}
