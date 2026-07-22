"use client";

import type { FormEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";

type LoginMethod = "password" | "sms" | "email";

type LoginMethodItem = {
  id: LoginMethod;
  label: string;
  icon: ReactNode;
};

const loginMethods: LoginMethodItem[] = [
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

export default function LoginDialogPreviewPage() {
  const [open, setOpen] = useState(true);
  const [method, setMethod] = useState<LoginMethod>("sms");
  const [submitted, setSubmitted] = useState(false);

  const formConfig = useMemo(() => {
    if (method === "password") {
      return {
        label: "شماره موبایل یا ایمیل",
        type: "text",
        placeholder: "شماره موبایل یا ایمیل",
        autoComplete: "username",
        showPassword: true,
        submitText: "ورود",
      };
    }

    if (method === "email") {
      return {
        label: "ایمیل",
        type: "email",
        placeholder: "example@email.com",
        autoComplete: "email",
        showPassword: false,
        submitText: "ارسال کد ورود",
      };
    }

    return {
      label: "شماره موبایل",
      type: "tel",
      placeholder: "مثلاً 09123456789",
      autoComplete: "tel",
      showPassword: false,
      submitText: "ارسال کد ورود",
    };
  }, [method]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10"
    >
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 text-center">
        <h1 className="text-xl font-bold text-foreground">
          پیش‌نمایش آزمایشی ورود
        </h1>

        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          این صفحه فقط برای بررسی ظاهر و رفتار دیالوگ ساخته شده و به API متصل
          نیست.
        </p>

        <div className="mt-6 flex justify-center">
          <KoochButton onClick={() => setOpen(true)}>
            بازکردن دیالوگ ورود
          </KoochButton>
        </div>
      </div>

      <KoochDialog
        open={open}
        onOpenChange={setOpen}
        title="ورود یا ثبت‌نام"
        description="روش ورود به حساب کاربری را انتخاب کنید."
        className="h-auto max-h-[90vh] sm:max-w-[480px]"
        bodyClassName="py-4"
      >
        <div className="space-y-6">
          <div
            role="tablist"
            aria-label="روش ورود"
            className="grid grid-cols-3 gap-2"
          >
            {loginMethods.map((item) => {
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
                    "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-sm font-medium transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  ].join(" ")}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit}>
            <div className="flex flex-col">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-foreground">
                  {formConfig.label}
                  <span className="me-1 text-destructive">*</span>
                </span>

                <input
                  type={formConfig.type}
                  inputMode={method === "sms" ? "numeric" : undefined}
                  autoComplete={formConfig.autoComplete}
                  placeholder={formConfig.placeholder}
                  required
                  className="h-12 w-full rounded-xl border border-input bg-background px-4 text-start text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>

              <div
                aria-hidden={!formConfig.showPassword}
                className={formConfig.showPassword ? "" : "pointer-events-none"}
                style={{
                  maxHeight: formConfig.showPassword ? "96px" : "0px",
                  marginTop: formConfig.showPassword ? "16px" : "0px",
                  opacity: formConfig.showPassword ? 1 : 0,
                  overflow: "hidden",
                  transform: formConfig.showPassword
                    ? "translateY(0)"
                    : "translateY(-6px)",
                  visibility: formConfig.showPassword ? "visible" : "hidden",
                  transition: formConfig.showPassword
                    ? [
                        "max-height 320ms ease",
                        "margin-top 320ms ease",
                        "opacity 220ms ease 80ms",
                        "transform 320ms ease",
                        "visibility 0ms",
                      ].join(", ")
                    : [
                        "max-height 320ms ease",
                        "margin-top 320ms ease",
                        "opacity 160ms ease",
                        "transform 320ms ease",
                        "visibility 0ms linear 320ms",
                      ].join(", "),
                }}
              >
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">
                    رمز عبور
                    <span className="me-1 text-destructive">*</span>
                  </span>

                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="رمز عبور خود را وارد کنید"
                    required={formConfig.showPassword}
                    disabled={!formConfig.showPassword}
                    tabIndex={formConfig.showPassword ? 0 : -1}
                    className="h-12 w-full rounded-xl border border-input bg-background px-4 text-start text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                </label>
              </div>

              <div className="mt-4">
                <KoochButton type="submit" className="w-full">
                  {formConfig.submitText}
                </KoochButton>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateRows: submitted ? "1fr" : "0fr",
                  marginTop: submitted ? "16px" : "0px",
                  opacity: submitted ? 1 : 0,
                  transition:
                    "grid-template-rows 260ms ease, margin-top 260ms ease, opacity 180ms ease",
                }}
              >
                <div className="min-h-0 overflow-hidden">
                  <div
                    role="status"
                    className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm leading-6 text-muted-foreground"
                  >
                    نسخه آزمایشی است و هنوز هیچ درخواست ورود یا ارسال کدی انجام
                    نمی‌شود.
                  </div>
                </div>
              </div>
            </div>
          </form>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">
              حساب کاربری ندارید؟
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <KoochButton
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setSubmitted(true)}
          >
            ثبت‌نام
          </KoochButton>

          <p className="text-center text-xs leading-6 text-muted-foreground">
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
      </KoochDialog>
    </main>
  );
}
