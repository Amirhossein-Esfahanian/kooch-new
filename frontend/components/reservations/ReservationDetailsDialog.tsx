"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import {
  KoochField,
  KoochInput,
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
import { toPersianDigits } from "@/lib/persian-digits";
import { useReservationPaymentCountdown } from "@/lib/reservation-countdown";

interface ReservationDetailsDialogProps {
  loading?: boolean;
  onAdjustPrice?: (
    reservation: ReservationTableItem,
    amount: number,
  ) => void | Promise<void>;
  onCancel?: (
    reservation: ReservationTableItem,
    cancellation: ReservationCancellationPayload,
  ) => void | Promise<void>;
  onEdit?: (reservation: ReservationTableItem) => void;
  onSendPaymentLink?: (
    reservation: ReservationTableItem,
  ) => void | Promise<void>;
  onRefresh?: (reservation: ReservationTableItem) => void | Promise<void>;
  manualPayments?: AdminManualPayment[];
  manualPaymentsLoading?: boolean;
  onCreateManualPayment?: (
    reservation: ReservationTableItem,
    payment: AdminManualPaymentCreatePayload,
  ) => void | Promise<void>;
  onApproveManualPayment?: (paymentId: number) => void | Promise<void>;
  onRejectManualPayment?: (
    paymentId: number,
    reason: string,
  ) => void | Promise<void>;
  onStatusChange?: (
    reservation: ReservationTableItem,
    status: ReservationTableStatus,
  ) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  reservation: ReservationTableItem | null;
}

export type ManualPaymentMethod =
  | "CardToCard"
  | "BankTransfer"
  | "Paya"
  | "Satna"
  | "AccountTransfer"
  | "Other";

export interface AdminManualPaymentCreatePayload {
  amount: number;
  currency: string;
  method: ManualPaymentMethod;
  paymentDate: string;
  paymentTime: string | null;
  referenceNumber: string | null;
  destinationBank: string | null;
  destinationAccountReference: string | null;
  notes: string | null;
}

export interface AdminManualPayment extends AdminManualPaymentCreatePayload {
  paymentId: number;
  reservationId: number;
  status: "Pending" | "Successful" | "Failed" | "Refunded";
  verificationStatus: "PendingVerification" | "Approved" | "Rejected";
  submittedByUserId?: number | null;
  submittedBy?: string | null;
  submittedAtUtc: string;
  verifiedByUserId?: number | null;
  verifiedBy?: string | null;
  verifiedAtUtc?: string | null;
  rejectedByUserId?: number | null;
  rejectedBy?: string | null;
  rejectedAtUtc?: string | null;
  rejectionReason?: string | null;
}

const manualPaymentMethodOptions: Array<{
  value: ManualPaymentMethod;
  label: string;
}> = [
  { value: "CardToCard", label: "کارت‌به‌کارت" },
  { value: "BankTransfer", label: "واریز بانکی" },
  { value: "Paya", label: "پایا" },
  { value: "Satna", label: "ساتنا" },
  { value: "AccountTransfer", label: "انتقال حساب" },
  { value: "Other", label: "سایر" },
];

const manualPaymentMethodLabels = Object.fromEntries(
  manualPaymentMethodOptions.map((option) => [option.value, option.label]),
) as Record<ManualPaymentMethod, string>;

const manualPaymentVerificationLabels = {
  PendingVerification: "در انتظار بررسی",
  Approved: "تأیید شده",
  Rejected: "رد شده",
} as const;

const manualPaymentStatusLabels = {
  Pending: "در انتظار",
  Successful: "موفق",
  Failed: "ناموفق",
  Refunded: "بازگشت داده‌شده",
} as const;

function localIsoToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
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
  CapacityLost: "ظرفیت از دست رفته",
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
  PriceAdjusted: "اصلاح دستی قیمت",
};

const statusActionText: Record<
  string,
  {
    label: string;
    description: string;
    variant?: "information" | "question" | "warning" | "destructive";
  }
