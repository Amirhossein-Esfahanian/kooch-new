import type { Metadata } from "next";
import { AdminReviewsPage } from "@/components/reviews/AdminReviewsPage";

export const metadata: Metadata = { title: "مدیریت نظرات", robots: { index: false, follow: false } };

export default function Page() { return <AdminReviewsPage />; }
