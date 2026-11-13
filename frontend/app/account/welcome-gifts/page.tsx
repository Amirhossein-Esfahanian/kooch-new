import type { Metadata } from "next";
import { GuestWelcomeGiftsPage } from "@/components/account/GuestWelcomeGiftsPage";

export const metadata: Metadata = { title: "هدایای من", robots: { index: false, follow: false } };

export default function WelcomeGiftsPage() {
  return <GuestWelcomeGiftsPage />;
}
