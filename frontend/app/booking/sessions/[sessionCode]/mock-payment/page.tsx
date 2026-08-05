import { notFound } from "next/navigation";
import { MockPaymentCheckout } from "@/components/booking/MockPaymentCheckout";

export default async function MockPaymentPage({ params }: { params: Promise<{ sessionCode: string }> }) {
  if (process.env.NEXT_PUBLIC_INTERNAL_TEST_PAYMENTS_ENABLED !== "true") notFound();
  const { sessionCode } = await params;
  return <MockPaymentCheckout sessionCode={sessionCode} />;
}
