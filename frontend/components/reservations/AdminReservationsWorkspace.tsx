"use client";

import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { initialFilters, readReservationListState, readReservationListTab, reservationListHref, reservationDetailsHref, safeReservationReturnHref, type ReservationListQuery, type ReservationListTab } from "./admin-reservation-navigation";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import {
  KoochField,
  KoochInput,
  KoochSearchableSelect,
  KoochSelect,
} from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import {
  ReservationTable,
  type ReservationCancellationPayload,
  type ReservationCancellationReason,
  type ReservationTableItem,
  type ReservationTableStatus,
} from "@/components/reservations/ReservationTable";
import {
  ReservationDetailsDialog,
  type AdminManualPayment,
  type AdminManualPaymentCreatePayload,
  type ReservationRefundPayload,
} from "@/components/reservations/ReservationDetailsDialog";
import { ManualReservationDialog } from "@/components/reservations/ManualReservationDialog";
import { AdminTaskCreateDialog, type TaskReservationContext } from "@/components/tasks/AdminTaskCreateDialog";
import { ManualPaymentReviewQueue } from "./ManualPaymentReviewQueue";
import {
  apiRequest,
  ApiRequestError,
  type PropertyResponse,
  type RoomResponse,
  type RoomTypeResponse,
} from "@/lib/owner-api";
import { useSiteCurrencyLabel } from "@/lib/currency";
import { toPersianDigits } from "@/lib/persian-digits";
import { toast } from "sonner";
import styles from "./AdminReservationsWorkspace.module.css";

const listTabs = [
  { value: "reservations", label: "همه رزروها" },
  { value: "payments", label: "بررسی پرداخت‌ها" },
] as const;

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

interface AdminManualPaymentMutationResponse {
  reservationStatus: ReservationTableStatus;
  capacityClaimed: boolean;
}

const pageSize = 10;

