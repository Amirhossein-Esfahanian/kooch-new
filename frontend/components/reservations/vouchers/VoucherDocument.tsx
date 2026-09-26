"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { KoochButton } from "@/components/KoochButton";
import { formatDate, formatDateTime, formatNumber } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import styles from "./VoucherDocument.module.css";

interface VoucherStay {
  voucherNumber: string;
  reservationNumber: string;
  issuedAtUtc: string;
  propertyName: string;
  guestName: string;
  roomTypeName: string;
  roomName: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  adultCount: number;
  childCount: number;
}

export function voucherMoney(value: number, currency: string) {
  return formatCurrency(value, { currencyLabel: currency === "IRR" ? "ریال" : currency });
}

export function VoucherField({ label, children, prominent = false }: {
  label: string;
  children: ReactNode;
  prominent?: boolean;
}) {
  return (
    <div className={`min-w-0 break-words ${prominent ? "col-span-full border-t border-border pt-4" : ""}`}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`mt-1 leading-7 text-foreground ${prominent ? "text-xl font-bold" : "font-semibold"}`}>{children}</dd>
    </div>
  );
}

export function VoucherDocument({ voucher, children }: { voucher: VoucherStay; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const document = (
    <article aria-label="سند ووچر رزرو" className={`${styles.document} rounded-lg border border-border bg-card p-5 text-foreground sm:p-8`} dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-border pb-5">
        <div>
          <p className="text-lg font-bold">Kooch · کوچ</p>
          <h2 className="mt-2 text-2xl font-bold">ووچر رزرو</h2>
        </div>
        <dl className="grid gap-3">
          <VoucherField label="شماره ووچر"><bdi>{voucher.voucherNumber}</bdi></VoucherField>
          <VoucherField label="شماره رزرو"><bdi>{voucher.reservationNumber}</bdi></VoucherField>
        </dl>
      </header>
      <div className="grid gap-6 py-6 sm:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">اقامتگاه</h3>
          <p className="break-words text-lg font-bold">{voucher.propertyName}</p>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">اطلاعات مهمان</h3>
          <p className="break-words text-lg font-semibold">{voucher.guestName}</p>
        </section>
      </div>
      <section className="border-t border-border py-5">
        <h3 className="mb-4 font-bold">اطلاعات اقامت</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <VoucherField label="نوع اتاق">{voucher.roomTypeName}</VoucherField>
          {voucher.roomName && <VoucherField label="اتاق">{voucher.roomName}</VoucherField>}
          <VoucherField label="تاریخ ورود">{formatDate(voucher.checkIn)}</VoucherField>
          <VoucherField label="تاریخ خروج">{formatDate(voucher.checkOut)}</VoucherField>
          <VoucherField label="تعداد شب">{formatNumber(voucher.nights)}</VoucherField>
          <VoucherField label="بزرگسال">{formatNumber(voucher.adultCount)}</VoucherField>
          <VoucherField label="کودک">{formatNumber(voucher.childCount)}</VoucherField>
        </dl>
      </section>
      <section className="border-t border-border py-5">
        <h3 className="mb-4 font-bold">اطلاعات مالی</h3>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</dl>
      </section>
      <footer className="grid gap-2 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
        <p>این سند، اطلاعات رزرو در زمان صدور ووچر را نمایش می‌دهد.</p>
        <p>تاریخ صدور: <time dateTime={voucher.issuedAtUtc}>{formatDateTime(voucher.issuedAtUtc)}</time></p>
      </footer>
    </article>
  );

  return (
    <>
      <div className="flex justify-end">
        <KoochButton onClick={() => window.print()} className="min-h-11" variant="outline">چاپ ووچر</KoochButton>
      </div>
      {document}
      {mounted && createPortal(
        <div data-voucher-print="" aria-hidden="true" className={styles.printCopy}>{document}</div>,
        window.document.body,
      )}
    </>
  );
}
