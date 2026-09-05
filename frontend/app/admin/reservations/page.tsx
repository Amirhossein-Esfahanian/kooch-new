"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import {
  KoochField,
  KoochInput,
  KoochSearchableSelect,
  KoochSelect,
} from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { ReservationFollowUpRecipients } from "@/components/admin/ReservationFollowUpRecipients";
import {
  ReservationTable,
  type ReservationCancellationPayload,
  type ReservationTableItem,
  type ReservationTableStatus,
} from "@/components/reservations/ReservationTable";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import { ManualReservationDialog } from "@/components/reservations/ManualReservationDialog";
import {
  apiRequest,
  type PropertyResponse,
  type RoomResponse,
  type RoomTypeResponse,
} from "@/lib/owner-api";
import { toast } from "sonner";

type ReservationStatusFilter = "" | ReservationTableStatus;
type ReservationBookingModeFilter = "" | "Instant" | "OnRequest";
type ReservationSourceFilter =
  | ""
  | "Website"
  | "PhoneReferral"
  | "AdminCreated"
  | "ExternalChannel";
type PaymentStatusFilter =
  | ""
  | "Pending"
  | "Successful"
  | "Failed"
  | "Refunded";

interface ReservationListQuery {
  propertyId: string;
  reservationNumber: string;
  status: ReservationStatusFilter;
  bookingMode: ReservationBookingModeFilter;
  roomTypeId: string;
  roomId: string;
  roomSearch: string;
  checkInFrom: string;
  checkInTo: string;
  checkOutFrom: string;
  checkOutTo: string;
  createdFrom: string;
  createdTo: string;
  guestSearch: string;
  totalPriceMin: string;
  totalPriceMax: string;
  paidAmountMin: string;
  paidAmountMax: string;
  remainingAmountMin: string;
  remainingAmountMax: string;
  source: ReservationSourceFilter;
  createdBy: string;
  paymentStatus: PaymentStatusFilter;
  paymentDeadlineFrom: string;
  paymentDeadlineTo: string;
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

const statusOptions: Array<{ value: ReservationStatusFilter; label: string }> =
  [
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
  reservationNumber: "",
  status: "",
  bookingMode: "",
  roomTypeId: "",
  roomId: "",
  roomSearch: "",
  checkInFrom: "",
  checkInTo: "",
  checkOutFrom: "",
  checkOutTo: "",
  createdFrom: "",
  createdTo: "",
  guestSearch: "",
  totalPriceMin: "",
  totalPriceMax: "",
  paidAmountMin: "",
  paidAmountMax: "",
  remainingAmountMin: "",
  remainingAmountMax: "",
  source: "",
  createdBy: "",
  paymentStatus: "",
  paymentDeadlineFrom: "",
  paymentDeadlineTo: "",
};

function buildReservationsPath(filters: ReservationListQuery, page: number) {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
  });

  Object.entries(filters).forEach(([key, value]) => {
    const trimmed = value.trim();
    if (trimmed) params.set(key, trimmed);
  });

  return `/admin/reservations?${params.toString()}`;
}

const bookingModeOptions: Array<{
  value: ReservationBookingModeFilter;
  label: string;
}> = [
  { value: "", label: "همه حالت‌ها" },
  { value: "Instant", label: "رزرو فوری" },
  { value: "OnRequest", label: "درخواستی" },
];

const sourceOptions: Array<{ value: ReservationSourceFilter; label: string }> =
  [
    { value: "", label: "همه منابع" },
    { value: "Website", label: "وب‌سایت" },
    { value: "PhoneReferral", label: "ارجاع تلفنی" },
    { value: "AdminCreated", label: "ثبت ادمین" },
    { value: "ExternalChannel", label: "کانال بیرونی" },
  ];

const paymentStatusOptions: Array<{
  value: PaymentStatusFilter;
  label: string;
}> = [
  { value: "", label: "همه پرداخت‌ها" },
  { value: "Pending", label: "در انتظار" },
  { value: "Successful", label: "موفق" },
  { value: "Failed", label: "ناموفق" },
  { value: "Refunded", label: "بازگشت داده‌شده" },
];

