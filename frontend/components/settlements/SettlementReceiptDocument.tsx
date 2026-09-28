"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { KoochButton } from "@/components/KoochButton";
import { formatDate, formatDateTime, formatNumber } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import type { AdminSettlementReceipt, PropertySettlementReceipt } from "@/lib/settlement-receipt";
import { VoucherField } from "@/components/reservations/vouchers/VoucherDocument";
import styles from "@/components/reservations/vouchers/VoucherDocument.module.css";

const paymentLabels = {
  BankTransfer: "انتقال بانکی",
  CardToCard: "کارت به کارت",
  Other: "سایر",
};

export function SettlementReceiptDocument({ receipt, admin = false }: {
  receipt: PropertySettlementReceipt | AdminSettlementReceipt;
  admin?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const amount = (value: number) => formatCurrency(value, { currencyLabel: receipt.currency });
  const adminReceipt = admin ? receipt as AdminSettlementReceipt : null;
  const document = (
    <article aria-label="رسید تسویه" className={`${styles.document} rounded-lg border border-border bg-card text-foreground`} dir="rtl">
      <header className={styles.header}>
        <div className={styles.brand}>
          <p className={styles.wordmark}>کوچ</p>
          <p>سامانه رزرو و مدیریت اقامتگاه</p>
        </div>
        <dl className={styles.metadata}>
          <VoucherField label="شماره تسویه"><bdi dir="ltr">{receipt.settlementNumber}</bdi></VoucherField>
          <VoucherField label="وضعیت">پرداخت‌شده</VoucherField>
        </dl>
      </header>
      <div className={styles.intro}>
        <div className={styles.titleRow}><h2>رسید تسویه</h2></div>
        <p>پرداخت تسویه این اقامتگاه ثبت شده است. اقلام و اطلاعات پرداخت در ادامه آمده‌اند.</p>
      </div>
      <section className={styles.section}>
        <h3>اطلاعات پرداخت</h3>
        <dl className={styles.identityFields}>
          <VoucherField label="اقامتگاه">{receipt.propertyName}</VoucherField>
          <VoucherField label="مبلغ تسویه">{amount(receipt.totalAmount)}</VoucherField>
          <VoucherField label="زمان پرداخت"><time dateTime={receipt.paidAtUtc}>{formatDateTime(receipt.paidAtUtc)}</time></VoucherField>
          <VoucherField label="روش پرداخت">{paymentLabels[receipt.paymentMethod]}</VoucherField>
          <VoucherField label="شماره پیگیری / مرجع"><bdi dir="ltr">{receipt.referenceNumber}</bdi></VoucherField>
        </dl>
      </section>
      <section className={`${styles.section} ${styles.receiptItems}`}>
        <h3>اقلام تسویه</h3>
        <div className="overflow-x-auto">
          <table className={styles.receiptTable}>
            <thead><tr><th scope="col">شماره رزرو</th><th scope="col">تاریخ سررسید</th><th scope="col">مبلغ</th></tr></thead>
            <tbody>{receipt.items.map((item, index) => <tr key={`${item.reservationNumber}-${index}`}>
              <td><bdi dir="ltr">{item.reservationNumber}</bdi></td>
              <td>{formatDate(item.payableDueDate)}</td>
              <td>{amount(item.amount)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <dl className={styles.financialFields}>
          <VoucherField label="تعداد اقلام">{formatNumber(receipt.itemCount)}</VoucherField>
          <VoucherField label="مبلغ کل" prominent>{amount(receipt.totalAmount)}</VoucherField>
        </dl>
      </section>
      {adminReceipt && <section className={styles.section}>
        <h3>اطلاعات ثبت در سامانه</h3>
        <dl className={styles.identityFields}>
          <VoucherField label="زمان ثبت در سیستم"><time dateTime={adminReceipt.recordedAtUtc}>{formatDateTime(adminReceipt.recordedAtUtc)}</time></VoucherField>
          {adminReceipt.note && <VoucherField label="توضیحات">{adminReceipt.note}</VoucherField>}
        </dl>
      </section>}
      <footer className={styles.footer}>
        <p>این سند، پرداخت تسویه ثبت‌شده در سامانه کوچ را نمایش می‌دهد و رسید صادرشده توسط بانک نیست.</p>
        <p>تسویه <bdi dir="ltr">{receipt.settlementNumber}</bdi></p>
      </footer>
    </article>
  );
  return <>
    <div className="flex justify-end"><KoochButton variant="outline" onClick={() => window.print()}>چاپ رسید</KoochButton></div>
    {document}
    {mounted && createPortal(<div data-settlement-receipt-print="" aria-hidden="true" className={styles.printCopy}>{document}</div>, window.document.body)}
  </>;
}
