import { notFound } from "next/navigation";
import { PropertyBookingPaymentPage } from "@/components/booking/PropertyBookingPaymentPage";

export const metadata = { title: { absolute: "پرداخت آزمایشی اقامتگاه" }, robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ slug: string; sessionCode: string }> }) {
  if (process.env.NEXT_PUBLIC_INTERNAL_TEST_PAYMENTS_ENABLED !== "true") notFound();
  return <PropertyBookingPaymentPage {...await params} kind="mock-payment" />;
}
