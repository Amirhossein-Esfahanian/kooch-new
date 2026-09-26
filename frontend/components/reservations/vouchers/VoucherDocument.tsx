"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { KoochButton } from "@/components/KoochButton";
import { formatDate, formatDateTime, formatNumber } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import { fetchPublicSiteSettings, settingValue } from "@/lib/site-settings";
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
    <div className={`${styles.field} ${prominent ? styles.prominent : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function VoucherDocument({ voucher, children, audience = "guest" }: {
  voucher: VoucherStay;
  children: ReactNode;
  audience?: "guest" | "financial";
}) {
  const [mounted, setMounted] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    let active = true;
    void fetchPublicSiteSettings().then(settings => {
      if (active) setLogoUrl(settingValue(settings, "site.logoUrl"));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const identifiers = (
    <p className={styles.identifiers}>
      <span>ووچر <bdi dir="ltr">{voucher.voucherNumber}</bdi></span>
      <span>رزرو <bdi dir="ltr">{voucher.reservationNumber}</bdi></span>
    </p>
  );

  const document = (
    <article aria-label="سند ووچر رزرو" className={`${styles.document} rounded-lg border border-border bg-card text-foreground`} dir="rtl">
      <header className={styles.header}>
        <div className={styles.brand}>
          {logoUrl ? <img src={logoUrl} alt="کوچ" className={styles.logo} onError={() => setLogoUrl("")} /> : <p className={styles.wordmark}>کوچ</p>}
          <p>سامانه رزرو و مدیریت اقامتگاه</p>
        </div>
        <dl className={styles.metadata}>
          <VoucherField label="شماره ووچر"><bdi dir="ltr">{voucher.voucherNumber}</bdi></VoucherField>
          <VoucherField label="شماره رزرو"><bdi dir="ltr">{voucher.reservationNumber}</bdi></VoucherField>
          <VoucherField label="تاریخ صدور"><time dateTime={voucher.issuedAtUtc}>{formatDateTime(voucher.issuedAtUtc)}</time></VoucherField>
        </dl>
      </header>
      <div className={styles.intro}>
        <div className={styles.titleRow}>
          <h2>{audience === "financial" ? "تأییدیه رزرو اقامتگاه" : "ووچر تأیید رزرو"}</h2>
          <span className={styles.status}>رزرو قطعی</span>
        </div>
        <p>{audience === "financial"
          ? "رزرو زیر پس از تأیید دریافت وجه قطعی شده است. لطفاً پذیرش مهمان را مطابق اطلاعات و بازه اقامت درج‌شده انجام دهید."
          : `${voucher.guestName} عزیز، رزرو شما در ${voucher.propertyName} با موفقیت قطعی شد. در زمان مراجعه به اقامتگاه، این ووچر را در دسترس داشته باشید.`}</p>
      </div>
      <section className={styles.section}>
        <h3>اطلاعات اقامتگاه و مهمان</h3>
        <dl className={styles.identityFields}>
          <VoucherField label="اقامتگاه">{voucher.propertyName}</VoucherField>
          <VoucherField label="مهمان اصلی">{voucher.guestName}</VoucherField>
        </dl>
      </section>
      <section className={styles.section}>
        <h3>اطلاعات اقامت</h3>
        <dl className={styles.dateFields}>
          <VoucherField label="تاریخ ورود">{formatDate(voucher.checkIn)}</VoucherField>
          <VoucherField label="تاریخ خروج">{formatDate(voucher.checkOut)}</VoucherField>
          <VoucherField label="تعداد شب">{formatNumber(voucher.nights)} شب</VoucherField>
        </dl>
        <dl className={styles.roomFields}>
          <VoucherField label="نوع اتاق">{voucher.roomTypeName}</VoucherField>
          {voucher.roomName && <VoucherField label="اتاق">{voucher.roomName}</VoucherField>}
          <VoucherField label="بزرگسال">{formatNumber(voucher.adultCount)}</VoucherField>
          <VoucherField label="کودک">{formatNumber(voucher.childCount)}</VoucherField>
        </dl>
      </section>
      <section className={styles.section}>
        <h3>{audience === "financial" ? "خلاصه مالی رزرو" : "اطلاعات مالی"}</h3>
        <dl className={styles.financialFields}>{children}</dl>
      </section>
      {audience === "guest" && <section className={styles.section}>
        <h3>یادآوری</h3>
        <ul className={styles.reminders}>
          <li>این ووچر تأییدکننده رزرو قطعی شماست؛ تاریخ ورود، خروج و مشخصات اتاق را پیش از مراجعه بررسی کنید.</li>
          <li>در صورت تغییر یا لغو رزرو، وضعیت جدید رزرو در حساب کاربری شما ملاک خواهد بود.</li>
        </ul>
      </section>}
      <footer className={styles.footer}>
        <p className="font-semibold text-foreground">کوچ · سامانه رزرو و مدیریت اقامتگاه</p>
        {audience === "financial" && <p>مبلغ قابل تسویه، بیانگر سهم اقامتگاه از این رزرو است و به معنی انجام یا تأیید انتقال بانکی نیست.</p>}
        {identifiers}
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
