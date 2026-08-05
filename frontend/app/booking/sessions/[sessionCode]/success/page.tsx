import { BookingPaymentResult } from "@/components/booking/BookingPaymentResult";

export default async function BookingPaymentSuccessPage({ params }: { params: Promise<{ sessionCode: string }> }) {
  const { sessionCode } = await params;
  return <BookingPaymentResult mode="success" sessionCode={sessionCode} />;
}