> = {
  ApprovedAwaitingPayment: {
    label: "آماده پرداخت",
    description:
      "رزرو به وضعیت آماده پرداخت منتقل می‌شود و اطلاع‌رسانی برای مهمان ثبت خواهد شد.",
    variant: "warning",
  },
  Rejected: {
    label: "رد درخواست",
    description: "درخواست رزرو رد می‌شود و دیگر قابل ویرایش نخواهد بود.",
    variant: "destructive",
  },
  Confirmed: {
    label: "تایید رزرو",
    description: "رزرو تایید می‌شود. پرداخت یا کاهش موجودی انجام نمی‌شود.",
    variant: "information",
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
    status === "PaymentExpired" ||
    status === "CapacityLost"
  ) {
    return "destructive" as const;
  }

  return "muted" as const;
}

function formatDate(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return toPersianDigits(
    new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date),
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return toPersianDigits(
    new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
  );
}

function formatNumber(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return toPersianDigits(new Intl.NumberFormat("fa-IR").format(value));
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

  return toPersianDigits(
    `${formatter.format(minutes)}:${formatter.format(remainingSeconds)}`,
  );
}

function isUnpaidReservation(reservation: ReservationTableItem) {
  if (typeof reservation.remainingAmount === "number") {
    return reservation.remainingAmount > 0;
  }

  const totalAmount = reservation.finalAmount ?? reservation.totalPrice;
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
  action,
  children,
  footer,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  title: string;
}) {
  return (
    <KoochCard className="grid gap-3" padding="sm" variant="elevated">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {action}
      </div>
      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</dl>
      {footer}
    </KoochCard>
  );
}

