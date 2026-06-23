"use client";

import { AdminPage } from "@/components/admin/AdminPage";
import { PromotionWorkspace } from "@/components/promotions/PromotionWorkspace";

export default function AdminPromotionsPage() {
  return <AdminPage title="مدیریت پروموشن‌ها"><PromotionWorkspace admin /></AdminPage>;
}
