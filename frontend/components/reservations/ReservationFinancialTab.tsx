import type { ReactNode } from "react";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochCard } from "@/components/KoochCard";
import { formatCurrency } from "@/lib/currency";
import { toPersianDigits } from "@/lib/persian-digits";
import type { ReservationCancellationFinancialState, ReservationTableItem } from "./ReservationTable";
import type { AdminManualPayment } from "./ReservationDetailsDialog";
import styles from "./ReservationFinancialTab.module.css";

function money(amount: number | null | undefined, currencyLabel: string) {
  return amount == null ? <span className={styles.unknown}>نامشخص</span>
    : toPersianDigits(formatCurrency(amount, { currencyLabel }));
}

export function cancellationCashStatus(financial: ReservationCancellationFinancialState | null | undefined) {
  if (financial?.refundPending === true) return "بازپرداخت نقدی در انتظار انجام";
  if (financial?.alreadyHandledByLegacyRefundV1) return "بازپرداخت نقدی قبلاً ثبت شده است.";
  if (financial?.cashRefundExecutedAmount != null && financial.cashRefundExecutedAmount > 0) return "بازپرداخت نقدی ثبت شده است.";
  if (financial?.guestRefundAmount === 0) return "بازپرداخت نقدی لازم نیست.";
  return "وضعیت اجرای بازپرداخت در دسترس نیست.";
}

export function ReservationFinancialSummary({ reservation, currencyLabel, collectible, refundAction }: {
  reservation: ReservationTableItem; currencyLabel: string; collectible: boolean; refundAction: ReactNode;
}) {
  const cancelled = reservation.status === "Cancelled";
  const financial = reservation.cancellationFinancial;
  const refundCurrency = financial?.currency === "IRR" ? "ریال" : financial?.currency || currencyLabel;
  const pending = cancelled && financial?.refundPending === true;
  return <KoochCard padding="sm" className={styles.summary} aria-label="خلاصه مالی این رزرو">
    <h3>خلاصه مالی این رزرو</h3>
    <dl className={styles.amounts}>
      {!cancelled && <div><dt>مبلغ این رزرو</dt><dd>{money(reservation.finalAmount ?? reservation.totalPrice, currencyLabel)}</dd></div>}
      <div><dt>{cancelled ? "وجه دریافت‌شده (سابقه)" : "وجه دریافت‌شده"}</dt>
        <dd>{money(cancelled ? financial?.grossPaidAmount ?? reservation.paidAmount : reservation.paidAmount,
          cancelled ? refundCurrency : currencyLabel)}</dd></div>
      {!cancelled && <div><dt>{collectible ? "ماندهٔ قابل وصول" : "ماندهٔ ثبت‌شده"}</dt>
        <dd>{money(reservation.remainingAmount, currencyLabel)}</dd></div>}
      {cancelled && financial?.cashRefundExecutedAmount != null && <div><dt>بازپرداخت نقدی انجام‌شده</dt>
        <dd>{money(financial.cashRefundExecutedAmount, refundCurrency)}</dd></div>}
      {cancelled && financial?.mode === "ManualFundingV2" && financial.guestWalletRestoreAmount != null &&
        <div><dt>بازگردانی به منابع اصلی کیف پول</dt><dd>{money(financial.guestWalletRestoreAmount, refundCurrency)}</dd></div>}
    </dl>
    {cancelled && <div className={styles.refundStatus}>
      <div>
        <p className={styles.statusLabel}>{cancellationCashStatus(financial)}</p>
        {pending && <p>{money(financial?.cashRefundPendingAmount, refundCurrency)}</p>}
      </div>
      {pending && refundAction}
    </div>}
    {cancelled && <p className={styles.caption}>این مبالغ سوابق مالی رزرو لغوشده‌اند؛ ماندهٔ تاریخی قابل وصول نیست. تخصیص بازپرداخت به معنی اجرای آن نیست.</p>}
  </KoochCard>;
}