function TimelineSection({ events }: { events: ReservationTimelineEvent[] }) {
  const currencyLabel = useSiteCurrencyLabel();

  return (
    <KoochCard className="grid gap-3" padding="sm" variant="elevated">
      <h3 className="text-sm font-bold text-foreground">خط زمانی</h3>
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
              ? (statusLabels[event.status] ?? event.status)
              : null;

            return (
              <li
                className="relative grid gap-1 border-r-2 border-border py-3 pr-5 first:pt-1 last:border-transparent last:pb-1"
                key={`${event.type}-${event.timestampUtc}-${index}`}
              >
                <span className="absolute -right-[5px] top-4 h-2 w-2 rounded-full bg-primary" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-foreground">
                    {timelineLabels[event.type]}
                  </span>
                  <time className="text-xs font-semibold text-muted-foreground">
                    {formatDateTime(event.timestampUtc)}
                  </time>
                </div>
                {event.actor && (
                  <span className="text-xs font-semibold text-muted-foreground">
                    توسط {toPersianDigits(event.actor)}
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
                {(event.oldAmount !== null && event.oldAmount !== undefined) ||
                (event.newAmount !== null && event.newAmount !== undefined) ? (
                  <span className="text-xs font-semibold text-muted-foreground">
                    از{" "}
                    {toPersianDigits(
                      formatCurrency(event.oldAmount, { currencyLabel }),
                    )}{" "}
                    به{" "}
                    {toPersianDigits(
                      formatCurrency(event.newAmount, { currencyLabel }),
                    )}
                  </span>
                ) : null}
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

function ReservationPriceAdjustmentAlert({
  calculatedPrice,
  currencyLabel,
  currentAdjustment,
  onClose,
  onConfirm,
}: {
  calculatedPrice: number;
  currencyLabel: string;
  currentAdjustment: number;
  onClose: () => void;
  onConfirm: (amount: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState(
    currentAdjustment === 0 ? "" : currentAdjustment.toString(),
  );
  const [error, setError] = useState("");
  const [confirmationReady, setConfirmationReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const parsedAmount = Number(amount);
  const nextFinalAmount = calculatedPrice + parsedAmount;

  function continueAdjustment() {
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
      setError("یک مبلغ مثبت یا منفی وارد کنید.");
      return;
    }
    if (nextFinalAmount < 0) {
      setError("مبلغ نهایی رزرو نمی‌تواند منفی باشد.");
      return;
    }
    if (parsedAmount === currentAdjustment) {
      setError("مبلغ اصلاح دستی تغییری نکرده است.");
      return;
    }

    setError("");
    setConfirmationReady(true);
  }

  async function confirmAdjustment() {
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) return;
    setSubmitting(true);
    try {
      await onConfirm(parsedAmount);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KoochAlert
      title={confirmationReady ? "تایید اصلاح قیمت" : "اصلاح دستی قیمت"}
      variant="warning"
    >
      {confirmationReady ? (
        <div className="grid gap-3 pt-2">
          <p>
            قیمت محاسبه‌شده:{" "}
            {toPersianDigits(formatCurrency(calculatedPrice, { currencyLabel }))}
            <br />
            اصلاح دستی: {toPersianDigits(formatCurrency(parsedAmount, { currencyLabel }))}
            <br />
            مبلغ نهایی: {toPersianDigits(formatCurrency(nextFinalAmount, { currencyLabel }))}
          </p>
          <div className="flex flex-wrap gap-2">
            <KoochButton loading={submitting} onClick={confirmAdjustment}>
              تایید اصلاح قیمت
            </KoochButton>
            <KoochButton
              disabled={submitting}
              onClick={() => setConfirmationReady(false)}
              variant="outline"
            >
              بازگشت
            </KoochButton>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 pt-2">
          <KoochField
            error={error}
            helperText="برای افزایش مبلغ عدد مثبت و برای کاهش عدد منفی وارد کنید."
            label={`مبلغ اصلاح (${currencyLabel})`}
            required
          >
            <KoochInput
              error={error}
              onChange={(event) => {
                setAmount(event.target.value);
                setError("");
              }}
              step="any"
              type="number"
              value={amount}
            />
          </KoochField>
          <div className="flex flex-wrap gap-2">
            <KoochButton onClick={continueAdjustment}>ادامه</KoochButton>
            <KoochButton onClick={onClose} variant="outline">
              انصراف
            </KoochButton>
          </div>
        </div>
      )}
    </KoochAlert>
  );
}

function ReservationCancellationAlert({
  onClose,
  onConfirm,
  reservationNumber,
}: {
  onClose: () => void;
  onConfirm: (cancellation: ReservationCancellationPayload) => Promise<void>;
  reservationNumber: string;
}) {
  const [reason, setReason] = useState<ReservationCancellationReason | "">("");
  const [explanation, setExplanation] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [explanationError, setExplanationError] = useState("");
  const [confirmationReady, setConfirmationReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function continueCancellation() {
    const trimmedExplanation = explanation.trim();
    const nextReasonError = reason ? "" : "دلیل لغو را انتخاب کنید.";
    const nextExplanationError = trimmedExplanation
      ? ""
      : "توضیحات لغو را وارد کنید.";

    setReasonError(nextReasonError);
    setExplanationError(nextExplanationError);
    if (nextReasonError || nextExplanationError || !reason) return;

    setConfirmationReady(true);
  }

  async function confirmCancellation() {
    if (!reason || !explanation.trim()) return;
    setSubmitting(true);
    try {
      await onConfirm({ reason, explanation: explanation.trim() });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KoochAlert
      className="p-4"
      title={
        confirmationReady
          ? "تایید نهایی لغو رزرو"
          : `لغو رزرو ${reservationNumber}`
      }
      variant="destructive"
    >
      {confirmationReady ? (
        <div className="grid gap-3 pt-2">
          <p>پس از لغو، رزرو فقط قابل مشاهده خواهد بود.</p>
          <p>
            دلیل: {reason ? cancellationReasonLabels[reason] : "-"}
            <br />
            یادداشت: {explanation.trim() || "-"}
          </p>
          <div className="flex flex-wrap gap-2">
            <KoochButton
              loading={submitting}
              onClick={confirmCancellation}
              variant="destructive"
            >
              تایید و لغو رزرو
            </KoochButton>
            <KoochButton
              disabled={submitting}
              onClick={() => setConfirmationReady(false)}
              variant="outline"
            >
              بازگشت
            </KoochButton>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 pt-2">
          <KoochField error={reasonError} label="دلیل لغو" required>
            <KoochSelect
              error={reasonError}
              onChange={(event) => {
                const nextReason = event.target.value as
                  | ReservationCancellationReason
                  | "";
                setReason(nextReason);
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

          <KoochField error={explanationError} label="توضیحات لغو" required>
            <KoochTextarea
              error={explanationError}
              maxLength={2000}
              onChange={(event) => {
                setExplanation(event.target.value);
                setExplanationError("");
              }}
              placeholder="توضیحات دلیل لغو را وارد کنید."
              value={explanation}
            />
          </KoochField>

          <div className="flex flex-wrap gap-2">
            <KoochButton onClick={continueCancellation} variant="destructive">
              ادامه لغو رزرو
            </KoochButton>
            <KoochButton onClick={onClose} variant="outline">
              انصراف
            </KoochButton>
          </div>
        </div>
      )}
    </KoochAlert>
  );
}

function ManualPaymentCreateDialog({
  onOpenChange,
  onSubmit,
  open,
  reservation,
}: {
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: AdminManualPaymentCreatePayload) => Promise<void>;
  open: boolean;
  reservation: ReservationTableItem;
}) {
  const initialAmount = reservation.remainingAmount ?? reservation.finalAmount ?? reservation.totalPrice;
  const [amount, setAmount] = useState(initialAmount?.toString() ?? "");
  const [method, setMethod] = useState<ManualPaymentMethod>("BankTransfer");
  const [paymentDate, setPaymentDate] = useState<string | null>(localIsoToday());
  const [paymentTime, setPaymentTime] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [destinationBank, setDestinationBank] = useState("");
  const [destinationAccountReference, setDestinationAccountReference] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const currency = reservation.currency?.trim().toUpperCase() ?? "";

  useEffect(() => {
    if (!open) return;
    setAmount(initialAmount?.toString() ?? "");
    setMethod("BankTransfer");
    setPaymentDate(localIsoToday());
    setPaymentTime("");
    setReferenceNumber("");
    setDestinationBank("");
    setDestinationAccountReference("");
    setNotes("");
    setErrors({});
  }, [initialAmount, open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const numericAmount = Number(amount);
    const nextErrors: Record<string, string> = {};
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      nextErrors.amount = "مبلغ پرداخت باید بیشتر از صفر باشد.";
    }
    if (!currency) nextErrors.currency = "واحد پول رزرو در دسترس نیست.";
    if (!paymentDate) nextErrors.paymentDate = "تاریخ پرداخت را انتخاب کنید.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !paymentDate) return;

    setSubmitting(true);
    try {
      await onSubmit({
        amount: numericAmount,
        currency,
        method,
        paymentDate,
        paymentTime: paymentTime || null,
        referenceNumber: referenceNumber.trim() || null,
        destinationBank: destinationBank.trim() || null,
        destinationAccountReference: destinationAccountReference.trim() || null,
        notes: notes.trim() || null,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KoochDialog
      closeDisabled={submitting}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <KoochButton disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="outline">
            انصراف
          </KoochButton>
          <KoochButton form="manual-payment-form" loading={submitting} type="submit">
            ثبت پرداخت
          </KoochButton>
        </div>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="md"
      title="ثبت پرداخت دستی"
    >
      <form className="grid gap-4 md:grid-cols-2" id="manual-payment-form" onSubmit={submit}>
        <KoochField error={errors.amount} label="مبلغ" required>
          <KoochInput
            error={errors.amount}
            inputMode="decimal"
            min="0"
            onChange={(event) => {
              setAmount(event.target.value);
              setErrors((current) => ({ ...current, amount: "" }));
            }}
            step="0.01"
            type="number"
            value={amount}
          />
        </KoochField>
        <KoochField error={errors.currency} label="واحد پول" required>
          <KoochInput error={errors.currency} readOnly value={currency} />
        </KoochField>
        <KoochField label="روش پرداخت" required>
          <KoochSelect onChange={(event) => setMethod(event.target.value as ManualPaymentMethod)} value={method}>
            {manualPaymentMethodOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </KoochSelect>
        </KoochField>
        <KoochField error={errors.paymentDate} label="تاریخ پرداخت" required>
          <KoochDatePicker
            autoConfirmOnSelect
            label={null}
            mode="single"
            onChange={(value) => {
              setPaymentDate(value);
              setErrors((current) => ({ ...current, paymentDate: "" }));
            }}
            size="compact"
            value={paymentDate}
          />
        </KoochField>
        <KoochField label="ساعت پرداخت (اختیاری)">
          <KoochInput onChange={(event) => setPaymentTime(event.target.value)} type="time" value={paymentTime} />
        </KoochField>
        <KoochField label="شماره پیگیری">
          <KoochInput maxLength={200} onChange={(event) => setReferenceNumber(event.target.value)} value={referenceNumber} />
        </KoochField>
        <KoochField label="بانک مقصد">
          <KoochInput maxLength={100} onChange={(event) => setDestinationBank(event.target.value)} value={destinationBank} />
        </KoochField>
        <KoochField label="شناسه حساب مقصد">
          <KoochInput maxLength={200} onChange={(event) => setDestinationAccountReference(event.target.value)} value={destinationAccountReference} />
        </KoochField>
        <KoochField className="md:col-span-2" label="یادداشت">
          <KoochTextarea maxLength={2000} onChange={(event) => setNotes(event.target.value)} value={notes} />
        </KoochField>
      </form>
    </KoochDialog>
  );
}

function ManualPaymentRejectDialog({
  onOpenChange,
  onSubmit,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => Promise<void>;
  open: boolean;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setError("");
    }
  }, [open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const normalized = reason.trim();
    if (!normalized) {
      setError("دلیل رد پرداخت را وارد کنید.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(normalized);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KoochDialog
      closeDisabled={submitting}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <KoochButton disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="outline">انصراف</KoochButton>
          <KoochButton form="manual-payment-reject-form" loading={submitting} type="submit" variant="destructive">رد پرداخت</KoochButton>
        </div>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="sm"
      title="رد پرداخت دستی"
    >
      <form id="manual-payment-reject-form" onSubmit={submit}>
        <KoochField error={error} label="دلیل رد" required>
          <KoochTextarea
            error={error}
            maxLength={1000}
            onChange={(event) => {
              setReason(event.target.value);
              setError("");
            }}
            value={reason}
          />
        </KoochField>
      </form>
    </KoochDialog>
  );
}

export function ReservationDetailsDialog({
  loading = false,
  manualPayments = [],
  manualPaymentsLoading = false,
  onAdjustPrice,
  onApproveManualPayment,
  onCancel,
  onCreateManualPayment,
  onEdit,
  onRejectManualPayment,
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
  const roomName = reservation?.roomName ?? reservation?.roomTypeName ?? "-";
  const manualAdjustment = reservation?.manualAdjustment ?? 0;
  const calculatedPrice =
    reservation?.calculatedPrice ?? reservation?.totalPrice ?? 0;
  const totalAmount =
    reservation?.finalAmount ?? calculatedPrice + manualAdjustment;
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
  const isReadOnly =
    reservation !== null &&
    [
      "Cancelled",
      "Rejected",
      "PaymentExpired",
      "CapacityLost",
      "Completed",
    ].includes(reservation.status);
  const canAdjustPrice = !isReadOnly && Boolean(onAdjustPrice);
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
  const [priceAdjustmentOpen, setPriceAdjustmentOpen] = useState(false);
  const [confirmedEditWarningOpen, setConfirmedEditWarningOpen] =
    useState(false);
  const [manualPaymentCreateOpen, setManualPaymentCreateOpen] = useState(false);
  const [approvePaymentId, setApprovePaymentId] = useState<number | null>(null);
  const [rejectPaymentId, setRejectPaymentId] = useState<number | null>(null);
  const [manualPaymentMutationId, setManualPaymentMutationId] = useState<number | null>(null);
  const expiryRefreshStartedRef = useRef(false);
  const shouldShowPaymentCountdown =
    open && reservation?.status === "ApprovedAwaitingPayment";
  const remainingPaymentSeconds = useReservationPaymentCountdown(
    shouldShowPaymentCountdown,
    reservation?.paymentExpiresAtUtc,
    reservation?.remainingPaymentSeconds,
    reservation?.reservationId ?? reservation?.id,
  );
  const canSendPaymentLink =
    reservation !== null &&
    !isReadOnly &&
    reservation.status === "ApprovedAwaitingPayment" &&
    !reservation.isPaymentExpired &&
    isUnpaidReservation(reservation);

  useEffect(() => {
    if (open) {
      expiryRefreshStartedRef.current = false;
    }
  }, [
    open,
    reservation?.paymentExpiresAtUtc,
    reservation?.reservationId,
    reservation?.id,
  ]);

  useEffect(() => {
    if (!open) {
      setCancellationOpen(false);
      setPriceAdjustmentOpen(false);
      setManualPaymentCreateOpen(false);
      setApprovePaymentId(null);
      setRejectPaymentId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!shouldShowPaymentCountdown || remainingPaymentSeconds === null) {
      return;
    }

    if (remainingPaymentSeconds <= 0) {
      if (reservation && onRefresh && !expiryRefreshStartedRef.current) {
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
                    <KoochButton variant="outline">
                      ارسال لینک پرداخت
                    </KoochButton>
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
                    />
                  );
                })}
            {reservation && canCancel && !cancellationOpen && (
              <KoochButton
                onClick={() => setCancellationOpen(true)}
                variant="destructive"
              >
                لغو رزرو
              </KoochButton>
            )}
            <KoochButton
              onClick={() => {
                setCancellationOpen(false);
                setPriceAdjustmentOpen(false);
                onOpenChange(false);
              }}
              variant="outline"
            >
              بستن
            </KoochButton>
          </>
        }
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setCancellationOpen(false);
            setPriceAdjustmentOpen(false);
          }
          onOpenChange(nextOpen);
        }}
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

            {cancellationOpen && canCancel && (
              <ReservationCancellationAlert
                key={reservation.reservationNumber}
                onClose={() => setCancellationOpen(false)}
                onConfirm={async (cancellation) => {
                  if (onCancel) await onCancel(reservation, cancellation);
                }}
                reservationNumber={reservation.reservationNumber}
              />
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
                value={toPersianDigits(reservation.reservationNumber || "-")}
              />
              <DetailItem
                label="منبع"
                value={formatSource(reservation.source)}
              />
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
              <DetailItem
                label="موبایل"
                value={toPersianDigits(reservation.guestMobile ?? "-")}
              />
              <DetailItem label="ایمیل" value={guestEmail} />
              <DetailItem
                label="کد ملی / شماره پاسپورت"
                value={toPersianDigits(identityNumber)}
              />
              <DetailItem
                label="ملیت"
                value={reservation.guestNationality ?? "-"}
              />
            </DetailSection>

            <DetailSection title="اقامت">
              <DetailItem
                label="اقامتگاه"
                value={toPersianDigits(reservation.propertyName ?? "-")}
              />
              <DetailItem label="نوع اتاق" value={toPersianDigits(roomName)} />
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

            <DetailSection
              action={
                canAdjustPrice && !priceAdjustmentOpen ? (
                  <KoochButton
                    onClick={() => setPriceAdjustmentOpen(true)}
                    size="sm"
                    variant="outline"
                  >
                    اصلاح قیمت
                  </KoochButton>
                ) : null
              }
              footer={
                priceAdjustmentOpen && canAdjustPrice && reservation ? (
                  <ReservationPriceAdjustmentAlert
                    calculatedPrice={calculatedPrice}
                    currencyLabel={currencyLabel}
                    currentAdjustment={manualAdjustment}
                    key={`${reservation.reservationId ?? reservation.id}-${manualAdjustment}`}
                    onClose={() => setPriceAdjustmentOpen(false)}
                    onConfirm={async (amount) => {
                      if (onAdjustPrice)
                        await onAdjustPrice(reservation, amount);
                    }}
                  />
                ) : null
              }
              title="مالی"
            >
              <DetailItem
                label="قیمت پایه"
                value={toPersianDigits(formatCurrency(baseAmount, { currencyLabel }))}
              />
              <DetailItem
                label="هزینه کودک"
                value={toPersianDigits(formatCurrency(childAmount, { currencyLabel }))}
              />
              <DetailItem
                label="هزینه نفر اضافه"
                value={toPersianDigits(formatCurrency(extraGuestAmount, { currencyLabel }))}
              />
              <DetailItem
                label="تخفیف پروموشن"
                value={toPersianDigits(formatCurrency(promotionDiscount, { currencyLabel }))}
              />
              <DetailItem
                label="تخفیف کوپن"
                value={toPersianDigits(formatCurrency(couponDiscount, { currencyLabel }))}
              />
              <DetailItem
                label="هزینه خدمات"
                value={toPersianDigits(formatCurrency(reservation.serviceFeeAmount, {
                  currencyLabel,
                }))}
              />
              <DetailItem
                label="مالیات"
                value={toPersianDigits(formatCurrency(reservation.taxAmount, { currencyLabel }))}
              />
              <DetailItem
                label="قیمت محاسبه‌شده"
                value={toPersianDigits(formatCurrency(calculatedPrice, { currencyLabel }))}
              />
              <DetailItem
                label="اصلاح دستی"
                value={toPersianDigits(formatCurrency(manualAdjustment, { currencyLabel }))}
              />
              <DetailItem
                label="مبلغ نهایی"
                value={toPersianDigits(formatCurrency(totalAmount, { currencyLabel }))}
              />
              <DetailItem
                label="مبلغ قابل پرداخت"
                value={toPersianDigits(formatCurrency(reservation.payableAmount, {
                  currencyLabel,
                }))}
              />
              <DetailItem
                label="مبلغ پرداخت‌شده"
                value={toPersianDigits(formatCurrency(paidAmount, { currencyLabel }))}
              />
              <DetailItem
                label="باقی‌مانده"
                value={toPersianDigits(formatCurrency(reservation.remainingAmount, {
                  currencyLabel,
                }))}
              />
              <DetailItem label="واحد پول" value={currencyLabel} />
            </DetailSection>

            {(onCreateManualPayment || manualPayments.length > 0 || manualPaymentsLoading) && (
              <KoochCard className="grid gap-3" padding="sm" variant="elevated">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-foreground">پرداخت‌های دستی</h3>
                  {onCreateManualPayment &&
                    reservation.status === "ApprovedAwaitingPayment" &&
                    !reservation.isPaymentExpired && (
                      <KoochButton onClick={() => setManualPaymentCreateOpen(true)} size="sm" variant="outline">
                        ثبت پرداخت دستی
                      </KoochButton>
                    )}
                </div>
                {manualPaymentsLoading ? (
                  <p className="text-sm font-semibold text-muted-foreground">در حال دریافت پرداخت‌ها...</p>
                ) : manualPayments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">پرداخت دستی برای این رزرو ثبت نشده است.</p>
                ) : (
                  <div className="grid gap-3">
                    {manualPayments.map((payment) => {
                      const isPending = payment.verificationStatus === "PendingVerification";
                      const actor = payment.submittedBy ??
                        (payment.submittedByUserId ? `کاربر ${toPersianDigits(payment.submittedByUserId)}` : "-");
                      return (
                        <article className="grid gap-3 rounded-lg border border-border bg-background p-3" key={payment.paymentId}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-sm text-foreground">
                                {toPersianDigits(formatCurrency(payment.amount, { currencyLabel }))}
                              </strong>
                              <span className="text-xs font-semibold text-muted-foreground">{payment.currency}</span>
                            </div>
                            <KoochBadge
                              variant={
                                payment.verificationStatus === "Approved"
                                  ? "success"
                                  : payment.verificationStatus === "Rejected"
                                    ? "destructive"
                                    : "warning"
                              }
                            >
                              {manualPaymentVerificationLabels[payment.verificationStatus]}
                            </KoochBadge>
                          </div>
                          <dl className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
                            <DetailItem label="روش پرداخت" value={manualPaymentMethodLabels[payment.method]} />
                            <DetailItem label="وضعیت پرداخت" value={manualPaymentStatusLabels[payment.status]} />
                            <DetailItem label="تاریخ پرداخت" value={`${formatDate(payment.paymentDate)}${payment.paymentTime ? ` - ${toPersianDigits(payment.paymentTime.slice(0, 5))}` : ""}`} />
                            <DetailItem label="شماره پیگیری" value={payment.referenceNumber ?? "-"} />
                            <DetailItem label="بانک مقصد" value={payment.destinationBank ?? "-"} />
                            <DetailItem label="شناسه حساب مقصد" value={payment.destinationAccountReference ?? "-"} />
                            <DetailItem label="ثبت‌کننده" value={`${actor} - ${formatDateTime(payment.submittedAtUtc)}`} />
                            {payment.verifiedAtUtc && (
                              <DetailItem label="تأییدکننده" value={`${payment.verifiedBy ?? "-"} - ${formatDateTime(payment.verifiedAtUtc)}`} />
                            )}
                            {payment.rejectedAtUtc && (
                              <DetailItem label="ردکننده" value={`${payment.rejectedBy ?? "-"} - ${formatDateTime(payment.rejectedAtUtc)}`} />
                            )}
                            <DetailItem label="یادداشت" value={payment.notes ?? "-"} />
                            {payment.rejectionReason && (
                              <DetailItem label="دلیل رد" value={payment.rejectionReason} />
                            )}
                          </dl>
                          {isPending && (onApproveManualPayment || onRejectManualPayment) && (
                            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                              {onApproveManualPayment && (
                                <KoochButton
                                  disabled={manualPaymentMutationId !== null}
                                  onClick={() => setApprovePaymentId(payment.paymentId)}
                                  size="sm"
                                >
                                  تأیید پرداخت
                                </KoochButton>
                              )}
                              {onRejectManualPayment && (
                                <KoochButton
                                  disabled={manualPaymentMutationId !== null}
                                  onClick={() => setRejectPaymentId(payment.paymentId)}
                                  size="sm"
                                  variant="destructive"
                                >
                                  رد پرداخت
                                </KoochButton>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </KoochCard>
            )}

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
              <DetailItem
                label="توضیحات رزرو"
                value={reservation.notes ?? "-"}
              />
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
          description="این رزرو تایید شده است. تغییر اطلاعات ممکن است روی قیمت و ظرفیت اثر بگذارد."
          onConfirm={() => onEdit(reservation)}
          onOpenChange={setConfirmedEditWarningOpen}
          open={confirmedEditWarningOpen}
          title="ویرایش رزرو تاییدشده"
          variant="warning"
        />
      )}
      {reservation && onCreateManualPayment && (
        <ManualPaymentCreateDialog
          onOpenChange={setManualPaymentCreateOpen}
          onSubmit={async (payload) => {
            await onCreateManualPayment(reservation, payload);
          }}
          open={manualPaymentCreateOpen}
          reservation={reservation}
        />
      )}
      {approvePaymentId !== null && onApproveManualPayment && (
        <KoochConfirmDialog
          cancelText="انصراف"
          confirmText="تأیید پرداخت"
          description="با تأیید، پرداخت موفق ثبت می‌شود، شناسایی مالی انجام می‌گیرد و در صورت وجود ظرفیت، رزرو تأیید خواهد شد. اگر ظرفیت دیگر موجود نباشد، وضعیت دقیق رزرو پس از بررسی سامانه نمایش داده می‌شود."
          loading={manualPaymentMutationId === approvePaymentId}
          onConfirm={async () => {
            setManualPaymentMutationId(approvePaymentId);
            try {
              await onApproveManualPayment(approvePaymentId);
              setApprovePaymentId(null);
            } finally {
              setManualPaymentMutationId(null);
            }
          }}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && manualPaymentMutationId === null) setApprovePaymentId(null);
          }}
          open
          title="تأیید پرداخت دستی"
          variant="warning"
        />
      )}
      {rejectPaymentId !== null && onRejectManualPayment && (
        <ManualPaymentRejectDialog
          onOpenChange={(nextOpen) => {
            if (!nextOpen && manualPaymentMutationId === null) setRejectPaymentId(null);
          }}
          onSubmit={async (reason) => {
            setManualPaymentMutationId(rejectPaymentId);
            try {
              await onRejectManualPayment(rejectPaymentId, reason);
              setRejectPaymentId(null);
            } finally {
              setManualPaymentMutationId(null);
            }
          }}
          open
        />
      )}
    </>
  );
}
