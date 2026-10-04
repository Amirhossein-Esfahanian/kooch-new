import { redirect } from "next/navigation";

export default function AdminCashbackPage() {
  redirect("/admin/site-settings#pricing-and-currency");
}