export function ReservationFinancialDetails({ children }: { children: ReactNode }) {
  return <details className={styles.breakdown}>
    <summary>ریز محاسبات رزرو و لغو</summary>
    <div className={styles.breakdownBody}>{children}</div>
  </details>;
}

export function ReservationPricingBreakdown({ reservation, currencyLabel, action, editor }: {
  reservation: ReservationTableItem; currencyLabel: string; action: ReactNode; editor: ReactNode;
}) {
  const amounts: Array<[string, number | null | undefined]> = [
    ["قیمت پایه", reservation.baseAmount ?? reservation.basePrice],
    ["هزینه کودک", reservation.childAmount ?? reservation.childCharge],
    ["هزینه نفر اضافه", reservation.extraGuestAmount ?? reservation.extraGuestCharge],
    ["تخفیف پروموشن", reservation.discountAmount ?? reservation.promotionDiscount],
    ["تخفیف کوپن", reservation.couponDiscountAmount],
    ["هزینه خدمات", reservation.serviceFeeAmount], ["مالیات", reservation.taxAmount],
    ["قیمت محاسبه‌شده", reservation.calculatedPrice ?? reservation.totalPrice],
    ["اصلاح دستی", reservation.manualAdjustment],
    ["مبلغ نهایی رزرو", reservation.finalAmount ?? reservation.totalPrice],
    [reservation.status === "Cancelled" ? "مبلغ قابل پرداخت (سابقه)" : "مبلغ قابل پرداخت ثبت‌شده", reservation.payableAmount],
    ...(reservation.status === "Cancelled" ? [["ماندهٔ ثبت‌شده (سابقه)", reservation.remainingAmount] as [string, number | null | undefined]] : []),
  ];
  return <section aria-label="محاسبات این رزرو" className={styles.calculations}>
    <div className={styles.sectionHeading}><h3>محاسبات این رزرو</h3>{action}</div>
    <dl className={styles.calculationValues}>{amounts.map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{money(value, currencyLabel)}</dd></div>)}</dl>
    {editor}
  </section>;
}

export function ReservationPaymentRow({ payment, methodLabel, statusLabel, verificationLabel, dateLabel, metadata, actions, deadlineLabel }: {
  payment: AdminManualPayment; methodLabel: string; statusLabel: string; verificationLabel: string;
  dateLabel: string; metadata: Array<[string, string | null | undefined]>; actions: ReactNode; deadlineLabel?: string;
}) {
  const currencyLabel = payment.currency === "IRR" ? "ریال" : payment.currency || "واحد نامشخص";
  const pendingReview = payment.verificationStatus === "PendingVerification";
  return <article className={styles.paymentRow} data-review-pending={pendingReview || undefined} aria-label={`پرداخت ${toPersianDigits(payment.paymentId)}`}>
    <div className={styles.paymentTop}>
      <strong>{money(payment.amount, currencyLabel)}</strong>
      <span>{methodLabel}</span><span>{dateLabel}</span>
      <KoochBadge variant={pendingReview ? "default" : payment.status === "Successful" ? "success" : payment.status === "Failed" ? "destructive" : "muted"}>
        <span className="sr-only">{pendingReview ? "وضعیت بررسی: " : "وضعیت تراکنش: "}</span>{pendingReview ? verificationLabel : statusLabel}
      </KoochBadge>
      {payment.referenceNumber?.trim() && <span>شماره پیگیری: <bdi>{payment.referenceNumber}</bdi></span>}
      {deadlineLabel && <span>مهلت اصلی پرداخت: {deadlineLabel}</span>}
    </div>
    {actions && <div className={styles.paymentActions} role="group" aria-label={`بررسی پرداخت ${toPersianDigits(payment.paymentId)}`}>{actions}</div>}
    <details className={styles.paymentDetails}>
      <summary>جزئیات پرداخت</summary>
      <dl className={styles.paymentMetadata}>
        <div><dt>وضعیت تراکنش</dt><dd>{statusLabel}</dd></div>
        <div><dt>وضعیت بررسی</dt><dd>{verificationLabel}</dd></div>
        {metadata.filter(([, value]) => value?.trim()).map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </details>
  </article>;
}
