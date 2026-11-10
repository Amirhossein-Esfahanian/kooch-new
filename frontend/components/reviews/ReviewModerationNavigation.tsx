import { UnderlineTabs } from "@/components/UnderlineTabs";

const links = [
  { href: "/admin/reviews", label: "نظرات مهمانان" },
  { href: "/admin/reviews/replies", label: "پاسخ‌های اقامتگاه‌ها" },
] as const;

export function ReviewModerationNavigation() {
  return <UnderlineTabs ariaLabel="صف‌های بررسی نظرات" items={links} />;
}
