"use client";

import type { FormEvent, InputHTMLAttributes, ReactNode } from "react";
import { useMemo, useState } from "react";
import { KoochButton } from "@/components/KoochButton";

type AuthView = "login" | "register" | "verify" | "profile";
type LoginMethod = "password" | "sms" | "email";
type RegisterMethod = "sms" | "email";

type PendingVerification = {
  mode: "login" | "register";
  method: RegisterMethod;
  identifier: string;
};

const loginMethods: Array<{ id: LoginMethod; label: string }> = [
  { id: "password", label: "رمز عبور" },
  { id: "sms", label: "پیامک" },
  { id: "email", label: "ایمیل" },
];

const registerMethods: Array<{ id: RegisterMethod; label: string }> = [
  { id: "sms", label: "شماره موبایل" },
  { id: "email", label: "ایمیل" },
];

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-2 block text-sm font-medium text-foreground">
      {children}
      <span className="me-1 text-destructive">*</span>
    </span>
  );
}

function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-12 w-full rounded-lg border border-input bg-background px-4",
        "text-start text-foreground outline-none transition",
        "placeholder:text-muted-foreground",
        "focus:border-primary focus:ring-2 focus:ring-primary/15",
        props.className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export function KoochGuestAuthFlow() {
  const [view, setView] = useState<AuthView>("login");
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("sms");
  const [registerMethod, setRegisterMethod] = useState<RegisterMethod>("sms");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [pendingVerification, setPendingVerification] =
    useState<PendingVerification | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);

  const loginConfig = useMemo(() => {
    if (loginMethod === "password") {
      return {
        label: "شماره موبایل یا ایمیل",
        type: "text",
        inputMode: undefined,
        autoComplete: "username",
        placeholder: "شماره موبایل یا ایمیل",
        buttonText: "ورود",
        showPassword: true,
      } as const;
    }

    if (loginMethod === "email") {
      return {
        label: "ایمیل",
        type: "email",
        inputMode: "email",
        autoComplete: "email",
        placeholder: "example@email.com",
        buttonText: "ارسال کد ورود",
        showPassword: false,
      } as const;
    }

    return {
      label: "شماره موبایل",
      type: "tel",
      inputMode: "numeric",
      autoComplete: "tel",
      placeholder: "مثلاً 09123456789",
      buttonText: "ارسال کد ورود",
      showPassword: false,
    } as const;
  }, [loginMethod]);

  const registerConfig = useMemo(() => {
    if (registerMethod === "email") {
      return {
        label: "ایمیل",
        type: "email",
        inputMode: "email",
        autoComplete: "email",
        placeholder: "example@email.com",
      } as const;
    }

    return {
      label: "شماره موبایل",
      type: "tel",
      inputMode: "numeric",
      autoComplete: "tel",
      placeholder: "مثلاً 09123456789",
    } as const;
  }, [registerMethod]);

  function clearStepData() {
    setIdentifier("");
    setPassword("");
    setVerificationCode("");
    setPendingVerification(null);
    setPreviewMessage(null);
  }

  function goToLogin() {
    clearStepData();
    setView("login");
  }

  function goToRegister() {
    clearStepData();
    setView("register");
  }

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreviewMessage(null);

    if (loginMethod === "password") {
      setPreviewMessage("ورود با رمز عبور هنوز به API متصل نشده است.");
      return;
    }

    setPendingVerification({
      mode: "login",
      method: loginMethod === "email" ? "email" : "sms",
      identifier: identifier.trim(),
    });
    setVerificationCode("");
    setView("verify");
  }

  function handleRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreviewMessage(null);
    setPendingVerification({
      mode: "register",
      method: registerMethod,
      identifier: identifier.trim(),
    });
    setVerificationCode("");
    setView("verify");
  }

  function handleVerifySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pendingVerification) {
      goToLogin();
      return;
    }

    if (pendingVerification.mode === "login") {
      setPreviewMessage(
        "کد تأیید به‌صورت آزمایشی پذیرفته شد. اتصال Session بعداً انجام می‌شود.",
      );
      return;
    }

    setPreviewMessage(null);
    setView("profile");
  }

  function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreviewMessage(
      "ثبت‌نام آزمایشی تکمیل شد. در نسخه متصل به API، User ساخته و ورود خودکار انجام می‌شود.",
    );
  }

  const header =
    view === "register"
      ? {
          title: "ساخت حساب کاربری",
          description: "شماره موبایل یا ایمیل خود را وارد کنید.",
        }
      : view === "verify"
        ? {
            title: "تأیید کد",
            description: `کد ارسال‌شده به ${
              pendingVerification?.method === "email" ? "ایمیل" : "شماره موبایل"
            } را وارد کنید.`,
          }
        : view === "profile"
          ? {
              title: "تکمیل مشخصات",
              description: "نام و نام خانوادگی خود را وارد کنید.",
            }
          : {
              title: "ورود یا ثبت‌نام",
              description: "روش ورود به حساب کاربری را انتخاب کنید.",
            };

  return (
    <div dir="rtl">
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-foreground">
          {header.title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {header.description}
        </p>
      </div>

      {view === "login" && (
        <>
          <div role="tablist" className="grid grid-cols-3 gap-2">
            {loginMethods.map((item) => {
              const active = loginMethod === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setLoginMethod(item.id);
                    setPreviewMessage(null);
                  }}
                  className={[
                    "min-h-12 rounded-lg border px-3 py-2 text-sm font-medium transition",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleLoginSubmit} className="mt-5">
            <label className="block">
              <FieldLabel>{loginConfig.label}</FieldLabel>
              <TextInput
                type={loginConfig.type}
                inputMode={loginConfig.inputMode}
                autoComplete={loginConfig.autoComplete}
                placeholder={loginConfig.placeholder}
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                required
              />
            </label>

            <div
              aria-hidden={!loginConfig.showPassword}
              className={[
                "overflow-hidden transition-[max-height,opacity,margin,transform] duration-300 ease-out motion-reduce:transition-opacity motion-reduce:duration-100",
                loginConfig.showPassword
                  ? "mt-4 max-h-28 translate-y-0 opacity-100"
                  : "pointer-events-none mt-0 max-h-0 -translate-y-1 opacity-0",
              ].join(" ")}
            >
              <label className="block">
                <FieldLabel>رمز عبور</FieldLabel>
                <TextInput
                  type="password"
                  autoComplete="current-password"
                  placeholder="رمز عبور خود را وارد کنید"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required={loginConfig.showPassword}
                  disabled={!loginConfig.showPassword}
                  tabIndex={loginConfig.showPassword ? 0 : -1}
                />
              </label>
            </div>

            <KoochButton type="submit" className="mt-4 w-full">
              {loginConfig.buttonText}
            </KoochButton>
          </form>

          <div className="my-5 flex items-center gap-3">
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
            onClick={goToRegister}
          >
            ثبت‌نام
          </KoochButton>
        </>
      )}

      {view === "register" && (
        <>
          <div role="tablist" className="grid grid-cols-2 gap-2">
            {registerMethods.map((item) => {
              const active = registerMethod === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setRegisterMethod(item.id);
                    setPreviewMessage(null);
                  }}
                  className={[
                    "min-h-12 rounded-lg border px-3 py-2 text-sm font-medium transition",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleRegisterSubmit} className="mt-5">
            <label className="block">
              <FieldLabel>{registerConfig.label}</FieldLabel>
              <TextInput
                type={registerConfig.type}
                inputMode={registerConfig.inputMode}
                autoComplete={registerConfig.autoComplete}
                placeholder={registerConfig.placeholder}
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                required
              />
            </label>

            <KoochButton type="submit" className="mt-4 w-full">
              ارسال کد تأیید
            </KoochButton>
          </form>

          <button
            type="button"
            className="mt-4 w-full text-sm font-medium text-primary hover:underline"
            onClick={goToLogin}
          >
            قبلاً ثبت‌نام کرده‌اید؟ ورود
          </button>
        </>
      )}

      {view === "verify" && (
        <>
          <form onSubmit={handleVerifySubmit}>
            <label className="block">
              <FieldLabel>کد تأیید</FieldLabel>
              <TextInput
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="کد تأیید را وارد کنید"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                required
                maxLength={6}
              />
            </label>

            <KoochButton type="submit" className="mt-4 w-full">
              تأیید کد
            </KoochButton>
          </form>

          <div className="mt-4 flex items-center justify-between gap-4 text-sm">
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() =>
                setPreviewMessage(
                  "ارسال مجدد کد هنوز به سرویس پیامک یا ایمیل متصل نشده است.",
                )
              }
            >
              ارسال مجدد کد
            </button>

            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() =>
                setView(
                  pendingVerification?.mode === "register"
                    ? "register"
                    : "login",
                )
              }
            >
              ویرایش اطلاعات
            </button>
          </div>
        </>
      )}

      {view === "profile" && (
        <>
          <form onSubmit={handleProfileSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>نام</FieldLabel>
                <TextInput
                  type="text"
                  autoComplete="given-name"
                  placeholder="نام"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  required
                />
              </label>

              <label className="block">
                <FieldLabel>نام خانوادگی</FieldLabel>
                <TextInput
                  type="text"
                  autoComplete="family-name"
                  placeholder="نام خانوادگی"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  required
                />
              </label>
            </div>

            <KoochButton type="submit" className="mt-4 w-full">
              تکمیل ثبت‌نام
            </KoochButton>
          </form>

          <button
            type="button"
            className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setView("verify")}
          >
            بازگشت به مرحله تأیید
          </button>
        </>
      )}

      <div
        className={[
          "grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:transition-opacity motion-reduce:duration-100",
          previewMessage
            ? "mt-4 grid-rows-[1fr] opacity-100"
            : "mt-0 grid-rows-[0fr] opacity-0",
        ].join(" ")}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            role="status"
            className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm leading-6 text-muted-foreground"
          >
            {previewMessage}
          </div>
        </div>
      </div>

      <p className="mt-5 text-center text-xs leading-6 text-muted-foreground">
        ورود یا ثبت‌نام شما به معنی پذیرش قوانین و مقررات و حریم خصوصی کوچ است.
      </p>
    </div>
  );
}
