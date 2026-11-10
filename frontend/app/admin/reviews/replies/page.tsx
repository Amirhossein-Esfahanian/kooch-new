import type { Metadata } from "next";
import { AdminReviewRepliesPage } from "@/components/reviews/AdminReviewRepliesPage";
export const metadata: Metadata = { title: "بررسی پاسخ‌های اقامتگاه", robots: { index: false, follow: false } };
export default function Page() { return <AdminReviewRepliesPage />; }
