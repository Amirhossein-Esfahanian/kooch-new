"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochField, KoochInput } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableEmpty,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";
import {
  apiRequest,
  type PropertyUserRole,
  type PropertyUserStatus,
} from "@/lib/owner-api";

type PropertyMembershipItem = {
  propertyId: number;
  propertyName: string;
  role: PropertyUserRole;
  status: PropertyUserStatus;
  isActive: boolean;
  isOwner: boolean;
};

type PropertyMemberUserItem = {
  id: number;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  email: string | null;
  isActive: boolean;
  memberships: PropertyMembershipItem[];
};

type PropertyMemberDirectoryResponse = {
  items: PropertyMemberUserItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const pageSize = 20;

const roleLabels: Record<PropertyUserRole, string> = {
  PropertyOwner: "مالک اقامتگاه",
  Manager: "مدیر",
  Reception: "پذیرش",
  Accounting: "حسابداری",
  Housekeeping: "خانه‌داری",
  Custom: "سفارشی",
};

const numberFormatter = new Intl.NumberFormat("fa-IR");

function distinctRoles(memberships: PropertyMembershipItem[]) {
  return [...new Set(memberships.map((membership) => membership.role))];
}

export default function AdminPropertyMembersPage() {
  const router = useRouter();
  const { authenticated, loading: sessionLoading, workspaces } =
    useAuthSession();
  const [result, setResult] =
    useState<PropertyMemberDirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setDebouncedSearch(search.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (
      sessionLoading ||
      !authenticated ||
      !workspaces.includes("admin")
    ) {
      requestIdRef.current += 1;
      if (!sessionLoading) setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const query = new URLSearchParams({
      page: page.toString(),
      pageSize: pageSize.toString(),
    });
    if (debouncedSearch) query.set("search", debouncedSearch);

    setError("");
    setLoading(true);
    setResult(null);
    apiRequest<PropertyMemberDirectoryResponse>(
      `/admin/property-members?${query.toString()}`,
    )
      .then((response) => {
        if (requestIdRef.current === requestId) {
          setResult(response);
        }
      })
      .catch((caught: Error) => {
        if (requestIdRef.current === requestId) {
          setError(caught.message);
        }
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => {
      if (requestIdRef.current === requestId) {
        requestIdRef.current += 1;
      }
    };
  }, [authenticated, debouncedSearch, page, sessionLoading, workspaces]);

  const users = result?.items ?? [];
  const totalPages = result?.totalPages ?? 0;
  const shownRoles = useMemo(
    () =>
      new Map(
        users.map((user) => [user.id, distinctRoles(user.memberships)]),
      ),
    [users],
  );

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
          description="فهرست یکپارچه کاربران دارای دسترسی به اقامتگاه‌ها؛ جزئیات هر عضویت در مرحله بعد اضافه می‌شود."
          eyebrow="پنل مدیریت"
          title="اعضای اقامتگاه‌ها"
        />

        <KoochCard className="grid min-w-0 gap-4" padding="md">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 flex-1 sm:max-w-md">
              <KoochField label="جستجوی کاربر">
                <KoochInput
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="نام، شماره تماس یا ایمیل..."
                  type="search"
                  value={search}
                />
              </KoochField>
            </div>
            {result && (
              <p className="text-sm text-muted-foreground" role="status">
                {numberFormatter.format(result.totalCount)} کاربر
              </p>
            )}
          </div>

          {error && (
            <KoochAlert
              title="فهرست اعضای اقامتگاه‌ها بارگذاری نشد"
              variant="destructive"
            >
              {error}
            </KoochAlert>
          )}

          <KoochTable>
            <KoochTableHeader>
              <KoochTableRow>
                <KoochTableHead>کاربر</KoochTableHead>
                <KoochTableHead>تماس</KoochTableHead>
                <KoochTableHead>تعداد اقامتگاه‌ها</KoochTableHead>
                <KoochTableHead>نقش‌ها</KoochTableHead>
                <KoochTableHead>وضعیت حساب</KoochTableHead>
                <KoochTableHead>عملیات</KoochTableHead>
              </KoochTableRow>
            </KoochTableHeader>
            <KoochTableBody>
              {loading ? (
                <KoochTableEmpty colSpan={6} role="status">
                  در حال بارگذاری اعضا...
                </KoochTableEmpty>
              ) : error ? (
                <KoochTableEmpty colSpan={6}>
                  امکان نمایش اعضا وجود ندارد.
                </KoochTableEmpty>
              ) : users.length === 0 ? (
                <KoochTableEmpty colSpan={6}>
                  {debouncedSearch
                    ? "کاربری مطابق جستجو پیدا نشد."
                    : "هنوز عضوی برای نمایش وجود ندارد."}
                </KoochTableEmpty>
              ) : (
                users.map((user) => {
                  const roles = shownRoles.get(user.id) ?? [];
                  const visibleRoles = roles.slice(0, 2);
                  const remainingRoleCount = roles.length - visibleRoles.length;
                  const fullName = [user.firstName, user.lastName]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <KoochTableRow key={user.id}>
                      <KoochTableCell className="min-w-52">
                        <div className="font-medium text-foreground">
                          {fullName || "کاربر بدون نام"}
                        </div>
                        {user.email && (
                          <div
                            className="mt-1 max-w-64 truncate text-xs text-muted-foreground"
                            dir="ltr"
                          >
                            {user.email}
                          </div>
                        )}
                      </KoochTableCell>
                      <KoochTableCell>
                        {user.phoneNumber ? (
                          <span
                            className="inline-block whitespace-nowrap tabular-nums"
                            dir="ltr"
                          >
                            {user.phoneNumber}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </KoochTableCell>
                      <KoochTableCell className="whitespace-nowrap">
                        {numberFormatter.format(user.memberships.length)}
                      </KoochTableCell>
                      <KoochTableCell>
                        <div className="flex min-w-40 flex-wrap gap-1.5">
                          {visibleRoles.map((role) => (
                            <KoochBadge key={role} variant="muted">
                              {roleLabels[role]}
                            </KoochBadge>
                          ))}
                          {remainingRoleCount > 0 && (
                            <KoochBadge
                              title={roles
                                .slice(visibleRoles.length)
                                .map((role) => roleLabels[role])
                                .join("، ")}
                              variant="muted"
                            >
                              +{numberFormatter.format(remainingRoleCount)} نقش
                            </KoochBadge>
                          )}
                        </div>
                      </KoochTableCell>
                      <KoochTableCell>
                        <KoochBadge
                          variant={user.isActive ? "success" : "muted"}
                        >
                          {user.isActive ? "فعال" : "غیرفعال"}
                        </KoochBadge>
                      </KoochTableCell>
                      <KoochTableCell>
                        <span
                          className="text-muted-foreground"
                          title="جزئیات عضویت‌ها در مرحله بعد اضافه می‌شود"
                        >
                          —
                        </span>
                      </KoochTableCell>
                    </KoochTableRow>
                  );
                })
              )}
            </KoochTableBody>
          </KoochTable>

          {totalPages > 1 && (
            <div
              aria-label="صفحه‌بندی اعضای اقامتگاه‌ها"
              className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted-foreground"
            >
              <span>
                صفحه {numberFormatter.format(result?.page ?? page)} از{" "}
                {numberFormatter.format(totalPages)}
              </span>
              <div className="flex items-center gap-2">
                <KoochButton
                  disabled={loading || page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  قبلی
                </KoochButton>
                <KoochButton
                  disabled={loading || page >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  بعدی
                </KoochButton>
              </div>
            </div>
          )}
        </KoochCard>
      </main>
    </AdminLayout>
  );
}
