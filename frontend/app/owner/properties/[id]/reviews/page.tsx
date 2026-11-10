import type { Metadata } from "next";
import { OwnerReviewsPage } from "@/components/reviews/OwnerReviewsPage";

export const metadata: Metadata = { title: "نظرات اقامتگاه", robots: { index: false, follow: false } };
export default function Page() { return <OwnerReviewsPage />; }
