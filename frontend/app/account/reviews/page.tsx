import type { Metadata } from "next";
import { Suspense } from "react";
import { GuestReviewsPage } from "@/components/reviews/GuestReviewsPage";

export const metadata: Metadata = { title: "نظرات من", robots: { index: false, follow: false } };

export default function ReviewsPage() {
  return <Suspense fallback={<p role="status" className="p-6 text-center">در حال آماده‌سازی نظرات…</p>}><GuestReviewsPage /></Suspense>;
}
