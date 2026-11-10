import Link from "next/link";
export function ReviewModerationNavigation({ active }: { active: "reviews" | "replies" }) {
  const links = [["reviews", "/admin/reviews", "نظرات مهمانان"], ["replies", "/admin/reviews/replies", "پاسخ‌های اقامتگاه‌ها"]] as const;
  return <nav aria-label="صف‌های بررسی نظرات" className="flex flex-wrap gap-3 border-b border-border pb-3">{links.map(([key, href, label]) => <Link key={key} href={href} aria-current={active === key ? "page" : undefined} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-primary">{label}</Link>)}</nav>;
}
