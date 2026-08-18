import { Suspense } from "react";
import { BookingCheckoutFlow } from "@/components/booking/BookingCheckoutFlow";

export default function BookingCheckoutPage() {
  return (
    <Suspense fallback={<CheckoutPageLoading />}>
      <BookingCheckoutFlow />
    </Suspense>
  );
}

function CheckoutPageLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div
        aria-live="polite"
        className="rounded-lg border border-border bg-card p-6 text-sm font-bold text-muted-foreground"
        role="status"
      >
        در حال آماده‌سازی مراحل رزرو...
      </div>
    </div>
  );
}
