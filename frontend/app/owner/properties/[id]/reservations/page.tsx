"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
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
  ReservationTableItem,
  ReservationTableStatus,
} from "@/components/reservations/ReservationTable";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import {
  apiRequest,
  getToken,
  ownerPropertyKey,
  PropertyResponse,
} from "@/lib/owner-api";
import { toast } from "sonner";

type ReservationStatusFilter = "" | ReservationTableStatus;

interface ReservationListQuery {
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

interface ReservationPaymentLinkResponse {
  reservationId: number;
  reservationNumber: string;
  paymentLink: string;
  devPaymentLink?: string | null;
  expiresAtUtc: string;
}

const pageSize = 10;

const headerLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

const statusOptions: Array<{ value: ReservationStatusFilter; label: string }> = [
  { value: "", label: "همه وضعیت‌ها" },
  { value: "Pending", label: "در انتظار" },
  { value: "PendingApproval", label: "در انتظار تایید" },
  { value: "ApprovedAwaitingPayment", label: "در انتظار پرداخت" },
  { value: "Confirmed", label: "تایید شده" },
  { value: "Paid", label: "پرداخت شده" },
  { value: "Cancelled", label: "لغو شده" },
  { value: "PaymentExpired", label: "مهلت پرداخت گذشته" },
];

const initialFilters: ReservationListQuery = {
  status: "",
  checkInFrom: "",
  checkInTo: "",
  guestSearch: "",
};

function buildReservationsPath(
  propertyId: number,
  filters: ReservationListQuery,
  page: number,
) {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
  });

  if (filters.status) params.set("status", filters.status);
  if (filters.checkInFrom) params.set("checkInFrom", filters.checkInFrom);
  if (filters.checkInTo) params.set("checkInTo", filters.checkInTo);
  if (filters.guestSearch.trim()) {
    params.set("guestSearch", filters.guestSearch.trim());
  }

  return `/owner/properties/${propertyId}/reservations?${params.toString()}`;
}

export default function OwnerReservationsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const [property, setProperty] = useState<PropertyResponse | null>(null);
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
  const [statusChangingId, setStatusChangingId] = useState<number | null>(null);
  const [paymentLinkSendingId, setPaymentLinkSendingId] = useState<number | null>(
    null,
  );
  const [error, setError] = useState("");

  const loadReservations = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<PagedResult<ReservationTableItem>>(
        buildReservationsPath(propertyId, filters, currentPage),
      );
      setReservations(response.items);
      setTotalPages(response.totalPages);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "خطا در دریافت رزروها.");
    } finally {
      setLoading(false);
    }
  }, [currentPage, filters, propertyId]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    localStorage.setItem(ownerPropertyKey, propertyId.toString());
    apiRequest<PropertyResponse>(`/owner/properties/${propertyId}`)
      .then(setProperty)
      .catch((caught: Error) => setError(caught.message));
  }, [propertyId, router]);

  useEffect(() => {
    if (!getToken()) return;
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
        `/owner/properties/${propertyId}/reservations/${reservationId}`,
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

  async function updateReservationStatus(
    reservation: ReservationTableItem,
    status: ReservationTableStatus,
  ) {
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!reservationId) return;

    setStatusChangingId(reservationId);
    setError("");

    try {
      const updated = await apiRequest<ReservationTableItem>(
        `/owner/properties/${propertyId}/reservations/${reservationId}/status`,
        {
          method: "PUT",
          body: JSON.stringify({ status }),
        },
      );
      setSelectedReservation((current) => {
        const currentId = current?.reservationId ?? current?.id;
        return currentId === reservationId ? updated : current;
      });
      await loadReservations();
      toast.success("وضعیت رزرو به‌روزرسانی شد.");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "خطا در به‌روزرسانی وضعیت رزرو.";
      setError(message);
      toast.error(message);
    } finally {
      setStatusChangingId(null);
    }
  }

  async function sendPaymentLink(reservation: ReservationTableItem) {
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!reservationId) return;

    setPaymentLinkSendingId(reservationId);
    setError("");

    try {
      const response = await apiRequest<ReservationPaymentLinkResponse>(
        `/owner/properties/${propertyId}/reservations/${reservationId}/payment-link/send`,
        { method: "POST" },
      );
      await loadReservations();

      const devLink = response.devPaymentLink ?? response.paymentLink;
      if (process.env.NODE_ENV !== "production" && devLink) {
        toast.success("لینک پرداخت ثبت شد.", {
          description: devLink,
        });
      } else {
        toast.success("لینک پرداخت برای مهمان ثبت شد.");
      }
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "خطا در ارسال لینک پرداخت.";
      setError(message);
      toast.error(message);
    } finally {
      setPaymentLinkSendingId(null);
    }
  }

  return (
    <OwnerLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <div className="flex flex-wrap items-center gap-2">
            <Link
              className={headerLinkClass}
              href={`/owner/properties/${propertyId}/dashboard`}
            >
              بازگشت به داشبورد
            </Link>
            </div>
          }
          description={property?.name ?? "در حال بارگذاری..."}
          eyebrow="اقامتگاه فعال"
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
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.4fr_auto]"
            onSubmit={applyFilters}
          >
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
          context="owner"
          currentPage={currentPage}
          emptyMessage="هنوز رزروی برای این اقامتگاه ثبت نشده است."
          loading={loading}
          onPageChange={setCurrentPage}
          onSendPaymentLink={sendPaymentLink}
          onView={viewReservation}
          reservations={reservations}
          totalPages={totalPages}
        />

        <ReservationDetailsDialog
          loading={detailsLoading}
          onSendPaymentLink={sendPaymentLink}
          onStatusChange={updateReservationStatus}
          onOpenChange={(open) => {
            if (!open) setSelectedReservation(null);
          }}
          open={Boolean(selectedReservationState)}
          reservation={selectedReservationState}
        />

        {statusChangingId && (
          <p className="text-xs font-semibold text-muted-foreground">
            در حال به‌روزرسانی وضعیت رزرو...
          </p>
        )}
        {paymentLinkSendingId && (
          <p className="text-xs font-semibold text-muted-foreground">
            در حال ارسال لینک پرداخت...
          </p>
        )}
      </main>
    </OwnerLayout>
  );
}
