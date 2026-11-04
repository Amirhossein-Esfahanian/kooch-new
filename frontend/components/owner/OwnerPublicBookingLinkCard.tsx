"use client";

import { useState } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochField, KoochInput } from "@/components/KoochFormControls";
import type { PropertyResponse } from "@/lib/owner-api";
import { publicBookingUrl, publicFrontendOrigin } from "@/lib/public-booking-url";

export function OwnerPublicBookingLinkCard({ property, canViewProperty, loading = false }: {
  property?: Pick<PropertyResponse, "id" | "slug" | "status">;
  canViewProperty: boolean;
  loading?: boolean;
}) {
  const [copying, setCopying] = useState(false);
  const [feedback, setFeedback] = useState<{ url: string; failed: boolean; message: string } | null>(null);
  const origin = publicFrontendOrigin(process.env.NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN);
  const url = canViewProperty && property?.status === "Approved" && Number.isInteger(property.id) && property.id > 0
    ? publicBookingUrl(property.slug) : null;
  const unavailable = !canViewProperty ? "دسترسی به اطلاعات این اقامتگاه ندارید."
    : !property || !Number.isInteger(property.id) || property.id <= 0 ? "اطلاعات معتبر اقامتگاه در دسترس نیست."
      : property.status !== "Approved" ? "لینک رزرو عمومی فقط برای اقامتگاه تأییدشده و قابل نمایش عمومی فعال است."
        : !origin ? "نشانی عمومی سایت تنظیم نشده یا معتبر نیست؛ برای فعال شدن اشتراک‌گذاری با مدیر سامانه تماس بگیرید."
          : "شناسهٔ متنی اقامتگاه معتبر نیست؛ لینک رزرو عمومی در دسترس نیست.";

  async function copyLink() {
    if (!url || copying) return;
    setCopying(true);
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(url);
      setFeedback({ url, failed: false, message: "لینک رزرو عمومی کپی شد." });
    } catch {
      setFeedback({ url, failed: true, message: "کپی لینک انجام نشد؛ نشانی بالا را انتخاب و دستی کپی کنید." });
    } finally {
      setCopying(false);
    }
  }

  return (
    <KoochCard aria-labelledby="owner-public-booking-link-title" className="grid min-w-0 gap-3" dir="rtl">
      <h2 className="text-sm font-semibold text-foreground" id="owner-public-booking-link-title">لینک رزرو عمومی</h2>
      {loading && canViewProperty ? <p className="text-sm text-muted-foreground" role="status">در حال دریافت وضعیت لینک رزرو…</p>
        : url ? (
          <>
            <p className="text-sm leading-6 text-muted-foreground">این صفحه عمومی است؛ لینک را با مسافران به اشتراک بگذارید. امکان رزرو به تاریخ و موجودی بستگی دارد.</p>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
              <KoochField className="min-w-0 flex-1" label="نشانی صفحه رزرو عمومی">
                <KoochInput className="min-w-0 text-left" dir="ltr" readOnly selectOnFocus value={url} />
              </KoochField>
              <div className="flex flex-wrap gap-2">
                <KoochButton loading={copying} onClick={() => void copyLink()} variant="outline">کپی لینک</KoochButton>
                <KoochButton aria-label="باز کردن صفحه رزرو (در زبانه جدید)" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
                  باز کردن صفحه رزرو
                </KoochButton>
              </div>
            </div>
            <p className="text-sm text-foreground" role={feedback?.url === url && feedback.failed ? "alert" : "status"}>
              {feedback?.url === url ? feedback.message : ""}
            </p>
          </>
        ) : <p className="text-sm leading-6 text-muted-foreground" role="status">{unavailable}</p>}
    </KoochCard>
  );
}
