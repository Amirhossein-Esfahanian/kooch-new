"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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

export default function OwnerLoginPage() {
  const router = useRouter();
  const [method, setMethod] = useState<LoginMethod>("password");
  const [identifier, setIdentifier] = useState("admin@kooch.local");
  const [password, setPassword] = useState("Admin@12345");
  const [mobile, setMobile] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [devOtpCode, setDevOtpCode] = useState("");
  const [otpExpiresAt, setOtpExpiresAt] = useState("");
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

    const properties = await apiRequest<PropertyResponse[]>("/owner/properties");
    if (properties.length === 1) {
      localStorage.setItem(ownerPropertyKey, properties[0].id.toString());
      router.push(`/owner/properties/${properties[0].id}/dashboard`);
      return;
    }

    router.push("/owner/select-property");
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

  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground">
      <KoochCard className="mx-auto max-w-md" padding="lg" variant="elevated">
        <div className="text-right">
          <p className="text-sm font-bold text-primary">ورود</p>
          <h1 className="mt-2 text-3xl font-black text-foreground">
            ورود میزبان
          </h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            با ایمیل، شماره موبایل یا رمز یکبار مصرف وارد حساب شوید.
          </p>
        </div>

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
            رمز عبور ثابت
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

        {error && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            {error}
          </div>
        )}

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
              دریافت رمز یکبار مصرف
            </KoochButton>

            {devOtpCode && process.env.NODE_ENV !== "production" && (
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
                <p className="text-xs font-bold text-muted-foreground">
                  کد توسعه برای تست:
                </p>
                <p className="mt-1 text-lg font-black text-foreground" dir="ltr">
                  {devOtpCode}
                </p>
              </div>
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
      </KoochCard>
    </main>
  );
}
