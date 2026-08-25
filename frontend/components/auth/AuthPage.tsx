"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochField, KoochInput } from "@/components/KoochFormControls";
import {
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { apiRequest, setToken } from "@/lib/owner-api";
import { safeInternalReturnTo } from "@/lib/safe-return-to";

type AuthMode = "login" | "register";
type LoginMethod = "password" | "otp";

interface AuthResponse {
  token: string;
  fullName: string;
}

interface RequestOtpResponse {
  sent: boolean;
  expiresAtUtc: string;
  devOtpCode?: string | null;
}

function validatePassword(password: string) {
  if (
    password.length < 8 ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return "رمز عبور باید حداقل ۸ کاراکتر و شامل حرف کوچک انگلیسی و عدد باشد.";
  }

  return "";
}

function segmentedButtonClass(active: boolean) {
  return [
    "min-h-11 rounded-lg px-3 py-2 text-sm font-bold transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-card text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground",
  ].join(" ");
}

export function AuthPage({ returnTo }: { returnTo?: string | null }) {
  const router = useRouter();
  const { refreshSession } = useAuthSession();

  const [mode, setMode] = useState<AuthMode>("login");
  const [method, setMethod] = useState<LoginMethod>("password");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const [mobile, setMobile] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [devOtpCode, setDevOtpCode] = useState("");
  const [otpExpiresAt, setOtpExpiresAt] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [registerMobile, setRegisterMobile] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registrationOtpVisible, setRegistrationOtpVisible] = useState(false);
  const [registrationOtp, setRegistrationOtp] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requestingOtp, setRequestingOtp] = useState(false);

  async function completeLogin(response: AuthResponse) {
    setToken(response.token);
    const session = await refreshSession();

    if (!session) {
      throw new Error("اطلاعات حساب کاربری دریافت نشد.");
    }

    router.push(
      safeInternalReturnTo(returnTo) ?? resolveSessionDestination(session),
    );
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setDevOtpCode("");

    if (nextMode === "login") {
      setRegistrationOtpVisible(false);
      setRegistrationOtp("");
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, email: identifier, password }),
      });

      await completeLogin(response);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "ورود ناموفق بود.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function requestOtp() {
    setRequestingOtp(true);
    setError("");
    setDevOtpCode("");

    try {
      const response = await apiRequest<RequestOtpResponse>(
        "/auth/request-otp",
        {
          method: "POST",
          body: JSON.stringify({ mobile }),
        },
      );

      setOtpExpiresAt(response.expiresAtUtc);

      if (response.devOtpCode && process.env.NODE_ENV !== "production") {
        setDevOtpCode(response.devOtpCode);
        setOtpCode(response.devOtpCode);
      }

      toast.success("رمز یکبار مصرف آماده شد.");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "دریافت رمز یکبار مصرف انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setRequestingOtp(false);
    }
  }

  async function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<AuthResponse>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ mobile, code: otpCode }),
      });

      await completeLogin(response);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "ورود با رمز یکبار مصرف ناموفق بود.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const passwordError = validatePassword(registerPassword);
    if (passwordError) {
      setError(passwordError);
      toast.error(passwordError);
      setLoading(false);
      return;
    }

    if (registerPassword !== confirmPassword) {
      const message = "تکرار رمز عبور با رمز عبور یکسان نیست.";
      setError(message);
      toast.error(message);
      setLoading(false);
      return;
    }

    try {
      const response = await apiRequest<RequestOtpResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          mobile: registerMobile,
          email: registerEmail || null,
          password: registerPassword,
          confirmPassword,
        }),
      });

      setRegistrationOtpVisible(true);
      setOtpExpiresAt(response.expiresAtUtc);

      if (response.devOtpCode && process.env.NODE_ENV !== "production") {
        setDevOtpCode(response.devOtpCode);
        setRegistrationOtp(response.devOtpCode);
      }

      toast.success("ثبت‌نام انجام شد. رمز یکبار مصرف را وارد کنید.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "ثبت‌نام انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function verifyRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<AuthResponse>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ mobile: registerMobile, code: registrationOtp }),
      });

      await completeLogin(response);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "تأیید رمز یکبار مصرف ناموفق بود.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)]"
    >
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-14">
        <div className="w-full max-w-[500px]">
          <div className="mb-7 text-right">
            <p className="text-sm font-bold text-primary">کوچ</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {mode === "login"
                ? "ورود به حساب کاربری"
                : registrationOtpVisible
                  ? "تأیید شماره موبایل"
                  : "ساخت حساب کاربری"}
            </h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {mode === "login"
                ? "با رمز عبور یا رمز یکبار مصرف وارد حساب خود شوید."
                : registrationOtpVisible
                  ? "برای فعال‌سازی حساب، کد ارسال‌شده را وارد کنید."
                  : "اطلاعات حساب خود را وارد کنید تا ثبت‌نام انجام شود."}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
              <button
                className={segmentedButtonClass(mode === "login")}
                onClick={() => changeMode("login")}
                type="button"
              >
                ورود
              </button>
              <button
                className={segmentedButtonClass(mode === "register")}
                onClick={() => changeMode("register")}
                type="button"
              >
                ثبت‌نام
              </button>
            </div>

            {error && (
              <KoochAlert className="mt-4" variant="destructive">
                {error}
              </KoochAlert>
            )}

            {mode === "login" ? (
              <>
                <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
                  <button
                    className={segmentedButtonClass(method === "password")}
                    onClick={() => {
                      setMethod("password");
                      setError("");
                    }}
                    type="button"
                  >
                    رمز عبور
                  </button>
                  <button
                    className={segmentedButtonClass(method === "otp")}
                    onClick={() => {
                      setMethod("otp");
                      setError("");
                    }}
                    type="button"
                  >
                    پیامک
                  </button>
                </div>

                {method === "password" ? (
                  <form className="mt-5 grid gap-4" onSubmit={submitPassword}>
                    <KoochField label="ایمیل یا شماره موبایل" required>
                      <KoochInput
                        autoComplete="username"
                        dir="ltr"
                        onChange={(event) => setIdentifier(event.target.value)}
                        placeholder="شماره موبایل یا ایمیل"
                        required
                        value={identifier}
                      />
                    </KoochField>
                    <KoochField label="رمز عبور" required>
                      <KoochInput
                        autoComplete="current-password"
                        dir="ltr"
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="رمز عبور"
                        required
                        type="password"
                        value={password}
                      />
                    </KoochField>
                    <KoochButton
                      className="mt-1 w-full"
                      loading={loading}
                      type="submit"
                    >
                      ورود
                    </KoochButton>
                  </form>
                ) : (
                  <form className="mt-5 grid gap-4" onSubmit={submitOtp}>
                    <KoochField label="شماره موبایل" required>
                      <KoochInput
                        autoComplete="tel"
                        dir="ltr"
                        inputMode="numeric"
                        onChange={(event) => setMobile(event.target.value)}
                        placeholder="مثلاً 09123456789"
                        required
                        value={mobile}
                      />
                    </KoochField>
                    <KoochButton
                      loading={requestingOtp}
                      onClick={requestOtp}
                      type="button"
                      variant="outline"
                    >
                      ارسال رمز یکبار مصرف
                    </KoochButton>
                    {devOtpCode && process.env.NODE_ENV !== "production" && (
                      <KoochAlert variant="default">
                        <span>کد توسعه: </span>
                        <span dir="ltr">{devOtpCode}</span>
                      </KoochAlert>
                    )}
                    <KoochField
                      helperText={
                        otpExpiresAt
                          ? `اعتبار کد تا ${new Date(otpExpiresAt).toLocaleTimeString("fa-IR")}`
                          : undefined
                      }
                      label="کد یکبار مصرف"
                      required
                    >
                      <KoochInput
                        autoComplete="one-time-code"
                        dir="ltr"
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(event) => setOtpCode(event.target.value)}
                        placeholder="کد تأیید"
                        required
                        value={otpCode}
                      />
                    </KoochField>
                    <KoochButton
                      className="mt-1 w-full"
                      loading={loading}
                      type="submit"
                    >
                      ورود
                    </KoochButton>
                  </form>
                )}
              </>
            ) : registrationOtpVisible ? (
              <form className="mt-5 grid gap-4" onSubmit={verifyRegistration}>
                <KoochAlert variant="success">
                  حساب شما ایجاد شد. برای فعال‌سازی، رمز یکبار مصرف را وارد
                  کنید.
                </KoochAlert>
                {devOtpCode && process.env.NODE_ENV !== "production" && (
                  <KoochAlert variant="default">
                    <span>کد توسعه: </span>
                    <span dir="ltr">{devOtpCode}</span>
                  </KoochAlert>
                )}
                <KoochField
                  helperText={
                    otpExpiresAt
                      ? `اعتبار کد تا ${new Date(otpExpiresAt).toLocaleTimeString("fa-IR")}`
                      : undefined
                  }
                  label="کد یکبار مصرف"
                  required
                >
                  <KoochInput
                    autoComplete="one-time-code"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setRegistrationOtp(event.target.value)}
                    placeholder="کد تأیید"
                    required
                    value={registrationOtp}
                  />
                </KoochField>
                <KoochButton className="w-full" loading={loading} type="submit">
                  تأیید و ورود
                </KoochButton>
                <button
                  className="text-sm font-medium text-muted-foreground transition hover:text-foreground"
                  onClick={() => {
                    setRegistrationOtpVisible(false);
                    setRegistrationOtp("");
                    setDevOtpCode("");
                    setError("");
                  }}
                  type="button"
                >
                  ویرایش اطلاعات ثبت‌نام
                </button>
              </form>
            ) : (
              <form className="mt-5 grid gap-4" onSubmit={submitRegistration}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <KoochField label="نام" required>
                    <KoochInput
                      autoComplete="given-name"
                      onChange={(event) => setFirstName(event.target.value)}
                      placeholder="نام"
                      required
                      value={firstName}
                    />
                  </KoochField>
                  <KoochField label="نام خانوادگی" required>
                    <KoochInput
                      autoComplete="family-name"
                      onChange={(event) => setLastName(event.target.value)}
                      placeholder="نام خانوادگی"
                      required
                      value={lastName}
                    />
                  </KoochField>
                </div>
                <KoochField label="شماره موبایل" required>
                  <KoochInput
                    autoComplete="tel"
                    dir="ltr"
                    inputMode="numeric"
                    onChange={(event) => setRegisterMobile(event.target.value)}
                    placeholder="مثلاً 09123456789"
                    required
                    value={registerMobile}
                  />
                </KoochField>
                <KoochField
                  helperText="اختیاری، اما پیشنهاد می‌شود."
                  label="ایمیل"
                >
                  <KoochInput
                    autoComplete="email"
                    dir="ltr"
                    onChange={(event) => setRegisterEmail(event.target.value)}
                    placeholder="example@email.com"
                    type="email"
                    value={registerEmail}
                  />
                </KoochField>
                <KoochField
                  helperText="حداقل ۸ کاراکتر، شامل حرف کوچک انگلیسی و عدد."
                  label="رمز عبور"
                  required
                >
                  <KoochInput
                    autoComplete="new-password"
                    dir="ltr"
                    minLength={8}
                    onChange={(event) =>
                      setRegisterPassword(event.target.value)
                    }
                    placeholder="رمز عبور"
                    required
                    type="password"
                    value={registerPassword}
                  />
                </KoochField>
                <KoochField label="تکرار رمز عبور" required>
                  <KoochInput
                    autoComplete="new-password"
                    dir="ltr"
                    minLength={8}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="تکرار رمز عبور"
                    required
                    type="password"
                    value={confirmPassword}
                  />
                </KoochField>
                <KoochButton
                  className="mt-1 w-full"
                  loading={loading}
                  type="submit"
                >
                  ثبت‌نام
                </KoochButton>
              </form>
            )}

            <p className="mt-6 text-center text-xs leading-6 text-muted-foreground">
              ورود یا ثبت‌نام شما به معنی پذیرش{" "}
              <button
                className="font-semibold text-primary hover:underline"
                type="button"
              >
                قوانین و مقررات
              </button>{" "}
              و{" "}
              <button
                className="font-semibold text-primary hover:underline"
                type="button"
              >
                حریم خصوصی
              </button>{" "}
              کوچ است.
            </p>
          </div>
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
              ورود به دنیای اقامت، سفر و مدیریت یکپارچه
            </h2>
            <p className="mt-5 text-base leading-8 text-white/75">
              با یک حساب کاربری وارد شوید؛ فضای کاری و دسترسی‌های شما بعد از
              ورود و براساس نقش‌ها و عضویت‌های ثبت‌شده تعیین می‌شود.
            </p>
          </div>
        </div>
      </aside>
    </main>
  );
}
