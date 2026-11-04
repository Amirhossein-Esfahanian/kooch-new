"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochDialog } from "@/components/KoochDialog";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { BookingCheckoutContent } from "@/components/booking/BookingCheckoutFlow";
import { useBookingCart } from "@/components/booking/BookingCartProvider";
import { validBookingPropertyEntry } from "@/lib/booking-context";

export function PropertyDirectCheckoutDialog({ propertyId, propertySlug, open, onOpenChange }: {
  propertyId: number;
  propertySlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const cart = useBookingCart();
  const auth = useAuthSession();
  const [busy, setBusy] = useState(false);
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const editSelectionRequested = useRef(false);
  const entry = validBookingPropertyEntry(cart.propertyEntry, cart.items);
  const matches = entry?.kind === "book" && entry.propertyId === propertyId && entry.propertySlug === propertySlug;

  // Reuse the shared provider: only this public Property surface opts out of /login navigation.
  useEffect(() => auth.registerInlineSessionRecovery?.(() => {
    setRecoveryEpoch((value) => value + 1);
  }), [auth.registerInlineSessionRecovery]);

  useEffect(() => {
    if (cart.hydrated && cart.checkoutRequested && matches) onOpenChange(true);
  }, [cart.hydrated, cart.checkoutRequested, matches, onOpenChange]);

  useEffect(() => {
    if (open || !editSelectionRequested.current) return;
    editSelectionRequested.current = false;
    let focusFrame: number | undefined;
    // Let KoochDialog restore its launcher first, then navigate to the requested section.
    const frame = window.requestAnimationFrame(() => {
      focusFrame = window.requestAnimationFrame(() => {
        const selection = document.getElementById("property-rooms");
        selection?.scrollIntoView?.({ block: "start" });
        selection?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
    };
  }, [open]);

  const close = useCallback((next: boolean) => {
    if (busy) return;
    if (!next) cart.setCheckoutRequested(false);
    onOpenChange(next);
  }, [busy, cart, onOpenChange]);

  const editSelection = () => {
    editSelectionRequested.current = true;
    close(false);
  };

  return <KoochDialog
    open={open && matches}
    onOpenChange={close}
    closeDisabled={busy}
    title={`تکمیل رزرو ${cart.items[0]?.propertyName ?? "اقامتگاه"}`}
    description="اطلاعات رزرو را همین‌جا تکمیل کنید. با بستن این پنجره، انتخاب اتاق‌ها حفظ می‌شود."
    size="xl"
    contentClassName="max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-screen max-sm:!max-w-none max-sm:!rounded-none"
    bodyClassName="px-4 py-0 sm:px-6"
  >
    {open && matches && <>
      {recoveryEpoch > 0 && !auth.authenticated && <KoochAlert className="mt-4" variant="warning" title="ورود دوباره لازم است">
        نشست شما پایان یافته است. انتخاب‌های رزرو حفظ شده‌اند؛ شماره موبایل را دوباره تأیید کنید.
      </KoochAlert>}
      <BookingCheckoutContent
        presentation="dialog"
        identityResetKey={recoveryEpoch}
        onEditSelection={editSelection}
        onBusyChange={setBusy}
      />
    </>}
  </KoochDialog>;
}
