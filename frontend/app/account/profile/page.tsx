import type { Metadata } from "next";
import { GuestProfilePage } from "@/components/account/GuestProfilePage";

export const metadata: Metadata = { title: "پروفایل من", robots: { index: false, follow: false } };

export default function ProfilePage() {
  return <GuestProfilePage />;
}
