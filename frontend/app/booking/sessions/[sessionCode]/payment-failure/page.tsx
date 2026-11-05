import { PropertyBookingPaymentEntry } from "@/components/booking/PropertyBookingPaymentEntry";

export const metadata = { robots: { index: false, follow: false } };

export default async function BookingPaymentFailurePage({ params }: { params: Promise<{ sessionCode: string }> }) {
  const { sessionCode } = await params;
  return <PropertyBookingPaymentEntry kind="payment-failure" sessionCode={sessionCode} />;
}
