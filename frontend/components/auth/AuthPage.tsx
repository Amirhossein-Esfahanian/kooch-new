"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochField, KoochInput } from "@/components/KoochFormControls";
import {
  apiRequest,
  ownerPropertyKey,
  PropertyResponse,
  setAuthUser,
  setToken,
} from "@/lib/owner-api";

type AuthMode = "login" | "register";
type LoginMethod = "password" | "otp";

interface AuthResponse {
  token: string;
  fullName: string;
  role: string;
}

interface RequestOtpResponse {
  sent: boolean;
  expiresAtUtc: string;
  devOtpCode?: string | null;
}

function validatePassword(password: string) {
  if (password.length < 8 || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return "رمز عبور باید حداقل ۸ کاراکتر و شامل حرف کوچک انگلیسی و عدد باشد.";
  }

  return "";
}

export function AuthPage() {
  const router = useRouter();
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
    setAuthUser(response.role, response.fullName);

    if (response.role === "SuperAdmin" || response.role === "AdminAssistant") {
      router.push("/admin");
      return;
    }

    if (response.role === "Owner" || response.role === "OwnerAssistant") {
      const properties = await apiRequest<PropertyResponse[]>("/owner/properties");
      if (properties.length === 1) {
        localStorage.setItem(ownerPropertyKey, properties[0].id.toString());
        router.push(`/owner/properties/${properties[0].id}/dashboard`);
        return;
      }

      router.push("/owner/select-property");
      return;
    }

    router.push("/");
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier,
          email: identifier,
          password,
        }),
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
      const response = await apiRequest<RequestOtpResponse>("/auth/request-otp", {
        method: "POST",
        body: JSON.stringify({ mobile }),
      });
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
        caught instanceof Error ? caught.message : "ورود با رمز یکبار مصرف ناموفق بود.";
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
      toast.success("ثبت نام انجام شد. رمز یکبار مصرف را وارد کنید.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "ثبت نام انجام نشد.";
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
        caught instanceof Error ? caught.message : "تایید رمز یکبار مصرف ناموفق بود.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground">
      <KoochCard className="mx-auto max-w-md" padding="lg" variant="elevated">
        <div className="text-right">
          <p className="text-sm font-bold text-primary">کوچ</p>
          <h1 className="mt-2 text-3xl font-black text-foreground">
            ورود به حساب کاربری
          </h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            با ایمیل، موبایل، رمز عبور یا رمز یکبار مصرف وارد شوید.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
          <button
            className={`rounded-md px-3 py-2 text-sm font-bold transition ${
              mode === "login"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode("login")}
            type="button"
          >
            ورود
          </button>
          <button
            className={`rounded-md px-3 py-2 text-sm font-bold transition ${
              mode === "register"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode("register")}
            type="button"
          >
            ثبت نام
          </button>
        </div>

        {error && (
          <KoochAlert className="mt-4" variant="destructive">
            {error}
          </KoochAlert>
        )}

        {mode === "login" ? (
          <>
            <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
              <button
                className={`rounded-md px-3 py-2 text-sm font-bold transition ${
                  method === "password"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setMethod("password")}
                type="button"
              >
                رمز عبور
              </button>
              <button
                className={`rounded-md px-3 py-2 text-sm font-bold transition ${
                  method === "otp"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setMethod("otp")}
                type="button"
              >
                رمز یکبار مصرف
              </button>
            </div>

            {method === "password" ? (
              <form className="mt-6 grid gap-4" onSubmit={submitPassword}>
                <KoochField label="ایمیل یا شماره موبایل" required>
                  <KoochInput
                    dir="ltr"
                    onChange={(event) => setIdentifier(event.target.value)}
                    required
                    value={identifier}
                  />
                </KoochField>
                <KoochField label="رمز عبور" required>
                  <KoochInput
                    dir="ltr"
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type="password"
                    value={password}
                  />
                </KoochField>
                <KoochButton className="w-full" loading={loading} type="submit">
                  ورود
                </KoochButton>
              </form>
            ) : (
              <form className="mt-6 grid gap-4" onSubmit={submitOtp}>
                <KoochField label="شماره موبایل" required>
                  <KoochInput
                    dir="ltr"
                    onChange={(event) => setMobile(event.target.value)}
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
                    dir="ltr"
                    inputMode="numeric"
                    onChange={(event) => setOtpCode(event.target.value)}
                    required
                    value={otpCode}
                  />
                </KoochField>
                <KoochButton className="w-full" loading={loading} type="submit">
                  ورود
                </KoochButton>
              </form>
            )}
          </>
        ) : registrationOtpVisible ? (
          <form className="mt-6 grid gap-4" onSubmit={verifyRegistration}>
            <KoochAlert variant="success">
              حساب شما ایجاد شد. برای فعال‌سازی، رمز یکبار مصرف را وارد کنید.
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
                dir="ltr"
                inputMode="numeric"
                onChange={(event) => setRegistrationOtp(event.target.value)}
                required
                value={registrationOtp}
              />
            </KoochField>
            <KoochButton className="w-full" loading={loading} type="submit">
              تایید و ورود
            </KoochButton>
          </form>
        ) : (
          <form className="mt-6 grid gap-4" onSubmit={submitRegistration}>
            <div className="grid gap-4 sm:grid-cols-2">
              <KoochField label="نام" required>
                <KoochInput
                  onChange={(event) => setFirstName(event.target.value)}
                  required
                  value={firstName}
                />
              </KoochField>
              <KoochField label="نام خانوادگی" required>
                <KoochInput
                  onChange={(event) => setLastName(event.target.value)}
                  required
                  value={lastName}
                />
              </KoochField>
            </div>
            <KoochField label="شماره موبایل" required>
              <KoochInput
                dir="ltr"
                onChange={(event) => setRegisterMobile(event.target.value)}
                required
                value={registerMobile}
              />
            </KoochField>
            <KoochField helperText="اختیاری، اما پیشنهاد می‌شود." label="ایمیل">
              <KoochInput
                dir="ltr"
                onChange={(event) => setRegisterEmail(event.target.value)}
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
                dir="ltr"
                minLength={8}
                onChange={(event) => setRegisterPassword(event.target.value)}
                required
                type="password"
                value={registerPassword}
              />
            </KoochField>
            <KoochField label="تکرار رمز عبور" required>
              <KoochInput
                dir="ltr"
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </KoochField>
            <KoochButton className="w-full" loading={loading} type="submit">
              ثبت نام
            </KoochButton>
          </form>
        )}
      </KoochCard>
    </main>
  );
}
