"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog, KoochDialogButton } from "@/components/KoochDialog";
import {
  KoochField,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import type {
  ReservationCancellationPayload,
  ReservationCancellationReason,
  ReservationTimelineEvent,
  ReservationTableItem,
  ReservationTableStatus,
} from "@/components/reservations/ReservationTable";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import { useReservationPaymentCountdown } from "@/lib/reservation-countdown";

interface ReservationDetailsDialogProps {
  loading?: boolean;
  onCancel?: (
    reservation: ReservationTableItem,
    cancellation: ReservationCancellationPayload,
  ) => void | Promise<void>;
  onEdit?: (reservation: ReservationTableItem) => void;
  onSendPaymentLink?: (
    reservation: ReservationTableItem,
  ) => void | Promise<void>;
  onRefresh?: (reservation: ReservationTableItem) => void | Promise<void>;
  onStatusChange?: (
    reservation: ReservationTableItem,
    status: ReservationTableStatus,
  ) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  reservation: ReservationTableItem | null;
}

const statusLabels: Record<string, string> = {
  Pending: "در انتظار",
  Confirmed: "تایید شده",
  Rejected: "رد شده",
  Cancelled: "لغو شده",
  Paid: "پرداخت شده",
  Completed: "تکمیل شده",
  OnHold: "در انتظار بررسی",
  Expired: "منقضی شده",
  PendingApproval: "در انتظار تایید",
  ApprovedAwaitingPayment: "در انتظار پرداخت",
  PaymentExpired: "مهلت پرداخت گذشته",
};

const sourceLabels: Record<string, string> = {
  Website: "وب‌سایت",
  OwnerManual: "ثبت مالک",
  PhoneReferral: "ارجاع تلفنی",
  AdminCreated: "ثبت ادمین",
  ExternalChannel: "کانال بیرونی",
};

const cancellationReasonOptions: Array<{
  value: ReservationCancellationReason;
  label: string;
}> = [
  { value: "GuestRequest", label: "درخواست مهمان" },
  { value: "NonPayment", label: "عدم پرداخت" },
  { value: "NoAvailability", label: "نبود ظرفیت" },
  { value: "PropertyRuleConflict", label: "تعارض با قوانین اقامتگاه" },
  { value: "DuplicateReservation", label: "رزرو تکراری" },
  { value: "InvalidGuestInformation", label: "اطلاعات نامعتبر مهمان" },
  {
    value: "PropertyMaintenanceOrForceMajeure",
    label: "تعمیرات اقامتگاه / شرایط اضطراری",
  },
  { value: "AdministrativeCorrection", label: "اصلاح اداری" },
  { value: "Other", label: "سایر" },
];

const cancellationReasonLabels = Object.fromEntries(
  cancellationReasonOptions.map((option) => [option.value, option.label]),
) as Record<ReservationCancellationReason, string>;

const timelineLabels: Record<ReservationTimelineEvent["type"], string> = {
  Created: "ایجاد رزرو",
  Updated: "ویرایش رزرو",
  Approved: "تایید درخواست",
  PaymentLinkCreated: "ایجاد لینک پرداخت",
  Paid: "پرداخت",
  StatusChanged: "تغییر وضعیت",
  Cancelled: "لغو رزرو",
};

const statusActionText: Record<
  string,
  { label: string; description: string; variant?: "warning" | "destructive" }
> = {
  ApprovedAwaitingPayment: {
    label: "آماده پرداخت",
    description:
      "رزرو به وضعیت آماده پرداخت منتقل می‌شود و اطلاع‌رسانی برای مهمان ثبت خواهد شد.",
    variant: "warning",
  },
  Confirmed: {
    label: "تایید رزرو",
    description: "رزرو تایید می‌شود. پرداخت یا کاهش موجودی انجام نمی‌شود.",
    variant: "warning",
  },
  Completed: {
    label: "تکمیل / خروج",
    description: "رزرو تکمیل‌شده علامت می‌خورد.",
    variant: "warning",
  },
  PaymentExpired: {
    label: "اتمام مهلت پرداخت",
    description: "رزرو به وضعیت اتمام مهلت پرداخت منتقل می‌شود.",
    variant: "destructive",
  },
};

function statusVariant(status?: ReservationTableStatus) {
  if (status === "Confirmed" || status === "Paid" || status === "Completed") {
    return "success" as const;
  }

  if (
    status === "Pending" ||
    status === "OnHold" ||
    status === "PendingApproval" ||
    status === "ApprovedAwaitingPayment"
  ) {
    return "warning" as const;
  }

  if (
    status === "Cancelled" ||
    status === "Rejected" ||
    status === "Expired" ||
    status === "PaymentExpired"
  ) {
    return "destructive" as const;
  }

  return "muted" as const;
}

function formatDate(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatNumber(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("fa-IR").format(value);
}

function formatSource(value?: string | null) {
  if (!value) return "-";
  return sourceLabels[value] ?? value;
}

function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return "-";

  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  const formatter = new Intl.NumberFormat("fa-IR", {
    minimumIntegerDigits: 2,
  });

  return `${formatter.format(minutes)}:${formatter.format(remainingSeconds)}`;
}

function isUnpaidReservation(reservation: ReservationTableItem) {
  if (typeof reservation.remainingAmount === "number") {
    return reservation.remainingAmount > 0;
  }

  const totalAmount = reservation.totalPrice ?? reservation.finalAmount;
  if (
    typeof totalAmount === "number" &&
    typeof reservation.paidAmount === "number"
  ) {
    return reservation.paidAmount < totalAmount;
  }

  return reservation.status !== "Paid";
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-background px-3 py-2">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="min-h-6 text-sm font-bold text-foreground">{value}</dd>
    </div>
  );
}

function DetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <KoochCard className="grid gap-3" padding="sm" variant="elevated">
      <h3 className="text-sm font-black text-foreground">{title}</h3>
      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</dl>
    </KoochCard>
  );
}

function TimelineSection({ events }: { events: ReservationTimelineEvent[] }) {
  return (
    <KoochCard className="grid gap-3" padding="sm" variant="elevated">
      <h3 className="text-sm font-black text-foreground">خط زمانی</h3>
      {events.length === 0 ? (
        <p className="text-sm font-semibold text-muted-foreground">
          رویدادی برای این رزرو ثبت نشده است.
        </p>
      ) : (
        <ol className="grid gap-0">
          {events.map((event, index) => {
            const reason = event.cancellationReason
              ? cancellationReasonLabels[event.cancellationReason]
              : null;
            const status = event.status
              ? statusLabels[event.status] ?? event.status
              : null;

            return (
              <li
                className="relative grid gap-1 border-r-2 border-border py-3 pr-5 first:pt-1 last:border-transparent last:pb-1"
                key={`${event.type}-${event.timestampUtc}-${index}`}
              >
                <span className="absolute -right-[5px] top-4 h-2 w-2 rounded-full bg-primary" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-black text-foreground">
                    {timelineLabels[event.type]}
                  </span>
                  <time className="text-xs font-semibold text-muted-foreground">
                    {formatDateTime(event.timestampUtc)}
                  </time>
                </div>
                {event.actor && (
                  <span className="text-xs font-semibold text-muted-foreground">
                    توسط {event.actor}
                  </span>
                )}
                {status && (
                  <span className="text-xs font-semibold text-muted-foreground">
                    وضعیت: {status}
                  </span>
                )}
                {reason && (
                  <span className="text-xs font-semibold text-muted-foreground">
                    دلیل: {reason}
                  </span>
                )}
                {event.note && (
                  <p className="text-xs leading-6 text-muted-foreground">
                    {event.note}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </KoochCard>
  );
}

function ReservationCancellationDialog({
  onConfirm,
  onOpenChange,
  open,
  reservationNumber,
}: {
  onConfirm: (cancellation: ReservationCancellationPayload) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  reservationNumber: string;
}) {
  const formId = useId();
  const [reason, setReason] = useState<ReservationCancellationReason | "">("");
  const [explanation, setExplanation] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [explanationError, setExplanationError] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  useEffect(() => {
    if (open) return;
    setReason("");
    setExplanation("");
    setReasonError("");
    setExplanationError("");
    setConfirmationOpen(false);
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedExplanation = explanation.trim();
    const nextReasonError = reason ? "" : "دلیل لغو را انتخاب کنید.";
    const nextExplanationError = trimmedExplanation
      ? ""
      : "توضیحات لغو را وارد کنید.";

    setReasonError(nextReasonError);
    setExplanationError(nextExplanationError);
    if (nextReasonError || nextExplanationError || !reason) return;

    setExplanation(trimmedExplanation);
    setConfirmationOpen(true);
  }

  async function confirmCancellation() {
    if (!reason || !explanation.trim()) return;
    await onConfirm({ reason, explanation: explanation.trim() });
    setConfirmationOpen(false);
    onOpenChange(false);
  }

  return (
    <>
      <KoochDialog
        description={`شماره رزرو: ${reservationNumber}`}
        footer={
          <>
            <KoochDialogButton
              form={formId}
              type="submit"
              variant="danger"
            >
              ادامه لغو رزرو
            </KoochDialogButton>
            <KoochDialogButton onClick={() => onOpenChange(false)}>
              انصراف
            </KoochDialogButton>
          </>
        }
        onOpenChange={onOpenChange}
        open={open}
        size="md"
        title="لغو رزرو"
      >
        <form className="grid gap-4" id={formId} onSubmit={submit}>
          <KoochField error={reasonError} label="دلیل لغو" required>
            <KoochSelect
              error={reasonError}
              onChange={(event) => {
                setReason(
                  event.target.value as ReservationCancellationReason | "",
                );
                setReasonError("");
              }}
              value={reason}
            >
              <option value="">انتخاب دلیل لغو</option>
              {cancellationReasonOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </KoochSelect>
          </KoochField>

          <KoochField error={explanationError} label="توضیحات" required>
            <KoochTextarea
              error={explanationError}
              maxLength={2000}
              onChange={(event) => {
                setExplanation(event.target.value);
                setExplanationError("");
              }}
              placeholder="علت و جزئیات لغو رزرو را وارد کنید."
              value={explanation}
            />
          </KoochField>
        </form>
      </KoochDialog>

      <KoochConfirmDialog
        confirmText="تایید و لغو رزرو"
        description="پس از لغو، این رزرو فقط قابل مشاهده خواهد بود و امکان ویرایش آن وجود ندارد."
        onConfirm={confirmCancellation}
        onOpenChange={setConfirmationOpen}
        open={confirmationOpen}
        title="از لغو این رزرو مطمئن هستید؟"
        variant="destructive"
      >
        <KoochAlert title="لغو نهایی رزرو" variant="destructive">
          دلیل: {reason ? cancellationReasonLabels[reason] : "-"}
          <br />
          توضیحات: {explanation || "-"}
        </KoochAlert>
      </KoochConfirmDialog>
    </>
  );
}

export function ReservationDetailsDialog({
  loading = false,
  onCancel,
  onEdit,
  onRefresh,
  onSendPaymentLink,
  onStatusChange,
  onOpenChange,
  open,
  reservation,
}: ReservationDetailsDialogProps) {
  const currencyLabel = useSiteCurrencyLabel();
  const guestName = reservation?.guestName ?? reservation?.guestFullName ?? "-";
  const guestEmail = reservation?.guestEmail ?? reservation?.email ?? "-";
  const identityNumber =
    reservation?.guestNationalCode ?? reservation?.guestPassportNumber ?? "-";
  const roomName = reservation?.roomTypeName ?? reservation?.roomName ?? "-";
  const totalAmount = reservation?.totalPrice ?? reservation?.finalAmount;
  const baseAmount = reservation?.baseAmount ?? reservation?.basePrice;
  const childAmount = reservation?.childAmount ?? reservation?.childCharge;
  const extraGuestAmount =
    reservation?.extraGuestAmount ?? reservation?.extraGuestCharge;
  const promotionDiscount =
    reservation?.discountAmount ?? reservation?.promotionDiscount;
  const couponDiscount = reservation?.couponDiscountAmount ?? 0;
  const paidAmount =
    reservation?.paidAmount ??
    (typeof totalAmount === "number" &&
    typeof reservation?.remainingAmount === "number"
      ? Math.max(totalAmount - reservation.remainingAmount, 0)
      : null);
  const statusActions = reservation?.allowedStatusTransitions ?? [];
  const isReadOnly = reservation?.status === "Cancelled";
  const canCancel =
    !isReadOnly && Boolean(onCancel) && statusActions.includes("Cancelled");
  const timelineEvents: ReservationTimelineEvent[] =
    reservation?.timeline && reservation.timeline.length > 0
      ? reservation.timeline
      : [
          ...(reservation?.createdAtUtc
            ? [
                {
                  type: "Created" as const,
                  timestampUtc: reservation.createdAtUtc,
                  actorUserId: reservation.createdByUserId,
                  actor: reservation.createdBy,
                },
              ]
            : []),
          ...(reservation?.changedAtUtc
            ? [
                {
                  type: "Updated" as const,
                  timestampUtc: reservation.changedAtUtc,
                  actorUserId: reservation.changedByUserId,
                },
              ]
            : []),
        ];
  const [cancellationOpen, setCancellationOpen] = useState(false);
  const [confirmedEditWarningOpen, setConfirmedEditWarningOpen] =
    useState(false);
  const expiryRefreshStartedRef = useRef(false);
  const shouldShowPaymentCountdown =
    reservation?.status === "ApprovedAwaitingPayment";
  const remainingPaymentSeconds = useReservationPaymentCountdown(
    shouldShowPaymentCountdown,
    reservation?.paymentExpiresAtUtc,
  );
  const canSendPaymentLink =
    reservation !== null &&
    !isReadOnly &&
    reservation.status === "ApprovedAwaitingPayment" &&
    !reservation.isPaymentExpired &&
    isUnpaidReservation(reservation);

  useEffect(() => {
    expiryRefreshStartedRef.current = false;
  }, [
    reservation?.paymentExpiresAtUtc,
    reservation?.reservationId,
    reservation?.id,
  ]);

  useEffect(() => {
    if (!shouldShowPaymentCountdown || remainingPaymentSeconds === null) {
      return;
    }

    if (remainingPaymentSeconds <= 0) {
      if (
        reservation &&
        onRefresh &&
        !expiryRefreshStartedRef.current
      ) {
        expiryRefreshStartedRef.current = true;
        void onRefresh(reservation);
      }
      return;
    }
  }, [
    onRefresh,
    remainingPaymentSeconds,
    reservation,
    shouldShowPaymentCountdown,
  ]);

  return (
    <>
      <KoochDialog
        description={reservation?.reservationNumber ?? undefined}
        footer={
          <>
          {reservation && !isReadOnly && onEdit && (
            <KoochButton
              onClick={() => {
                if (reservation.status === "Confirmed") {
                  setConfirmedEditWarningOpen(true);
                  return;
                }
                onEdit(reservation);
              }}
              variant="outline"
            >
              ویرایش
            </KoochButton>
          )}
          {reservation &&
            !isReadOnly &&
            onSendPaymentLink &&
            canSendPaymentLink && (
              <KoochConfirmDialog
                cancelText="انصراف"
                confirmText="ارسال لینک پرداخت"
                description="لینک پرداخت جدید ساخته می‌شود، لینک‌های فعال قبلی باطل می‌شوند و اطلاع‌رسانی پیامک و ایمیل فقط در لاگ ثبت خواهد شد."
                onConfirm={() => onSendPaymentLink(reservation)}
                title="ارسال لینک پرداخت"
                trigger={
                  <KoochButton variant="outline">ارسال لینک پرداخت</KoochButton>
                }
                variant="warning"
              />
            )}
          {reservation &&
            !isReadOnly &&
            onStatusChange &&
            statusActions
              .filter((nextStatus) => nextStatus !== "Cancelled")
              .map((nextStatus) => {
                const text = statusActionText[nextStatus] ?? {
                  label: statusLabels[nextStatus] ?? nextStatus,
                  description: "وضعیت رزرو تغییر می‌کند.",
                  variant: "warning" as const,
                };

                return (
                  <KoochConfirmDialog
                    cancelText="انصراف"
                    confirmText={text.label}
                    description={text.description}
                    key={nextStatus}
                    onConfirm={() => onStatusChange(reservation, nextStatus)}
                    title={text.label}
                    trigger={
                      <KoochButton
                        variant={
                          text.variant === "destructive"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {text.label}
                      </KoochButton>
                    }
                    variant={text.variant}
                  >
                    <KoochAlert
                      title="تایید تغییر وضعیت"
                      variant={
                        text.variant === "destructive"
                          ? "destructive"
                          : "warning"
                      }
                    >
                      وضعیت رزرو از «{statusLabels[reservation.status] ?? reservation.status}»
                      به «{statusLabels[nextStatus] ?? nextStatus}» تغییر می‌کند.
                    </KoochAlert>
                  </KoochConfirmDialog>
                );
              })}
          {reservation && canCancel && (
            <KoochButton
              onClick={() => setCancellationOpen(true)}
              variant="destructive"
            >
              لغو رزرو
            </KoochButton>
          )}
          <KoochDialogButton onClick={() => onOpenChange(false)}>
            بستن
          </KoochDialogButton>
          </>
        }
        onOpenChange={onOpenChange}
        open={open}
        size="xl"
        title="جزئیات رزرو"
      >
      {loading && !reservation ? (
        <p className="text-sm font-semibold text-muted-foreground">
          در حال بارگذاری...
        </p>
      ) : reservation ? (
        <div className="grid gap-4">
          {loading && (
            <p className="text-xs font-semibold text-muted-foreground">
              در حال به‌روزرسانی جزئیات...
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                وضعیت فعلی رزرو
              </p>
              <p className="mt-1 text-sm font-bold text-foreground">
                {statusLabels[reservation.status] ?? reservation.status}
              </p>
            </div>
            <KoochBadge variant={statusVariant(reservation.status)}>
              {statusLabels[reservation.status] ?? reservation.status}
            </KoochBadge>
          </div>

          <DetailSection title="رزرو">
            <DetailItem
              label="شماره رزرو"
              value={reservation.reservationNumber || "-"}
            />
            <DetailItem label="منبع" value={formatSource(reservation.source)} />
            <DetailItem
              label="تاریخ ایجاد"
              value={formatDateTime(reservation.createdAtUtc)}
            />
            <DetailItem
              label="ایجادکننده"
              value={reservation.createdBy ?? "-"}
            />
          </DetailSection>

          <DetailSection title="مهمان">
            <DetailItem label="نام کامل" value={guestName} />
            <DetailItem label="موبایل" value={reservation.guestMobile ?? "-"} />
            <DetailItem label="ایمیل" value={guestEmail} />
            <DetailItem label="کد ملی / شماره پاسپورت" value={identityNumber} />
            <DetailItem
              label="ملیت"
              value={reservation.guestNationality ?? "-"}
            />
          </DetailSection>

          <DetailSection title="اقامت">
            <DetailItem
              label="اقامتگاه"
              value={reservation.propertyName ?? "-"}
            />
            <DetailItem label="نوع اتاق" value={roomName} />
            <DetailItem
              label="تاریخ ورود"
              value={formatDate(reservation.checkInDate)}
            />
            <DetailItem
              label="تاریخ خروج"
              value={formatDate(reservation.checkOutDate)}
            />
            <DetailItem
              label="تعداد شب"
              value={formatNumber(reservation.nightsCount)}
            />
            <DetailItem
              label="بزرگسال"
              value={formatNumber(reservation.adults)}
            />
            <DetailItem
              label="کودک"
              value={formatNumber(reservation.children)}
            />
            <DetailItem
              label="تعداد اتاق"
              value={formatNumber(reservation.roomCount)}
            />
          </DetailSection>

          <DetailSection title="مالی">
            <DetailItem
              label="قیمت پایه"
              value={formatCurrency(baseAmount, { currencyLabel })}
            />
            <DetailItem
              label="هزینه کودک"
              value={formatCurrency(childAmount, { currencyLabel })}
            />
            <DetailItem
              label="هزینه نفر اضافه"
              value={formatCurrency(extraGuestAmount, { currencyLabel })}
            />
            <DetailItem
              label="تخفیف پروموشن"
              value={formatCurrency(promotionDiscount, { currencyLabel })}
            />
            <DetailItem
              label="تخفیف کوپن"
              value={formatCurrency(couponDiscount, { currencyLabel })}
            />
            <DetailItem
              label="هزینه خدمات"
              value={formatCurrency(reservation.serviceFeeAmount, {
                currencyLabel,
              })}
            />
            <DetailItem
              label="مالیات"
              value={formatCurrency(reservation.taxAmount, { currencyLabel })}
            />
            <DetailItem
              label="مبلغ کل"
              value={formatCurrency(totalAmount, { currencyLabel })}
            />
            <DetailItem
              label="مبلغ قابل پرداخت"
              value={formatCurrency(reservation.payableAmount, {
                currencyLabel,
              })}
            />
            <DetailItem
              label="مبلغ پرداخت‌شده"
              value={formatCurrency(paidAmount, { currencyLabel })}
            />
            <DetailItem
              label="باقی‌مانده"
              value={formatCurrency(reservation.remainingAmount, {
                currencyLabel,
              })}
            />
            <DetailItem label="واحد پول" value={currencyLabel} />
          </DetailSection>

          <TimelineSection events={timelineEvents} />

          <DetailSection title="مهلت پرداخت">
            <DetailItem
              label="مهلت پرداخت"
              value={formatDateTime(reservation.paymentExpiresAtUtc)}
            />
            {shouldShowPaymentCountdown && (
              <DetailItem
                label="زمان باقی‌مانده"
                value={
                  <KoochBadge
                    variant={
                      reservation.isPaymentExpired ||
                      remainingPaymentSeconds === 0
                        ? "destructive"
                        : "warning"
                    }
                  >
                    {reservation.isPaymentExpired ||
                    remainingPaymentSeconds === 0
                      ? "مهلت پرداخت تمام شده است."
                      : formatDuration(remainingPaymentSeconds)}
                  </KoochBadge>
                }
              />
            )}
          </DetailSection>

          <DetailSection title="یادداشت">
            <DetailItem label="توضیحات رزرو" value={reservation.notes ?? "-"} />
            <DetailItem
              label="توضیحات لغو"
              value={reservation.cancellationNote ?? "-"}
            />
          </DetailSection>
        </div>
      ) : (
        <p className="text-sm font-semibold text-muted-foreground">
          رزروی برای نمایش انتخاب نشده است.
        </p>
      )}
      </KoochDialog>

      {reservation && onEdit && (
        <KoochConfirmDialog
          cancelText="انصراف"
          confirmText="ادامه ویرایش"
          onConfirm={() => onEdit(reservation)}
          onOpenChange={setConfirmedEditWarningOpen}
          open={confirmedEditWarningOpen}
          title="ویرایش رزرو تاییدشده"
          variant="warning"
        >
          <KoochAlert title="هشدار ویرایش" variant="warning">
            این رزرو تایید شده است. تغییر اطلاعات ممکن است روی قیمت و ظرفیت اثر
            بگذارد.
          </KoochAlert>
        </KoochConfirmDialog>
      )}

      {reservation && onCancel && (
        <ReservationCancellationDialog
          onConfirm={async (cancellation) => {
            await onCancel(reservation, cancellation);
          }}
          onOpenChange={setCancellationOpen}
          open={cancellationOpen}
          reservationNumber={reservation.reservationNumber}
        />
      )}
    </>
  );
}
