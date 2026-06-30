"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochSelect } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import {
  apiRequest,
  getToken,
  PropertyResponse,
  PropertyStatus,
} from "@/lib/owner-api";

const statuses: PropertyStatus[] = [
  "Draft",
  "PendingReview",
  "Approved",
  "Rejected",
  "Suspended",
];

const statusLabels: Record<PropertyStatus, string> = {
  Draft: "پیش‌نویس",
  PendingReview: "در انتظار تایید",
  Approved: "تایید شده",
  Rejected: "رد شده",
  Suspended: "تعلیق شده",
};

import { KoochIcon } from "@/components/KoochIcon";

const actionLinkClass =
  "inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function AdminPropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(
    async () =>
      setProperties(await apiRequest<PropertyResponse[]>("/admin/properties")),
    [],
  );

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    load()
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [load, router]);

  async function setStatus(id: number, status: PropertyStatus) {
    setWorkingId(id);
    setError("");
    try {
      const updated = await apiRequest<PropertyResponse>(
        `/admin/properties/${id}/status`,
        { method: "PUT", body: JSON.stringify({ status }) },
      );
      setProperties((current) =>
        current.map((property) => (property.id === id ? updated : property)),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تغییر وضعیت اقامتگاه انجام نشد.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          description="اقامتگاه‌ها، وضعیت بررسی، ظرفیت و قیمت‌گذاری را از همین صفحه مدیریت کنید."
          eyebrow="پنل مدیریت"
          title="مدیریت اقامتگاه‌ها"
        />

        {error && (
          <KoochCard
            className="border-destructive text-destructive"
            variant="elevated"
          >
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )}

        {loading && (
          <KoochCard variant="elevated">
            <p className="text-sm text-muted-foreground">
              در حال بارگذاری اقامتگاه‌ها...
            </p>
          </KoochCard>
        )}

        {!loading && properties.length === 0 && (
          <KoochCard
            className="border-dashed text-center"
            padding="lg"
            variant="elevated"
          >
            <p className="text-sm text-muted-foreground">اقامتگاهی پیدا نشد.</p>
          </KoochCard>
        )}

        {!loading && properties.length > 0 && (
          <KoochTable>
            <KoochTableHeader>
              <KoochTableRow>
                <KoochTableHead className="w-14">ردیف</KoochTableHead>
                <KoochTableHead>نام</KoochTableHead>
                <KoochTableHead>شهر</KoochTableHead>
                <KoochTableHead>مالک</KoochTableHead>
                <KoochTableHead>وضعیت</KoochTableHead>
                <KoochTableHead>تاریخ ایجاد</KoochTableHead>
                <KoochTableHead className="min-w-[280px]">
                  عملیات
                </KoochTableHead>
              </KoochTableRow>
            </KoochTableHeader>
            <KoochTableBody>
              {properties.map((property, index) => (
                <KoochTableRow key={property.id}>
                  <KoochTableCell className="font-bold text-muted-foreground">
                    {index + 1}
                  </KoochTableCell>
                  <KoochTableCell>
                    <p className="font-black text-foreground">
                      {property.name}
                    </p>
                    {property.englishName && (
                      <p className="text-xs text-muted-foreground" dir="ltr">
                        {property.englishName}
                      </p>
                    )}
                  </KoochTableCell>
                  <KoochTableCell>{property.city}</KoochTableCell>
                  <KoochTableCell className="text-muted-foreground">
                    {property.ownerName || property.ownerId}
                    <br />
                    <span className="text-xs text-muted-foreground">
                      {property.ownerEmail}
                    </span>
                  </KoochTableCell>
                  <KoochTableCell>
                    <KoochSelect
                      disabled={workingId === property.id}
                      onChange={(event) =>
                        setStatus(
                          property.id,
                          event.target.value as PropertyStatus,
                        )
                      }
                      value={property.status}
                    >
                      {statuses.map((status) => (
                        <option key={status} value={status}>
                          {statusLabels[status]}
                        </option>
                      ))}
                    </KoochSelect>
                  </KoochTableCell>
                  <KoochTableCell className="text-xs text-muted-foreground">
                    {new Date(property.createdAtUtc).toLocaleDateString(
                      "fa-IR",
                    )}
                  </KoochTableCell>
                  <KoochTableCell>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        className={actionLinkClass}
                        href={`/admin/properties/${property.id}`}
                        title="ویرایش"
                      >
                        <KoochIcon name="edit" />
                      </Link>
                      <Link
                        target="_blank"
                        rel="noopener noreferrer"
                        title="تعیین ظرفیت"
                        className={actionLinkClass}
                        href={`/admin/properties/${property.id}/inventory`}
                      >
                        <KoochIcon name="capacity" />
                      </Link>
                      <Link
                        target="_blank"
                        rel="noopener noreferrer"
                        title="تعیین قیمت"
                        className={actionLinkClass}
                        href={`/admin/properties/${property.id}/pricing`}
                      >
                        <KoochIcon name="price" />
                      </Link>
                      <KoochButton
                        disabled={workingId === property.id}
                        onClick={() => setStatus(property.id, "Suspended")}
                        size="sm"
                        variant="outline"
                        title="تعلیق اقامتگاه"
                      >
                        <KoochIcon name="suspend" />
                      </KoochButton>
                      {property.status === "Approved" && (
                        <Link
                          className={actionLinkClass}
                          title="نمایش در سایت"
                          target="_blank"
                          rel="noopener noreferrer"
                          href={`/properties/${property.slug}`}
                        >
                          <KoochIcon name="view" />
                        </Link>
                      )}
                    </div>
                  </KoochTableCell>
                </KoochTableRow>
              ))}
            </KoochTableBody>
          </KoochTable>
        )}
      </main>
    </AdminLayout>
  );
}
