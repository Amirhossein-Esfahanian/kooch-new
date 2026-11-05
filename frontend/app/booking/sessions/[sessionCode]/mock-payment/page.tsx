import { notFound } from "next/navigation";
import { PropertyBookingPaymentEntry } from "@/components/booking/PropertyBookingPaymentEntry";

export const metadata = { robots: { index: false, follow: false } };

export default async function MockPaymentPage({ params }: { params: Promise<{ sessionCode: string }> }) {
  if (process.env.NEXT_PUBLIC_INTERNAL_TEST_PAYMENTS_ENABLED !== "true") notFound();
  const { sessionCode } = await params;
  return <PropertyBookingPaymentEntry kind="mock-payment" sessionCode={sessionCode} />;
}
