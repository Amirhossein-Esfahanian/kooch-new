"use client";

import { useEffect, useState } from "react";
import { bookingSupportPhone, fetchPublicSiteSettings } from "@/lib/site-settings";
import { toPersianDigits } from "@/lib/persian-digits";

export function useBookingSupportPhone() {
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void fetchPublicSiteSettings()
      .then((settings) => {
        if (active) setPhone(bookingSupportPhone(settings));
      })
      .catch(() => { if (active) setPhone(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return { phone, loading };
}

export function BookingSupportContact({ phone, loading = false }: {
  phone: string | null;
  loading?: boolean;
}) {
  if (loading) return <p role="status">در حال دریافت شماره پشتیبانی کوچ...</p>;
  if (!phone) return (
    <p>شماره تماس پشتیبانی کوچ فعلاً در دسترس نیست. ثبت هماهنگی تا فراهم‌شدن شماره پشتیبانی امکان‌پذیر نیست.</p>
  );
  return (
    <a
      className="inline-flex min-h-11 flex-wrap items-center gap-2 rounded-md font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={`tel:${phone.replace(/[\s().-]/g, "")}`}
    >
      تماس با پشتیبانی کوچ
      <bdi dir="ltr">{toPersianDigits(phone)}</bdi>
    </a>
  );
}
