"use client";

import { useEffect, useRef, useState } from "react";
import { KoochButton } from "@/components/KoochButton";
import { reviewError, suppressReviewInvitation, type EligibleReviewStay } from "@/lib/guest-reviews";

export function ReviewInvitationOptOut({ stay, onSuppressed }: {
  stay: EligibleReviewStay; onSuppressed?: (id: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [suppressed, setSuppressed] = useState(Boolean(stay.invitationSuppressed));
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { setSuppressed(Boolean(stay.invitationSuppressed)); }, [stay.invitationSuppressed]);
  async function suppress() {
    if (request.current || suppressed || !stay.invitationPreferenceAvailable) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const result = await suppressReviewInvitation(stay.reservationId, controller.signal);
      if (!controller.signal.aborted && result.reservationId === stay.reservationId && result.invitationSuppressed) {
        setSuppressed(true); onSuppressed?.(stay.reservationId);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(reviewError(failure));
    } finally { request.current = null; setBusy(false); }
  }
  if (suppressed) return <p role="status" className="text-sm leading-6 text-muted-foreground">یادآوری این اقامت خاموش است؛ همچنان می‌توانید نظر بدهید.</p>;
  return <div className="grid gap-1">
    <KoochButton variant="ghost" className="min-h-11 text-sm" loading={busy}
      disabled={!stay.invitationPreferenceAvailable} onClick={() => void suppress()}
      aria-label={`دیگر برای این اقامت نمایش نده: ${stay.propertyName}، رزرو ${stay.reservationNumber ?? stay.reservationId}`}
      title={!stay.invitationPreferenceAvailable ? "پس از تکمیل راه‌اندازی تنظیمات یادآوری فعال می‌شود." : undefined}>
      دیگر برای این اقامت نمایش نده
    </KoochButton>
    {error && <p role="alert" className="text-sm leading-6 text-destructive">{error}</p>}
  </div>;
}
