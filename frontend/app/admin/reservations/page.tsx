"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import {
  KoochField,
  KoochInput,
  KoochSelect,
} from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  ReservationTable,
  type ReservationTableItem,
  type ReservationTableStatus,
} from "@/components/reservations/ReservationTable";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import { apiRequest, type PropertyResponse } from "@/lib/owner-api";
import { toast } from "sonner";

type ReservationStatusFilter = "" | ReservationTableStatus;

interface ReservationListQuery {
  propertyId: string;
  status: ReservationStatusFilter;
  checkInFrom: string;
  checkInTo: string;
  guestSearch: string;
}

interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const pageSize = 10;

const statusOptions: Array<{ value: ReservationStatusFilter; label: string }> = [
  { value: "", label: "همه وضعیت‌ها" },
  { value: "Pending", label: "در انتظار" },
  { value: "PendingApproval", label: "در انتظار تایید" },
  { value: "OnHold", label: "در انتظار بررسی" },
  { value: "ApprovedAwaitingPayment", label: "در انتظار پرداخت" },
  { value: "Confirmed", label: "تایید شده" },
  { value: "Paid", label: "پرداخت شده" },
  { value: "Cancelled", label: "لغو شده" },
  { value: "PaymentExpired", label: "مهلت پرداخت گذشته" },
];

const initialFilters: ReservationListQuery = {
  propertyId: "",
  status: "",
  checkInFrom: "",
  checkInTo: "",
  guestSearch: "",
};

function buildReservationsPath(filters: ReservationListQuery, page: number) {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
  });

  if (filters.propertyId) params.set("propertyId", filters.propertyId);
  if (filters.status) params.set("status", filters.status);
  if (filters.checkInFrom) params.set("checkInFrom", filters.checkInFrom);
  if (filters.checkInTo) params.set("checkInTo", filters.checkInTo);
  if (filters.guestSearch.trim()) {
    params.set("guestSearch", filters.guestSearch.trim());
  }

  return `/admin/reservations?${params.toString()}`;
}

export default function AdminReservationsPage() {
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [reservations, setReservations] = useState<ReservationTableItem[]>([]);
  const [selectedReservationState, setSelectedReservation] =
    useState<ReservationTableItem | null>(null);
  const [draftFilters, setDraftFilters] =
    useState<ReservationListQuery>(initialFilters);
  const [filters, setFilters] = useState<ReservationListQuery>(initialFilters);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadReservations = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<PagedResult<ReservationTableItem>>(
        buildReservationsPath(filters, currentPage),
      );
      setReservations(response.items);
      setTotalPages(response.totalPages);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "خطا در دریافت رزروها.",
      );
    } finally {
      setLoading(false);
    }
  }, [currentPage, filters]);

  useEffect(() => {
    apiRequest<PropertyResponse[]>("/admin/properties")
      .then(setProperties)
      .catch(() => setProperties([]));
  }, []);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCurrentPage(1);
    setFilters(draftFilters);
  }

  function clearFilters() {
    setDraftFilters(initialFilters);
    setFilters(initialFilters);
    setCurrentPage(1);
  }

  async function viewReservation(reservation: ReservationTableItem) {
    const reservationId = reservation.reservationId ?? reservation.id;
    setSelectedReservation(reservation);

    if (!reservationId) return;

    setDetailsLoading(true);
    setError("");

    try {
      const details = await apiRequest<ReservationTableItem>(
        `/admin/reservations/${reservationId}`,
      );
      setSelectedReservation(details);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "خطا در دریافت جزئیات رزرو.",
      );
    } finally {
      setDetailsLoading(false);
    }
  }

  async function approveReservation(reservation: ReservationTableItem) {
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!reservationId) return;

    setApprovingId(reservationId);
    setError("");

    try {
      const approved = await apiRequest<ReservationTableItem>(
        `/admin/reservations/${reservationId}/approve`,
        { method: "PUT" },
      );
      setSelectedReservation((current) => {
        const currentId = current?.reservationId ?? current?.id;
        return currentId === reservationId ? approved : current;
      });
      await loadReservations();
      toast.success("درخواست رزرو تایید شد.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "خطا در تایید رزرو.";
      setError(message);
      toast.error(message);
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          description="فهرست رزروهای ثبت‌شده در همه اقامتگاه‌ها"
          eyebrow="مدیریت"
          title="رزروها"
        />

        {error && (
          <KoochCard
            className="border-destructive/30 bg-destructive/10 text-destructive"
            padding="sm"
          >
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )}

        <KoochCard padding="sm" variant="elevated">
          <form
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1fr_1.4fr_auto]"
            onSubmit={applyFilters}
          >
            <KoochField label="اقامتگاه">
              <KoochSelect
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    propertyId: event.target.value,
                  }))
                }
                value={draftFilters.propertyId}
              >
                <option value="">همه اقامتگاه‌ها</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </KoochSelect>
            </KoochField>

            <KoochField label="وضعیت">
              <KoochSelect
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    status: event.target.value as ReservationStatusFilter,
                  }))
                }
                value={draftFilters.status}
              >
                {statusOptions.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </KoochSelect>
            </KoochField>

            <KoochField label="تاریخ ورود از">
              <KoochInput
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    checkInFrom: event.target.value,
                  }))
                }
                type="date"
                value={draftFilters.checkInFrom}
              />
            </KoochField>

            <KoochField label="تاریخ ورود تا">
              <KoochInput
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    checkInTo: event.target.value,
                  }))
                }
                type="date"
                value={draftFilters.checkInTo}
              />
            </KoochField>

            <KoochField label="جستجوی مهمان">
              <KoochInput
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    guestSearch: event.target.value,
                  }))
                }
                placeholder="نام، موبایل یا شماره رزرو"
                value={draftFilters.guestSearch}
              />
            </KoochField>

            <div className="flex items-end gap-2">
              <KoochButton loading={loading} type="submit">
                اعمال
              </KoochButton>
              <KoochButton onClick={clearFilters} type="button" variant="outline">
                پاکسازی
              </KoochButton>
            </div>
          </form>
        </KoochCard>

        <ReservationTable
          context="admin"
          currentPage={currentPage}
          emptyMessage="هنوز رزروی ثبت نشده است."
          loading={loading}
          onApprove={approveReservation}
          onPageChange={setCurrentPage}
          onView={viewReservation}
          reservations={reservations}
          totalPages={totalPages}
        />

        <ReservationDetailsDialog
          loading={detailsLoading}
          onApprove={approveReservation}
          onOpenChange={(open) => {
            if (!open) setSelectedReservation(null);
          }}
          open={Boolean(selectedReservationState)}
          reservation={selectedReservationState}
        />

        {approvingId && (
          <p className="text-xs font-semibold text-muted-foreground">
            در حال تایید رزرو...
          </p>
        )}
      </main>
    </AdminLayout>
  );
}
