import type { Metadata } from "next";
import { Suspense } from "react";
import { PropertyBookingLanding } from "@/components/booking/PropertyBookingLanding";

export const metadata: Metadata = {
  title: { absolute: "رزرو اقامتگاه" },
  description: "معرفی اقامتگاه، اتاق‌ها و بررسی امکان رزرو برای تاریخ اقامت شما.",
};

export default function PropertyBookingLandingPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="grid min-h-screen place-items-center bg-background text-foreground" role="status">در حال دریافت اقامتگاه…</div>}>
      <PropertyBookingLanding />
    </Suspense>
  );
}
