"use client";

import { FormEvent, ReactNode, useMemo, useState } from "react";

type LoginMethod = "password" | "sms" | "email";

const methods: Array<{
  id: LoginMethod;
  label: string;
  icon: ReactNode;
}> = [
  {
    id: "password",
    label: "رمز عبور",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path
          d="M7 10V7a5 5 0 0 1 10 0v3m-11 0h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "sms",
    label: "پیامک",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path
          d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 10h.01M12 10h.01M16 10h.01"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "email",
    label: "ایمیل",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path
          d="M4 6h16v12H4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="m4 7 8 6 8-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

function UserPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        d="M15 19a6 6 0 0 0-12 0m6-8a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10-2v6m-3-3h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function LoginMockPage() {
  const [method, setMethod] = useState<LoginMethod>("email");
  const [submitted, setSubmitted] = useState(false);

  const formConfig = useMemo(() => {
    switch (method) {
      case "password":
        return {
          primaryLabel: "موبایل یا ایمیل",
          primaryType: "text",
          primaryPlaceholder: "شماره موبایل یا ایمیل",
          showPassword: true,
          submitText: "ورود",
        };
      case "sms":
        return {
          primaryLabel: "شماره موبایل",
          primaryType: "tel",
          primaryPlaceholder: "مثلاً 09123456789",
          showPassword: false,
          submitText: "ارسال کد ورود",
        };
      default:
        return {
          primaryLabel: "ایمیل",
          primaryType: "email",
          primaryPlaceholder: "example@email.com",
          showPassword: false,
          submitText: "تأیید و دریافت کد",
        };
    }
  }, [method]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(520px,1.05fr)]"
    >
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-14">
        <div className="w-full max-w-[520px]">
          <div className="mb-9 text-center">
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              ورود به فضای مدیریت
            </p>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              خوش آمدید
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              روش ورود به حساب کاربری را انتخاب کنید.
            </p>
          </div>

          <div
            className="mb-6 grid grid-cols-3 gap-2"
            role="tablist"
            aria-label="روش ورود"
          >
            {methods.map((item) => {
              const isActive = method === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setMethod(item.id);
                    setSubmitted(false);
                  }}
                  className={[
                    "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-3 py-2 text-sm font-medium transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  ].join(" ")}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium">
                {formConfig.primaryLabel}
                <span className="me-1 text-destructive">*</span>
              </span>

              <input
                key={method}
                type={formConfig.primaryType}
                inputMode={method === "sms" ? "numeric" : undefined}
                autoComplete={
                  method === "password"
                    ? "username"
                    : method === "sms"
                      ? "tel"
                      : "email"
                }
                placeholder={formConfig.primaryPlaceholder}
                required
                className="h-12 w-full rounded-xl border border-input bg-background px-4 text-start outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>

            {formConfig.showPassword && (
              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  رمز عبور
                  <span className="me-1 text-destructive">*</span>
                </span>

                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="رمز عبور خود را وارد کنید"
                  required
                  className="h-12 w-full rounded-xl border border-input bg-background px-4 text-start outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>
            )}

            <button
              type="submit"
              className="flex h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {formConfig.submitText}
            </button>

            {submitted && (
              <div
                role="status"
                className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
              >
                این صفحه فعلاً آزمایشی است و به سرویس ورود متصل نشده.
              </div>
            )}
          </form>

          <div className="my-7 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">
              حساب کاربری ندارید؟
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            onClick={() => setSubmitted(true)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold transition hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <UserPlusIcon />
            ثبت‌نام
          </button>

          <p className="mt-8 text-center text-xs leading-7 text-muted-foreground">
            ورود یا ثبت‌نام شما به معنی پذیرش{" "}
            <button
              type="button"
              className="font-semibold text-primary hover:underline"
            >
              قوانین و مقررات
            </button>{" "}
            و{" "}
            <button
              type="button"
              className="font-semibold text-primary hover:underline"
            >
              حریم خصوصی
            </button>{" "}
            کوچ است.
          </p>
        </div>
      </section>

      <aside
        className="relative hidden min-h-screen overflow-hidden lg:block"
        aria-label="معرفی پنل مدیریت کوچ"
      >
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1800&q=85')",
          }}
        />
        <div className="absolute inset-0 bg-neutral-950/60" />
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950/85 via-neutral-950/15 to-neutral-950/25" />

        <div className="relative z-10 flex h-full min-h-screen flex-col justify-between p-12 text-white xl:p-16">
          <div>
            <div className="text-4xl font-black tracking-tight xl:text-5xl">
              فلای‌تودی
            </div>
          </div>

          <div className="max-w-2xl">
            <h2 className="text-3xl font-black leading-relaxed xl:text-4xl">
              هتل و اقامتگاه خود را با یک{" "}
              <span className="text-amber-400">پنل</span> مدیریت کنید.
            </h2>

            <p className="mt-5 text-base leading-8 text-white/75">
              موجودی، قیمت‌گذاری، ظرفیت و درخواست‌های رزرو را از یک فضای یکپارچه
              مدیریت کنید.
            </p>
            <p className="mt-1 text-sm leading-7 text-white/65">
              اطلاعات واردشده مستقیماً در بخش‌های عمومی سامانه نمایش داده
              می‌شوند.
            </p>
          </div>
        </div>
      </aside>
    </main>
  );
}