export default function AdminReservationsPage() {
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [rooms, setRooms] = useState<RoomResponse[]>([]);
  const [reservations, setReservations] = useState<ReservationTableItem[]>([]);
  const [selectedReservationState, setSelectedReservation] =
    useState<ReservationTableItem | null>(null);
  const [editingReservation, setEditingReservation] =
    useState<ReservationTableItem | null>(null);
  const [draftFilters, setDraftFilters] =
    useState<ReservationListQuery>(initialFilters);
  const [filters, setFilters] = useState<ReservationListQuery>(initialFilters);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [statusChangingId, setStatusChangingId] = useState<number | null>(null);
  const [paymentLinkSendingId, setPaymentLinkSendingId] = useState<
    number | null
  >(null);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const selectedFollowUpPropertyId = Number(draftFilters.propertyId);
  const hasSelectedFollowUpProperty =
    Number.isInteger(selectedFollowUpPropertyId) &&
    selectedFollowUpPropertyId > 0;
  const propertyOptions = useMemo(
    () =>
      properties.map((property) => ({
        value: property.id,
        label: property.name,
        searchText: property.name,
      })),
    [properties],
  );
  const roomTypeOptions = useMemo(
    () =>
      roomTypes.map((roomType) => ({
        value: roomType.id,
        label: roomType.name,
        searchText: `${roomType.name} ${roomType.englishName ?? ""}`,
      })),
    [roomTypes],
  );
  const roomOptions = useMemo(
    () =>
      rooms.map((room) => ({
        value: room.id,
        label: room.name,
        searchText: `${room.name} ${room.englishName ?? ""}`,
      })),
    [rooms],
  );
  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((value) => value.trim()).length,
    [filters],
  );

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
    if (!draftFilters.propertyId) {
      setRoomTypes([]);
      setRooms([]);
      setDraftFilters((current) => ({
        ...current,
        roomTypeId: "",
        roomId: "",
      }));
      return;
    }

    apiRequest<RoomTypeResponse[]>(
      `/owner/properties/${draftFilters.propertyId}/room-types`,
    )
      .then((items) => setRoomTypes(items))
      .catch(() => setRoomTypes([]));
  }, [draftFilters.propertyId]);

  useEffect(() => {
    if (!draftFilters.roomTypeId) {
      setRooms([]);
      setDraftFilters((current) => ({ ...current, roomId: "" }));
      return;
    }

    apiRequest<RoomResponse[]>(
      `/owner/room-types/${draftFilters.roomTypeId}/rooms`,
    )
      .then(setRooms)
      .catch(() => setRooms([]));
  }, [draftFilters.roomTypeId]);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCurrentPage(1);
      setFilters((current) => ({
        ...current,
        reservationNumber: draftFilters.reservationNumber,
        guestSearch: draftFilters.guestSearch,
        roomSearch: draftFilters.roomSearch,
        createdBy: draftFilters.createdBy,
      }));
    }, 450);

    return () => window.clearTimeout(timer);
  }, [
    draftFilters.createdBy,
    draftFilters.guestSearch,
    draftFilters.reservationNumber,
    draftFilters.roomSearch,
  ]);

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

  async function editReservation(reservation: ReservationTableItem) {
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!reservationId) return;

    setDetailsLoading(true);
    setError("");

    try {
      const details = await apiRequest<ReservationTableItem>(
        `/admin/reservations/${reservationId}`,
      );
      setSelectedReservation(null);
      setEditingReservation(details);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "خطا در دریافت جزئیات رزرو.";
      setError(message);
      toast.error(message);
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
      const isApproval =
        reservation.status === "PendingApproval" &&
        status === "ApprovedAwaitingPayment";
      const updated = await apiRequest<ReservationTableItem>(
        isApproval
          ? `/admin/reservations/${reservationId}/approve`
          : `/admin/reservations/${reservationId}/status`,
        {
          method: "PUT",
          ...(isApproval ? {} : { body: JSON.stringify({ status }) }),
        },
      );
      setSelectedReservation((current) => {
        const currentId = current?.reservationId ?? current?.id;
        return currentId === reservationId ? updated : current;
      });
      setEditingReservation((current) => {
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

  async function cancelReservation(
    reservation: ReservationTableItem,
    cancellation: ReservationCancellationPayload,
  ) {
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!reservationId) return;

    setStatusChangingId(reservationId);
    setError("");

    try {
      const updated = await apiRequest<ReservationTableItem>(
        `/admin/reservations/${reservationId}/cancel`,
        {
          method: "PUT",
          body: JSON.stringify({
            reason: cancellation.reason,
            explanation: cancellation.explanation,
          }),
        },
      );
      setSelectedReservation(updated);
      await loadReservations();
      toast.success("رزرو لغو شد.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "خطا در لغو رزرو.";
      setError(message);
      toast.error(message);
      throw caught;
    } finally {
      setStatusChangingId(null);
    }
  }

  async function adjustReservationPrice(
    reservation: ReservationTableItem,
    amount: number,
  ) {
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!reservationId) return;

    setStatusChangingId(reservationId);
    setError("");

    try {
      const updated = await apiRequest<ReservationTableItem>(
        `/admin/reservations/${reservationId}/price-adjustment`,
        {
          method: "PUT",
          body: JSON.stringify({ amount }),
        },
      );
      setSelectedReservation(updated);
      await loadReservations();
      toast.success("اصلاح قیمت رزرو ذخیره شد.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "خطا در اصلاح قیمت رزرو.";
      setError(message);
      toast.error(message);
      throw caught;
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
        `/admin/reservations/${reservationId}/payment-link/send`,
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
        caught instanceof Error ? caught.message : "خطا در ارسال لینک پرداخت.";
      setError(message);
      toast.error(message);
    } finally {
      setPaymentLinkSendingId(null);
    }
  }

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          appearance="plain"
          actions={
            <ManualReservationDialog
              context="admin"
              onCreated={loadReservations}
            />
          }
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
          <form className="grid gap-4" onSubmit={applyFilters}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-foreground">
                  فیلترهای رزرو
                </p>
                <p className="text-xs text-muted-foreground">
                  {activeFilterCount > 0
                    ? `${activeFilterCount} فیلتر فعال است.`
                    : "بدون فیلتر فعال"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <KoochButton
                  onClick={() => setFiltersOpen((open) => !open)}
                  type="button"
                  variant="outline"
                >
                  {filtersOpen ? "بستن فیلترها" : "فیلترهای پیشرفته"}
                </KoochButton>
                <KoochButton loading={loading} type="submit">
                  اعمال
                </KoochButton>
                <KoochButton
                  onClick={clearFilters}
                  type="button"
                  variant="outline"
                >
                  پاکسازی
                </KoochButton>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KoochField label="شماره رزرو">
                <KoochInput
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      reservationNumber: event.target.value,
                    }))
                  }
                  placeholder="مثلاً RSV-..."
                  value={draftFilters.reservationNumber}
                />
              </KoochField>

              <KoochField label="مهمان">
                <KoochInput
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      guestSearch: event.target.value,
                    }))
                  }
                  placeholder="نام، موبایل یا ایمیل"
                  value={draftFilters.guestSearch}
                />
              </KoochField>

              <KoochField label="اقامتگاه">
                <KoochSearchableSelect
                  emptyText="اقامتگاهی پیدا نشد."
                  onChange={(value) =>
                    setDraftFilters((current) => ({
                      ...current,
                      propertyId: value,
                    }))
                  }
                  options={propertyOptions}
                  placeholder="همه اقامتگاه‌ها"
                  searchPlaceholder="جستجوی اقامتگاه..."
                  value={draftFilters.propertyId}
                />
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
            </div>

            {filtersOpen && (
              <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2 xl:grid-cols-4">
                <KoochField label="اتاق / تیپ اتاق">
                  <KoochInput
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        roomSearch: event.target.value,
                      }))
                    }
                    placeholder="نام اتاق یا تیپ اتاق"
                    value={draftFilters.roomSearch}
                  />
                </KoochField>

                <KoochField label="تیپ اتاق">
                  <KoochSearchableSelect
                    disabled={!draftFilters.propertyId}
                    emptyText="تیپ اتاقی پیدا نشد."
                    onChange={(value) =>
                      setDraftFilters((current) => ({
                        ...current,
                        roomTypeId: value,
                      }))
                    }
                    options={roomTypeOptions}
                    placeholder={
                      draftFilters.propertyId
                        ? "همه تیپ‌ها"
                        : "ابتدا اقامتگاه را انتخاب کنید"
                    }
                    searchPlaceholder="جستجوی تیپ اتاق..."
                    value={draftFilters.roomTypeId}
                  />
                </KoochField>

                <KoochField label="اتاق">
                  <KoochSearchableSelect
                    disabled={!draftFilters.roomTypeId}
                    emptyText="اتاقی پیدا نشد."
                    onChange={(value) =>
                      setDraftFilters((current) => ({
                        ...current,
                        roomId: value,
                      }))
                    }
                    options={roomOptions}
                    placeholder={
                      draftFilters.roomTypeId
                        ? "همه اتاق‌ها"
                        : "ابتدا تیپ اتاق را انتخاب کنید"
                    }
                    searchPlaceholder="جستجوی اتاق..."
                    value={draftFilters.roomId}
                  />
                </KoochField>

                <KoochField label="فوری / درخواستی">
                  <KoochSelect
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        bookingMode: event.target
                          .value as ReservationBookingModeFilter,
                      }))
                    }
                    value={draftFilters.bookingMode}
                  >
                    {bookingModeOptions.map((option) => (
                      <option key={option.value || "all"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </KoochSelect>
                </KoochField>

                <KoochField label="ورود از">
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

                <KoochField label="ورود تا">
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

                <KoochField label="خروج از">
                  <KoochInput
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        checkOutFrom: event.target.value,
                      }))
                    }
                    type="date"
                    value={draftFilters.checkOutFrom}
                  />
                </KoochField>

                <KoochField label="خروج تا">
                  <KoochInput
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        checkOutTo: event.target.value,
                      }))
                    }
                    type="date"
                    value={draftFilters.checkOutTo}
                  />
                </KoochField>

                <KoochField label="ایجاد از">
                  <KoochInput
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        createdFrom: event.target.value,
                      }))
                    }
                    type="date"
                    value={draftFilters.createdFrom}
                  />
                </KoochField>

                <KoochField label="ایجاد تا">
                  <KoochInput
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        createdTo: event.target.value,
                      }))
                    }
                    type="date"
                    value={draftFilters.createdTo}
                  />
                </KoochField>

                <KoochField label="مبلغ کل از">
                  <KoochInput
                    inputMode="numeric"
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        totalPriceMin: event.target.value,
                      }))
                    }
                    value={draftFilters.totalPriceMin}
                  />
                </KoochField>

                <KoochField label="مبلغ کل تا">
                  <KoochInput
                    inputMode="numeric"
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        totalPriceMax: event.target.value,
                      }))
                    }
                    value={draftFilters.totalPriceMax}
                  />
                </KoochField>

                <KoochField label="پرداخت‌شده از">
                  <KoochInput
                    inputMode="numeric"
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        paidAmountMin: event.target.value,
                      }))
                    }
                    value={draftFilters.paidAmountMin}
                  />
                </KoochField>

                <KoochField label="پرداخت‌شده تا">
                  <KoochInput
                    inputMode="numeric"
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        paidAmountMax: event.target.value,
                      }))
                    }
                    value={draftFilters.paidAmountMax}
                  />
                </KoochField>

                <KoochField label="باقی‌مانده از">
                  <KoochInput
                    inputMode="numeric"
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        remainingAmountMin: event.target.value,
                      }))
                    }
                    value={draftFilters.remainingAmountMin}
                  />
                </KoochField>

                <KoochField label="باقی‌مانده تا">
                  <KoochInput
                    inputMode="numeric"
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        remainingAmountMax: event.target.value,
                      }))
                    }
                    value={draftFilters.remainingAmountMax}
                  />
                </KoochField>

                <KoochField label="منبع">
                  <KoochSelect
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        source: event.target.value as ReservationSourceFilter,
                      }))
                    }
                    value={draftFilters.source}
                  >
                    {sourceOptions.map((option) => (
                      <option key={option.value || "all"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </KoochSelect>
                </KoochField>

                <KoochField label="ایجادکننده">
                  <KoochInput
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        createdBy: event.target.value,
                      }))
                    }
                    placeholder="نام، موبایل یا ایمیل"
                    value={draftFilters.createdBy}
                  />
                </KoochField>

                <KoochField label="وضعیت پرداخت">
                  <KoochSelect
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        paymentStatus: event.target
                          .value as PaymentStatusFilter,
                      }))
                    }
                    value={draftFilters.paymentStatus}
                  >
                    {paymentStatusOptions.map((option) => (
                      <option key={option.value || "all"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </KoochSelect>
                </KoochField>

                <KoochField label="مهلت پرداخت از">
                  <KoochInput
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        paymentDeadlineFrom: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={draftFilters.paymentDeadlineFrom}
                  />
                </KoochField>

                <KoochField label="مهلت پرداخت تا">
                  <KoochInput
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        paymentDeadlineTo: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={draftFilters.paymentDeadlineTo}
                  />
                </KoochField>
              </div>
            )}
          </form>
        </KoochCard>

        {hasSelectedFollowUpProperty && (
          <ReservationFollowUpRecipients
            propertyId={selectedFollowUpPropertyId}
          />
        )}

        <ReservationTable
          context="admin"
          currentPage={currentPage}
          emptyMessage="هنوز رزروی ثبت نشده است."
          loading={loading}
          onPageChange={setCurrentPage}
          onView={viewReservation}
          reservations={reservations}
          totalPages={totalPages}
        />

        <ReservationDetailsDialog
          loading={detailsLoading}
          onAdjustPrice={adjustReservationPrice}
          onCancel={cancelReservation}
          onEdit={editReservation}
          onRefresh={viewReservation}
          onSendPaymentLink={sendPaymentLink}
          onStatusChange={updateReservationStatus}
          onOpenChange={(open) => {
            if (!open) setSelectedReservation(null);
          }}
          open={Boolean(selectedReservationState)}
          reservation={selectedReservationState}
        />

        <ManualReservationDialog
          context="admin"
          mode="edit"
          onCreated={loadReservations}
          onOpenChange={(open) => {
            if (!open) setEditingReservation(null);
          }}
          open={Boolean(editingReservation)}
          reservation={editingReservation}
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
    </AdminLayout>
  );
}
