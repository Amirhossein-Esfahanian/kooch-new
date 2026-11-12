"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import styles from "./page.module.css";

const accountLinks = [
  { title: "رزروهای من", description: "رزروهای مستقل و قدیمی خود را مشاهده و پیگیری کنید.", href: "/account/reservations", icon: "reservations.svg", label: "مشاهده رزروهای مستقل" },
  { title: "سفارش‌های من", description: "سفارش‌های چنداتاقه و وضعیت پرداخت آن‌ها را پیگیری کنید.", href: "/account/orders", icon: "reservations.svg", label: "مشاهده سفارش‌های من" },
  { title: "نظرات من", description: "تجربه اقامت را بنویسید و وضعیت نظرها را ببینید.", href: "/account/reviews", icon: "reviews.svg", label: "مشاهده نظرات من" },
  { title: "کیف پول من", description: "موجودی و درخواست‌های برداشت خود را بررسی کنید.", href: "/account/wallet", icon: "wallet.svg", label: "مشاهده کیف پول" },
] as const;

export default function AccountPage() {
  const router = useRouter();
  const session = useAuthSession();
  const { authenticated, loading, workspaces } = session;
  const hasAccountWorkspace = workspaces.includes("account");

  useEffect(() => {
    if (loading) return;

    if (!authenticated) {
      router.replace("/login");
      return;
    }

    if (!hasAccountWorkspace) {
      router.replace(resolveSessionDestination(session));
    }
  }, [authenticated, hasAccountWorkspace, loading, router, session]);

  if (loading || !authenticated || !hasAccountWorkspace) {
    return (
      <div
        className="grid min-h-[50vh] place-items-center px-5 text-sm font-semibold text-muted-foreground"
        role="status"
      >
        در حال آماده‌سازی حساب کاربری...
      </div>
    );
  }

  return (
    <main
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8"
      dir="rtl"
    >
      <div className="mx-auto grid max-w-5xl gap-5">
        <KoochPageHeader
          description="رزروهای ثبت‌شده با حساب کاربری خود را مشاهده و پیگیری کنید."
          eyebrow="محیط مهمان"
          title="حساب کاربری"
        />

        <nav className={styles.navigation} aria-label="بخش‌های حساب کاربری">
          {accountLinks.map(item => <Link key={item.href} className={styles.link} href={item.href} aria-label={item.label}>
            <KoochCard className={styles.card} padding="sm">
              <span className={styles.iconSurface} aria-hidden="true"><Image className={styles.icon} src={`/svgs/account/${item.icon}`} alt="" width={40} height={40} /></span>
              <div className={styles.content}><h2>{item.title}</h2><p>{item.description}</p></div>
              <span className={styles.affordance} aria-hidden="true">مشاهده</span>
            </KoochCard>
          </Link>)}
        </nav>
      </div>
    </main>
  );
}
