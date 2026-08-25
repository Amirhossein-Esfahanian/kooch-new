"use client";

import { KoochAuthForm } from "@/components/auth/KoochAuthForm";

export default function ManagementLoginPage() {
  return (
    <main
      dir="rtl"
      className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)]"
    >
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-14">
        <div className="w-full max-w-[480px]">
          <div className="mb-8">
            <p className="mb-2 text-sm font-medium text-primary">
              پنل مدیریت کوچ
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              ورود مالک و مدیر سامانه
            </h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              پس از ورود، فضای کاری مجاز شما بر اساس عضویت‌ها و دسترسی‌های
              ثبت‌شده تعیین می‌شود.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <KoochAuthForm context="management" defaultMethod="password" />
          </div>

          <p className="mt-5 text-center text-xs leading-6 text-muted-foreground">
            این صفحه برای مالک، اعضای اقامتگاه و مدیران سامانه مشترک است.
          </p>
        </div>
      </section>

      <aside className="relative hidden min-h-screen overflow-hidden lg:block">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url('/images/auth/management-login.jpg')",
          }}
        />
        <div className="absolute inset-0 bg-primary/80" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />

        <div className="relative z-10 flex h-full min-h-screen flex-col justify-between p-12 text-white xl:p-16">
          <div className="text-4xl font-bold tracking-tight xl:text-5xl">
            کوچ
          </div>

          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold leading-relaxed xl:text-4xl">
              مدیریت اقامتگاه، رزرو، قیمت و ظرفیت در یک فضای یکپارچه
            </h2>
            <p className="mt-5 text-base leading-8 text-white/75">
              نوع Workspace بعد از احراز هویت و براساس Permission Matrix تعیین
              می‌شود؛ حساب جداگانه‌ای برای مالک یا ادمین ساخته نمی‌شود.
            </p>
          </div>
        </div>
      </aside>
    </main>
  );
}
