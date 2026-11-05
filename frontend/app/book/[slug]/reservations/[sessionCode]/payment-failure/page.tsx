import { PropertyBookingPaymentPage } from "@/components/booking/PropertyBookingPaymentPage";

export const metadata = { title: { absolute: "نتیجه پرداخت رزرو اقامتگاه" }, robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ slug: string; sessionCode: string }> }) {
  return <PropertyBookingPaymentPage {...await params} kind="payment-failure" />;
}
