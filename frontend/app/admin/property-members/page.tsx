"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import {
  KoochField,
  KoochSearchableSelect,
} from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { apiRequest } from "@/lib/owner-api";

type AdminPropertySearchItem = {
  id: number;
  name: string;
  englishName: string | null;
  city: string;
  ownerName: string;
  ownerEmail: string;
};

type AdminPropertySearchResponse = {
  items: AdminPropertySearchItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export default function AdminPropertyMembersPage() {
  const router = useRouter();
  const {
    authenticated,
    loading: sessionLoading,
    platformPermissions,
    platformRole,
    workspaces,
  } = useAuthSession();
  const [properties, setProperties] = useState<AdminPropertySearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [selectedProperty, setSelectedProperty] =
    useState<AdminPropertySearchItem | null>(null);
  const searchRequestIdRef = useRef(0);
  const canBrowseProperties =
    platformRole === "SuperAdmin" ||
    platformPermissions.includes("ManageProperties");

  const selectableProperties = useMemo(() => {
    if (
      !selectedProperty ||
      properties.some((property) => property.id === selectedProperty.id)
    ) {
      return properties;
    }

    return [selectedProperty, ...properties];
  }, [properties, selectedProperty]);

  const propertyOptions = useMemo(
    () =>
      selectableProperties.map((property) => ({
        value: property.id,
        label: property.name,
        description: [property.city, property.ownerName]
          .filter(Boolean)
          .join(" · "),
        searchText: [
          property.name,
          property.englishName,
          property.city,
          property.ownerName,
          property.ownerEmail,
          property.id,
        ]
          .filter(Boolean)
          .join(" "),
      })),
    [selectableProperties],
  );

  useEffect(() => {
    if (
      sessionLoading ||
      !authenticated ||
      !workspaces.includes("admin") ||
      !canBrowseProperties
    ) {
      searchRequestIdRef.current += 1;
      if (!sessionLoading) setLoading(false);
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        search: search.trim(),
        page: "1",
        pageSize: "10",
      });

      setError("");
      setLoading(true);
      apiRequest<AdminPropertySearchResponse>(
        `/admin/properties/search?${query.toString()}`,
      )
        .then((response) => {
          if (searchRequestIdRef.current === requestId) {
            setProperties(response.items);
          }
        })
        .catch((caught: Error) => {
          if (searchRequestIdRef.current === requestId) {
            setError(caught.message);
          }
        })
        .finally(() => {
          if (searchRequestIdRef.current === requestId) {
            setLoading(false);
          }
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      if (searchRequestIdRef.current === requestId) {
        searchRequestIdRef.current += 1;
      }
    };
  }, [
    authenticated,
    canBrowseProperties,
    search,
    sessionLoading,
    workspaces,
  ]);

  function handlePropertyChange(value: string) {
    setSelectedPropertyId(value);
    if (!value) {
      setSelectedProperty(null);
      return;
    }

    const nextProperty = properties.find(
      (property) => property.id.toString() === value,
    );
    if (nextProperty) setSelectedProperty(nextProperty);
  }

  return (
    <AdminLayout requiredPlatformPermission="ManageUsers">
      <main className="mx-auto grid w-full min-w-0 max-w-[1480px] gap-5 overflow-x-hidden p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <KoochButton
              onClick={() => router.push("/admin/properties")}
              type="button"
              variant="outline"
            >
              مدیریت / انتقال مالکیت
            </KoochButton>
          }
          appearance="plain"
          description="انتخاب اقامتگاه و ورود به مدیریت اعضا و دسترسی‌های همان اقامتگاه"
          eyebrow="پنل مدیریت"
          title="اعضای اقامتگاه‌ها"
        />

        <KoochCard className="min-w-0" padding="md">
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)] lg:items-end">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">
                انتخاب اقامتگاه
              </h2>
              <p className="mt-1 max-w-2xl text-sm font-normal leading-6 text-muted-foreground">
                اعضا و مجوزهای هر اقامتگاه در صفحه اختصاصی همان اقامتگاه مدیریت
                می‌شوند.
              </p>
              <p className="mt-2 max-w-2xl text-xs font-normal leading-6 text-muted-foreground">
                مالک اقامتگاه از مسیر انتقال مالکیت تعیین می‌شود و از فرم افزودن
                عضو قابل تغییر نیست.
              </p>
            </div>

            {canBrowseProperties ? (
              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <KoochField label="اقامتگاه">
                  <KoochSearchableSelect
                    clearText="پاک کردن انتخاب اقامتگاه"
                    disabled={loading}
                    emptyText="اقامتگاهی پیدا نشد."
                    id="property-members-property"
                    onChange={handlePropertyChange}
                    onSearchChange={setSearch}
                    options={propertyOptions}
                    placeholder={
                      loading
                        ? "در حال بارگذاری اقامتگاه‌ها..."
                        : "انتخاب یا جستجوی اقامتگاه"
                    }
                    searchPlaceholder="جستجو با نام، شهر یا مالک..."
                    value={selectedPropertyId}
                  />
                </KoochField>
                <KoochButton
                  disabled={!selectedPropertyId || loading}
                  onClick={() =>
                    router.push(
                      `/admin/properties/${selectedPropertyId}/users`,
                    )
                  }
                  type="button"
                >
                  مدیریت اعضای اقامتگاه
                </KoochButton>
              </div>
            ) : (
              <KoochAlert icon="info" variant="information">
                برای انتخاب اقامتگاه، مجوز مدیریت اقامتگاه‌ها نیز لازم است.
              </KoochAlert>
            )}
          </div>

          {error && (
            <KoochAlert
              className="mt-4"
              title="فهرست اقامتگاه‌ها بارگذاری نشد"
              variant="destructive"
            >
              {error}
            </KoochAlert>
          )}
        </KoochCard>
      </main>
    </AdminLayout>
  );
}