function apiErrorCode(error: unknown) {
  if (!(error instanceof ApiRequestError) || !error.body || typeof error.body !== "object") return null;
  const code = (error.body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

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

export function AdminReservationsWorkspace({ reservationId }: { reservationId?: number }) {
  const isDetailsPage = reservationId !== undefined;
  const { platformPermissions, platformRole, propertyMemberships, loading: sessionLoading, authenticated, workspaces } = useAuthSession();
  const canReadAdmin = sessionLoading !== true && authenticated !== false && (!workspaces || workspaces.includes("admin"));
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkQuery = searchParams.toString();
  const returnHref = safeReservationReturnHref(searchParams.get("returnTo"));
  const restoredList = readReservationListState(searchParams);
  const detailsRequestRef = useRef(0);
  const deepLinkReservationNumber = searchParams.get("reservationNumber")?.trim() ?? "";
  const deepLinkReservationId = Number(searchParams.get("reservationId"));
  const deepLinkAttemptRef = useRef<string | null>(null);
  const currencyLabel = useSiteCurrencyLabel();
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [rooms, setRooms] = useState<RoomResponse[]>([]);
  const [reservations, setReservations] = useState<ReservationTableItem[]>([]);
  const [selectedReservationState, setSelectedReservation] =
    useState<ReservationTableItem | null>(null);
  const [taskReservation, setTaskReservation] = useState<TaskReservationContext | null>(null);
  const [editingReservation, setEditingReservation] =
    useState<ReservationTableItem | null>(null);
  const [draftFilters, setDraftFilters] =
    useState<ReservationListQuery>(restoredList.filters);
  const [filters, setFilters] = useState<ReservationListQuery>(restoredList.filters);
  const [currentPage, setCurrentPage] = useState(restoredList.page);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [manualPayments, setManualPayments] = useState<AdminManualPayment[]>([]);
  const [reviewQueueRefresh, setReviewQueueRefresh] = useState(0);
  const [reviewPage, setReviewPage] = useState(1);
  const [pendingReviewCount, setPendingReviewCount] = useState<number | null>(null);
  const tabsId = useId();
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedTab, setFocusedTab] = useState<ReservationListTab>(readReservationListTab(searchParams));
  const [statusChangingId, setStatusChangingId] = useState<number | null>(null);
  const [existingPaymentLink, setExistingPaymentLink] = useState<ReservationPaymentLinkResponse | null>(null);
  const [paymentLinkSendingId, setPaymentLinkSendingId] = useState<
    number | null
  >(null);
  const [error, setError] = useState("");
  const rejectingCancellationRequestRef = useRef(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const canManagePayments =
    platformRole === "SuperAdmin" || platformPermissions.includes("ManagePayments");
  const canReviewPayments = canReadAdmin && canManagePayments;
  const activeListTab = canReviewPayments ? readReservationListTab(searchParams) : "reservations";
  useEffect(() => { setFocusedTab(activeListTab); }, [activeListTab]);
  useEffect(() => { setReviewPage(1); setPendingReviewCount(null); }, [filters.propertyId]);
  const canManageReservations =
    platformRole === "SuperAdmin" || platformPermissions.includes("ManageReservations");
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
    if (isDetailsPage || !canReadAdmin) return;
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
  }, [currentPage, filters, isDetailsPage, canReadAdmin]);

  useEffect(() => {
    if (isDetailsPage || !canReadAdmin) return;
    apiRequest<PropertyResponse[]>("/admin/properties")
      .then(setProperties)
      .catch(() => setProperties([]));
  }, [isDetailsPage, canReadAdmin]);

  useEffect(() => {
    if (isDetailsPage || !canReadAdmin) return;
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
  }, [draftFilters.propertyId, isDetailsPage, canReadAdmin]);

  useEffect(() => {
    if (isDetailsPage || !canReadAdmin) return;
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
  }, [draftFilters.roomTypeId, isDetailsPage, canReadAdmin]);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  const searchValues = JSON.stringify([draftFilters.createdBy, draftFilters.guestSearch, draftFilters.reservationNumber, draftFilters.roomSearch]);
  const previousSearchRef = useRef(searchValues);
  useEffect(() => {
    if (isDetailsPage || previousSearchRef.current === searchValues) return;
    const timer = window.setTimeout(() => {
      previousSearchRef.current = searchValues;
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
    isDetailsPage, searchValues,
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

  const viewReservation = useCallback(async (
    reservation: ReservationTableItem,
    openAfterFetch = false,
  ) => {
    const requestId = ++detailsRequestRef.current;
    setExistingPaymentLink(null);
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!openAfterFetch) setSelectedReservation(reservation);
    setManualPayments([]);

    if (!reservationId) return;

    setDetailsLoading(true);
    setError("");

    try {
      const [details, payments] = await Promise.all([
        apiRequest<ReservationTableItem>(`/admin/reservations/${reservationId}`),
        canManagePayments
          ? apiRequest<AdminManualPayment[]>(
              `/admin/manual-payments/reservation/${reservationId}`,
            )
          : Promise.resolve([]),
      ]);
      if (detailsRequestRef.current !== requestId) return;
      setSelectedReservation(details);
      setManualPayments(payments);
    } catch (caught) {
      if (detailsRequestRef.current !== requestId) return;
      setError(
        openAfterFetch
          ? "دریافت رزرو موردنظر انجام نشد."
          : caught instanceof Error ? caught.message : "خطا در دریافت جزئیات رزرو.",
      );
    } finally {
      if (detailsRequestRef.current === requestId) setDetailsLoading(false);
    }
  }, [canManagePayments]);

  useEffect(() => {
    if (!isDetailsPage || !canReadAdmin) return;
    setSelectedReservation(null);
    if (!Number.isSafeInteger(reservationId) || reservationId! <= 0) {
      setError("شناسه رزرو معتبر نیست.");
      return;
    }
    void viewReservation({ id: reservationId } as ReservationTableItem, true);
    return () => { detailsRequestRef.current += 1; };
  }, [isDetailsPage, reservationId, viewReservation, canReadAdmin]);

  const currentListHref = reservationListHref(filters, currentPage, activeListTab);

  function activateListTab(tab: ReservationListTab) {
    if (tab !== activeListTab) router.push(reservationListHref(filters, currentPage, tab), { scroll: false });
  }

  function navigateListTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); activateListTab(listTabs[index].value); return;
    }
    let next: number;
    const count = canReviewPayments ? listTabs.length : 1;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      next = (index + (event.key === "ArrowLeft" ? 1 : -1) + count) % count;
    } else return;
    event.preventDefault();
    setFocusedTab(listTabs[next].value); tabButtons.current[next]?.focus();
  }
  useEffect(() => {
    if (isDetailsPage || deepLinkReservationNumber || deepLinkReservationId > 0) return;
    if (window.location.pathname + window.location.search !== currentListHref) {
      window.history.replaceState(window.history.state, "", currentListHref);
    }
  }, [isDetailsPage, currentListHref, deepLinkReservationNumber, deepLinkReservationId]);

  useEffect(() => {
    if (isDetailsPage || !canReadAdmin || (!deepLinkReservationNumber && !(Number.isSafeInteger(deepLinkReservationId) && deepLinkReservationId > 0))) return;
    if (deepLinkAttemptRef.current === deepLinkQuery) return;
    deepLinkAttemptRef.current = deepLinkQuery;
    let active = true;
    const cleanParams = new URLSearchParams(deepLinkQuery);
    cleanParams.delete("reservationNumber");
    cleanParams.delete("reservationId");
    const origin = safeReservationReturnHref(`/admin/reservations${cleanParams.size ? `?${cleanParams}` : ""}`);
    const openTarget = async () => {
      try {
        let id = deepLinkReservationId;
        if (deepLinkReservationNumber) {
          const lookup = await apiRequest<PagedResult<ReservationTableItem>>(
            buildReservationsPath({ ...initialFilters, reservationNumber: deepLinkReservationNumber }, 1));
          if (!active) return;
          const target = lookup.items.find(item => item.reservationNumber === deepLinkReservationNumber);
          id = target?.reservationId ?? target?.id ?? 0;
        }
        if (!active) return;
        if (Number.isSafeInteger(id) && id > 0) router.replace(reservationDetailsHref(id, origin), { scroll: false });
        else { setError("رزرو موردنظر یافت نشد."); router.replace(origin, { scroll: false }); }
      } catch {
        if (active) { setError("دریافت رزرو موردنظر انجام نشد."); router.replace(origin, { scroll: false }); }
      }
    };
    void openTarget();
    return () => { active = false; };
  }, [isDetailsPage, deepLinkQuery, deepLinkReservationNumber, deepLinkReservationId, router, canReadAdmin]);

  function navigateToReservation(item: ReservationTableItem) {
    const id = item.reservationId ?? item.id;
    if (id) router.push(reservationDetailsHref(id, currentListHref));
  }

  async function refreshReservationAndPayments(reservationId: number) {
    const [details, payments] = await Promise.all([
      apiRequest<ReservationTableItem>(`/admin/reservations/${reservationId}`),
      apiRequest<AdminManualPayment[]>(
        `/admin/manual-payments/reservation/${reservationId}`,
      ),
    ]);
    setSelectedReservation(details);
    setManualPayments(payments);
    setReviewQueueRefresh(value => value + 1);
    await loadReservations();
  }

  async function createManualPayment(
    reservation: ReservationTableItem,
    payment: AdminManualPaymentCreatePayload,
  ) {
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!reservationId) return;

    try {
      await apiRequest<AdminManualPayment>("/admin/manual-payments", {
        method: "POST",
        body: JSON.stringify({ reservationId, ...payment }),
      });
      await refreshReservationAndPayments(reservationId);
      toast.success("پرداخت دستی ثبت شد و در انتظار بررسی است.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "ثبت پرداخت دستی انجام نشد.";
      toast.error(message);
      if (caught instanceof ApiRequestError && caught.status === 409) {
        await refreshReservationAndPayments(reservationId).catch(() => undefined);
      }
      throw caught;
    }
  }

  async function approveManualPayment(paymentId: number) {
    const reservationId = selectedReservationState?.reservationId ?? selectedReservationState?.id;
    if (!reservationId) return;

    try {
      const result = await apiRequest<AdminManualPaymentMutationResponse>(
        `/admin/manual-payments/${paymentId}/approve`,
        { method: "POST" },
      );
      await refreshReservationAndPayments(reservationId);
      toast.success(
        result.reservationStatus === "CapacityLost"
          ? "پرداخت تأیید شد؛ اما ظرفیت رزرو دیگر موجود نیست."
          : "پرداخت تأیید و رزرو نهایی شد.",
      );
    } catch (caught) {
      const isConflict = caught instanceof ApiRequestError && caught.status === 409;
      const alreadyReviewed = isConflict && typeof caught.body === "object" && caught.body !== null &&
        "code" in caught.body && caught.body.code === "ManualPaymentAlreadyReviewed";
      const message = alreadyReviewed
        ? "این پرداخت قبلاً توسط مدیر دیگری بررسی شده است. اطلاعات به‌روز شد."
        : caught instanceof Error ? caught.message : "تأیید پرداخت دستی انجام نشد.";
      if (alreadyReviewed) toast.warning(message);
      else toast.error(message);
      if (isConflict) {
        await refreshReservationAndPayments(reservationId).catch(() => undefined);
      }
      throw caught;
    }
  }

  async function rejectManualPayment(paymentId: number, reason: string) {
    const reservationId = selectedReservationState?.reservationId ?? selectedReservationState?.id;
    if (!reservationId) return;

    try {
      await apiRequest<AdminManualPayment>(
        `/admin/manual-payments/${paymentId}/reject`,
        { method: "POST", body: JSON.stringify({ reason }) },
      );
      await refreshReservationAndPayments(reservationId);
      toast.success("پرداخت دستی رد شد.");
    } catch (caught) {
      const isConflict = caught instanceof ApiRequestError && caught.status === 409;
      const alreadyReviewed = isConflict && typeof caught.body === "object" && caught.body !== null &&
        "code" in caught.body && caught.body.code === "ManualPaymentAlreadyReviewed";
      const message = alreadyReviewed
        ? "این پرداخت قبلاً توسط مدیر دیگری بررسی شده است. اطلاعات به‌روز شد."
        : caught instanceof Error ? caught.message : "رد پرداخت دستی انجام نشد.";
      if (alreadyReviewed) toast.warning(message);
      else toast.error(message);
      if (isConflict) {
        await refreshReservationAndPayments(reservationId).catch(() => undefined);
      }
      throw caught;
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
      if (!isDetailsPage) setSelectedReservation(null);
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

  async function prepareManualPayment(reservation: ReservationTableItem) {
    const id = reservation.reservationId ?? reservation.id;
    if (!id) return;
    setStatusChangingId(id);
    setError("");
    try {
      const updated = await apiRequest<ReservationTableItem>(`/admin/reservations/${id}/prepare-payment`, { method: "PUT" });
      setSelectedReservation(updated);
      await viewReservation(updated, isDetailsPage);
      await loadReservations();
      toast.success("رزرو برای پرداخت آماده شد؛ مهلت پرداخت در جزئیات نمایش داده می‌شود.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "آماده‌سازی رزرو برای پرداخت انجام نشد.";
      setError(message);
      toast.error(message);
      throw caught;
    } finally { setStatusChangingId(null); }
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
          body: JSON.stringify(cancellation),
        },
      );
      await viewReservation(updated);
      await loadReservations();
      toast.success(updated.cancellationOutcome?.paidCancellation
        ? "لغو و تعیین تکلیف مالی رزرو با موفقیت انجام شد."
        : "رزرو با موفقیت لغو شد.");
    } catch (caught) {
      const code = apiErrorCode(caught);
      const message = code === "PostSettlementNettingRequired"
        ? "این رزرو قبلاً در یک تسویه پرداخت‌شده قرار گرفته است و لغو مالی آن نیاز به فرآیند اصلاح تسویه دارد."
        : code && caught instanceof ApiRequestError && caught.status === 409
          ? "اطلاعات لغو با وضعیت فعلی رزرو تعارض دارد. جزئیات رزرو به‌روز شد؛ پیش از اقدام دوباره آن را بررسی کنید."
          : caught instanceof Error ? caught.message : "خطا در لغو رزرو.";
      setError(message);
      toast.error(message);
      if (caught instanceof ApiRequestError && (caught.status === 409 || caught.status === 403))
        await viewReservation(reservation);
      throw caught;
    } finally {
      setStatusChangingId(null);
    }
  }

  async function rejectCancellationRequest(reservation: ReservationTableItem, note: string | null) {
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!reservationId || rejectingCancellationRequestRef.current) return;
    rejectingCancellationRequestRef.current = true;
    setError("");
    try {
      await apiRequest(`/admin/reservations/${reservationId}/cancellation-request/reject`, {
        method: "PUT",
        body: JSON.stringify({ note }),
      });
      const details = await apiRequest<ReservationTableItem>(`/admin/reservations/${reservationId}`);
      setSelectedReservation(details);
      toast.success("درخواست لغو مهمان رد شد؛ وضعیت رزرو تغییر نکرد.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "رد درخواست لغو انجام نشد.";
      setError(message);
      toast.error(message);
      throw caught;
    } finally {
      rejectingCancellationRequestRef.current = false;
    }
  }

  async function createCancellationRequest(
    reservation: ReservationTableItem,
    request: { reason: ReservationCancellationReason | "PaymentExpired"; message: string | null },
  ) {
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!reservationId) return;
    setError("");
    try {
      await apiRequest(`/admin/reservations/${reservationId}/cancellation-request`, {
        method: "POST",
        body: JSON.stringify({ reason: request.reason, message: request.message }),
      });
      const details = await apiRequest<ReservationTableItem>(`/admin/reservations/${reservationId}`);
      setSelectedReservation(details);
      await loadReservations();
      toast.success("درخواست لغو مهمان ثبت شد؛ وضعیت رزرو تغییر نکرد.");
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 409) {
        const details = await apiRequest<ReservationTableItem>(`/admin/reservations/${reservationId}`);
        setSelectedReservation(details);
        await loadReservations();
        if (details.cancellationRequest?.status === "Pending") return;
      }
      const message = caught instanceof Error ? caught.message : "ثبت درخواست لغو انجام نشد.";
      setError(message);
      toast.error(message);
      throw caught;
    }
  }

  async function refundReservation(reservation: ReservationTableItem, refund: ReservationRefundPayload) {
    const reservationId = reservation.reservationId ?? reservation.id;
    if (!reservationId) return;
    try {
      await apiRequest(`/admin/reservations/${reservationId}/refund`, {
        method: "POST", body: JSON.stringify(refund),
      });
      await viewReservation(reservation);
      await loadReservations();
      toast.success("بازپرداخت مهمان با موفقیت ثبت شد.");
    } catch (caught) {
      const code = apiErrorCode(caught);
      const message = code === "NoGuestRefundRequired"
        ? "برای این رزرو مبلغی جهت بازپرداخت به مهمان باقی نمانده است."
        : code === "RefundAlreadyRecorded"
          ? "بازپرداخت این رزرو قبلاً ثبت شده است."
          : code === "RefundIdempotencyConflict"
            ? "اطلاعات این تلاش بازپرداخت با درخواست قبلی متفاوت است. وضعیت رزرو به‌روز شد؛ دوباره بررسی کنید."
            : caught instanceof Error ? caught.message : "ثبت بازپرداخت انجام نشد.";
      setError(message);
      toast.error(message);
      if (caught instanceof ApiRequestError && caught.status === 409)
        await viewReservation(reservation);
      throw caught;
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
    setExistingPaymentLink(null);
    setError("");

    try {
      const response = await apiRequest<ReservationPaymentLinkResponse>(
        `/admin/reservations/${reservationId}/payment-link/send`,
        { method: "POST" },
      );
      if (response.reservationId === reservationId) setExistingPaymentLink(response);
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
      <main className="mx-auto grid w-full max-w-[1480px] gap-4 p-4 lg:p-6" dir="rtl">
        {isDetailsPage && <Link href={returnHref} className="justify-self-start rounded text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">بازگشت به رزروها</Link>}
        {isDetailsPage && error && <KoochCard><p role="alert">{error}</p><KoochButton variant="outline" onClick={() => { if (reservationId) void viewReservation({ id: reservationId } as ReservationTableItem, true); }}>تلاش دوباره</KoochButton></KoochCard>}
        {!isDetailsPage && <>
        <KoochPageHeader
          appearance="plain"
          actions={
            <ManualReservationDialog
              context="admin"
              canRecordReceivedPayment={propertyId => canManageReservations && canManagePayments && (platformRole === "SuperAdmin" || Boolean(propertyMemberships?.some(membership =>
                membership.propertyId === propertyId && membership.isActive && membership.membershipStatus === "Active" &&
                membership.effectivePermissions.Bookings?.create)))}
              onCreated={loadReservations}
              canReviewCreatedReservation={propertyId => platformRole === "SuperAdmin" || Boolean(propertyMemberships?.some(membership =>
                membership.propertyId === propertyId && membership.isActive && membership.membershipStatus === "Active" &&
                membership.effectivePermissions.Bookings?.edit))}
              onReviewCreatedReservation={canManageReservations ? id => {
                navigateToReservation({ id } as ReservationTableItem);
              } : undefined}
            />
          }
          description="فهرست رزروهای ثبت‌شده در همه اقامتگاه‌ها"
          eyebrow="مدیریت"
          title="رزروها"
        />

        {canReviewPayments && activeListTab === "reservations" && <ManualPaymentReviewQueue key={`summary-${filters.propertyId}`}
          summaryOnly countOnly propertyId={filters.propertyId ? Number(filters.propertyId) : undefined}
          refreshKey={reviewQueueRefresh} onTotalCountChange={setPendingReviewCount} />}
        <div role="tablist" aria-label="مدیریت رزروها" dir="rtl" className={styles.tabs}>
          {listTabs.filter(tab => tab.value === "reservations" || canReviewPayments).map((tab, index) => <button
            key={tab.value} type="button" role="tab" id={`${tabsId}-${tab.value}-tab`}
            aria-controls={`${tabsId}-${tab.value}-panel`} aria-selected={activeListTab === tab.value}
            tabIndex={focusedTab === tab.value ? 0 : -1} ref={node => { tabButtons.current[index] = node; }}
            onFocus={() => setFocusedTab(tab.value)} onClick={() => activateListTab(tab.value)}
            onKeyDown={event => navigateListTabs(event, index)}>
            {tab.label}{tab.value === "payments" && pendingReviewCount !== null && <span className={styles.count}>{toPersianDigits(pendingReviewCount)}</span>}
          </button>)}
        </div>
        <section role="tabpanel" id={`${tabsId}-reservations-panel`} aria-labelledby={`${tabsId}-reservations-tab`}
          tabIndex={0} hidden={activeListTab !== "reservations"} className={styles.panel}>
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
                    ? `${toPersianDigits(activeFilterCount)} فیلتر فعال است.`
                    : "بدون فیلتر فعال"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
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

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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

              <KoochField label="درخواست لغو">
                <KoochSelect
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      pendingCancellationRequest: event.target.value as "" | "true",
                    }))
                  }
                  value={draftFilters.pendingCancellationRequest}
                >
                  <option value="">همه رزروها</option>
                  <option value="true">درخواست لغو در انتظار</option>
                </KoochSelect>
              </KoochField>
            </div>

            <button
              aria-expanded={filtersOpen}
              aria-label={
                filtersOpen
                  ? "بستن فیلترهای پیشرفته"
                  : "باز کردن فیلترهای پیشرفته"
              }
              className="group -mx-1 -mb-3 flex h-6 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground transition hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setFiltersOpen((open) => !open)}
              type="button"
            >
              <svg
                aria-hidden="true"
                className={`h-4 w-4 transition-transform duration-150 ease-out motion-reduce:transition-none ${
                  filtersOpen ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 16 16"
              >
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
              </svg>
            </button>

            <div
              aria-hidden={!filtersOpen}
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                filtersOpen
                  ? "grid-rows-[1fr] opacity-100"
                  : "pointer-events-none grid-rows-[0fr] opacity-0"
              }`}
            >
              <div
                className={
                  filtersOpen
                    ? "min-h-0 overflow-visible pb-3"
                    : "min-h-0 overflow-hidden"
                }
              >
                <div className="grid gap-3 border-t border-border pt-2 md:grid-cols-2 xl:grid-cols-4">
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
                  <KoochDatePicker
                    mode="single"
                    size="compact"
                    autoConfirmOnSelect
                    label={null}
                    placeholder="انتخاب تاریخ"
                    value={draftFilters.checkInFrom || null}
                    onChange={(value) =>
                      setDraftFilters((current) => ({
                        ...current,
                        checkInFrom: value ?? "",
                      }))
                    }
                  />
                </KoochField>

                <KoochField label="ورود تا">
                  <KoochDatePicker
                    mode="single"
                    size="compact"
                    autoConfirmOnSelect
                    label={null}
                    placeholder="انتخاب تاریخ"
                    value={draftFilters.checkInTo || null}
                    onChange={(value) =>
                      setDraftFilters((current) => ({
                        ...current,
                        checkInTo: value ?? "",
                      }))
                    }
                  />
                </KoochField>

                <KoochField label="خروج از">
                  <KoochDatePicker
                    mode="single"
                    size="compact"
                    autoConfirmOnSelect
                    label={null}
                    placeholder="انتخاب تاریخ"
                    value={draftFilters.checkOutFrom || null}
                    onChange={(value) =>
                      setDraftFilters((current) => ({
                        ...current,
                        checkOutFrom: value ?? "",
                      }))
                    }
                  />
                </KoochField>

                <KoochField label="خروج تا">
                  <KoochDatePicker
                    mode="single"
                    size="compact"
                    autoConfirmOnSelect
                    label={null}
                    placeholder="انتخاب تاریخ"
                    value={draftFilters.checkOutTo || null}
                    onChange={(value) =>
                      setDraftFilters((current) => ({
                        ...current,
                        checkOutTo: value ?? "",
                      }))
                    }
                  />
                </KoochField>

                <KoochField label="ایجاد از">
                  <KoochDatePicker
                    mode="single"
                    size="compact"
                    autoConfirmOnSelect
                    label={null}
                    placeholder="انتخاب تاریخ"
                    value={draftFilters.createdFrom || null}
                    onChange={(value) =>
                      setDraftFilters((current) => ({
                        ...current,
                        createdFrom: value ?? "",
                      }))
                    }
                  />
                </KoochField>

                <KoochField label="ایجاد تا">
                  <KoochDatePicker
                    mode="single"
                    size="compact"
                    autoConfirmOnSelect
                    label={null}
                    placeholder="انتخاب تاریخ"
                    value={draftFilters.createdTo || null}
                    onChange={(value) =>
                      setDraftFilters((current) => ({
                        ...current,
                        createdTo: value ?? "",
                      }))
                    }
                  />
                </KoochField>







                <p className="text-xs font-medium text-muted-foreground md:col-span-2 xl:col-span-4">
                  واحد مبالغ: {currencyLabel}
                </p>

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


                </div>
              </div>
            </div>
          </form>
        </KoochCard>

        <ReservationTable
          context="admin"
          currentPage={currentPage}
          emptyMessage={filters.pendingCancellationRequest === "true"
            ? "درخواست لغو در انتظار بررسی وجود ندارد."
            : "هنوز رزروی ثبت نشده است."}
          loading={loading}
          onPageChange={setCurrentPage}
          onView={navigateToReservation}
          detailsHref={item => reservationDetailsHref(item.reservationId ?? item.id!, currentListHref)}
          reservations={reservations}
          totalPages={totalPages}
        />
        </section>
        {canReviewPayments && <section role="tabpanel" id={`${tabsId}-payments-panel`} aria-labelledby={`${tabsId}-payments-tab`}
          tabIndex={0} hidden={activeListTab !== "payments"} className={styles.panel}>
          {activeListTab === "payments" && <ManualPaymentReviewQueue key={filters.propertyId}
            propertyId={filters.propertyId ? Number(filters.propertyId) : undefined} refreshKey={reviewQueueRefresh}
            page={reviewPage} onPageChange={setReviewPage} onTotalCountChange={setPendingReviewCount} returnTo={currentListHref} />}
        </section>}

        </>}

        <ReservationDetailsDialog
          initialTab={isDetailsPage && searchParams.get("tab") === "financial" ? "financial" : "reservation"}
          paymentLink={existingPaymentLink}
          presentation={isDetailsPage ? "page" : "dialog"}
          showAdminActivities
          canAddInternalNote={canManageReservations}
          onAssignTask={canManageReservations ? (reservation) => {
            const id = reservation.reservationId ?? reservation.id;
            if (id) setTaskReservation({ reservationId: id, reservationNumber: reservation.reservationNumber, propertyName: reservation.propertyName });
          } : undefined}
          onViewVoucher={canManagePayments ? (reservation) => {
            const id = reservation.reservationId ?? reservation.id;
            if (id) router.push(`/admin/reservations/${id}/voucher${returnHref === "/admin/reservations" ? "" : `?returnTo=${encodeURIComponent(returnHref)}`}`);
          } : undefined}
          loading={detailsLoading}
          manualPayments={manualPayments}
          manualPaymentsLoading={detailsLoading && canManagePayments}
          onAdjustPrice={adjustReservationPrice}
          onApproveManualPayment={canManagePayments ? approveManualPayment : undefined}
          onCancel={cancelReservation}
          onCreateCancellationRequest={createCancellationRequest}
          onRejectCancellationRequest={rejectCancellationRequest}
          onRefund={canManagePayments ? refundReservation : undefined}
          onCreateManualPayment={canManagePayments ? createManualPayment : undefined}
          onEdit={editReservation}
          onRejectManualPayment={canManagePayments ? rejectManualPayment : undefined}
          onRefresh={viewReservation}
          onOrderSettled={canManagePayments ? async reservation => {
            const id = reservation.reservationId ?? reservation.id;
            if (id) await refreshReservationAndPayments(id);
          } : undefined}
          onSendPaymentLink={sendPaymentLink}
          onStatusChange={updateReservationStatus}
          onPrepareManualPayment={prepareManualPayment}
          onOpenChange={(open) => {
            if (!open) {
              if (isDetailsPage) { router.push(returnHref); return; }
              setSelectedReservation(null);
              setManualPayments([]);
            }
          }}
          open={isDetailsPage && (Boolean(selectedReservationState) || detailsLoading) && taskReservation === null}
          reservation={selectedReservationState}
        />

        {taskReservation !== null && canManageReservations && <AdminTaskCreateDialog
          linkedReservation={taskReservation}
          onClose={() => setTaskReservation(null)}
          onCreated={() => { router.push("/admin/tasks?scope=created"); }}
        />}

        <ManualReservationDialog
          context="admin"
          mode="edit"
          onCreated={async () => { if (isDetailsPage && reservationId) await viewReservation({ id: reservationId } as ReservationTableItem, true); else await loadReservations(); }}
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
