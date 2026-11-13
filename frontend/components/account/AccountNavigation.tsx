"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AccountWorkspace.module.css";

const sections = [
  { href: "/account", label: "نمای کلی", icon: "dashboard.svg" },
  { href: "/account/reservations", label: "رزروهای من", icon: "reservations.svg" },
  { href: "/account/reviews", label: "نظرات من", icon: "reviews.svg" },
  { href: "/account/wallet", label: "کیف پول", icon: "wallet.svg" },
  { href: "/account/welcome-gifts", label: "هدایای من", icon: "gift.svg" },
  { href: "/account/profile", label: "پروفایل من", icon: "account.svg" },
] as const;

export function AccountNavigation() {
  const pathname = usePathname()?.replace(/\/+$/, "");
  return <nav aria-label="ناوبری محیط مهمان" className={styles.navigation}>
    {sections.map(section => {
      const active = pathname === section.href || (section.href !== "/account" && pathname?.startsWith(`${section.href}/`))
        || (section.href === "/account/reservations" && (pathname === "/account/orders" || pathname?.startsWith("/account/booking-sessions/")));
      return <Link key={section.href} href={section.href} className={styles.link} aria-current={active ? "page" : undefined}>
        <Image src={`/svgs/account/${section.icon}`} alt="" width={24} height={24} className={styles.icon} />
        <span>{section.label}</span>
      </Link>;
    })}
  </nav>;
}
