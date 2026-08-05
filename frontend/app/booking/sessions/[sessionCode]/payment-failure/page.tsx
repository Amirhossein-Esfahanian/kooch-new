import { BookingPaymentResult } from "@/components/booking/BookingPaymentResult";

export default async function BookingPaymentFailurePage({ params }: { params: Promise<{ sessionCode: string }> }) {
  const { sessionCode } = await params;
  return <BookingPaymentResult mode="failure" sessionCode={sessionCode} />;
}
