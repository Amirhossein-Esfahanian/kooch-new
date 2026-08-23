"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochField, KoochInput } from "@/components/KoochFormControls";
import {
  type AuthSessionContextValue,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { apiRequest, ApiRequestError, setToken } from "@/lib/owner-api";

type IdentityStage = "mobile" | "registration" | "otp";

interface RequestOtpResponse {
  sent: boolean;
  requiresRegistration: boolean;
  expiresAtUtc: string | null;
  devOtpCode?: string | null;
}

interface AuthResponse {
  token: string;
}

export function hasCompleteCheckoutIdentity(
  auth: Pick<AuthSessionContextValue, "authenticated" | "user">,
) {
  return Boolean(
    auth.authenticated &&
      auth.user?.phoneNumber?.trim() &&
      auth.user.firstName.trim() &&
      auth.user.lastName.trim(),
  );
}

export function CheckoutIdentityStep({
  interruptionMessage,
  onAuthenticated,
}: {
  interruptionMessage?: string | null;
  onAuthenticated: () => void;
}) {
  const auth = useAuthSession();
  const router = useRouter();
  const [stage, setStage] = useState<IdentityStage>("mobile");
  const [mobile, setMobile] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [expiresAtUtc, setExpiresAtUtc] = useState<string | null>(null);
  const [devOtpCode, setDevOtpCode] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    if (cooldownSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setCooldownSeconds((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  useEffect(() => {
    if (!auth.authenticated || !auth.user) return;

    setProfileFirstName(auth.user.firstName);
    setProfileLastName(auth.user.lastName);
    setProfileError("");
  }, [auth.authenticated, auth.user]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileSaving) return;

    if (!profileFirstName.trim() || !profileLastName.trim()) {
      setProfileError("نام و نام خانوادگی را کامل وارد کنید.");
      return;
    }

    setProfileSaving(true);
    setProfileError("");
    try {
      await apiRequest("/auth/me/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: profileFirstName,
          lastName: profileLastName,
        }),
      });
      const session = await auth.refreshSession();
      if (
        !session ||
        !hasCompleteCheckoutIdentity({ authenticated: true, user: session.user })
      ) {
        throw new Error("PROFILE_REFRESH_INCOMPLETE");
      }

      onAuthenticated();
      toast.success("اطلاعات حساب تکمیل شد.");
    } catch (caught) {
      setProfileError(profileUpdateErrorMessage(caught));
    } finally {
      setProfileSaving(false);
    }
  }

  if (auth.loading) {
    return (
      <div aria-live="polite" className="py-8 text-sm font-bold text-muted-foreground" role="status">
        در حال بررسی حساب کاربری شما...
      </div>
    );
  }

  if (auth.authenticated && auth.user) {
    const complete = hasCompleteCheckoutIdentity(auth);
    if (complete) return null;

    return (
      <div>
        <h2 className="text-lg font-black text-foreground" id="checkout-step-title">
          تکمیل اطلاعات حساب
        </h2>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          برای ادامه رزرو، نام و نام خانوادگی خود را تکمیل کنید.
        </p>
        {profileError ? (
          <KoochAlert className="mt-4" title="ذخیره اطلاعات انجام نشد" variant="destructive">
            {profileError}
          </KoochAlert>
        ) : null}
        <form className="mt-4 grid gap-4" onSubmit={saveProfile}>
          <div className="grid gap-4 sm:grid-cols-2">
            <KoochField label="نام" required>
              <KoochInput
                autoComplete="given-name"
                maxLength={100}
                onChange={(event) => setProfileFirstName(event.target.value)}
                required
                value={profileFirstName}
              />
            </KoochField>
            <KoochField label="نام خانوادگی" required>
              <KoochInput
                autoComplete="family-name"
                maxLength={100}
                onChange={(event) => setProfileLastName(event.target.value)}
                required
                value={profileLastName}
              />
            </KoochField>
          </div>
          <KoochButton className="sm:w-fit sm:min-w-44" loading={profileSaving} type="submit">
            ذخیره و ادامه
          </KoochButton>
        </form>
      </div>
    );
  }

  async function requestOtp() {
    if (sending || cooldownSeconds > 0) return;

    if (!mobile.trim()) {
      setError("شماره موبایل را وارد کنید.");
      return;
    }
    if (
      stage === "registration" &&
      (!firstName.trim() || !lastName.trim())
    ) {
      setError("نام و نام خانوادگی را کامل وارد کنید.");
      return;
    }

    setSending(true);
    setError("");
    try {
      const response = await apiRequest<RequestOtpResponse>("/auth/request-otp", {
        method: "POST",
        body: JSON.stringify({
          mobile,
          allowRegistration: true,
          firstName: stage === "registration" ? firstName : null,
          lastName: stage === "registration" ? lastName : null,
          email: stage === "registration" ? email || null : null,
        }),
      });

      if (response.requiresRegistration) {
        setStage("registration");
        return;
      }
      if (!response.sent) {
        throw new Error("ارسال کد تأیید انجام نشد. دوباره تلاش کنید.");
      }

      setStage("otp");
      setExpiresAtUtc(response.expiresAtUtc);
      setCooldownSeconds(60);
      if (response.devOtpCode && process.env.NODE_ENV !== "production") {
        setDevOtpCode(response.devOtpCode);
        setOtpCode(response.devOtpCode);
      }
      toast.success("کد تأیید ارسال شد.");
    } catch (caught) {
      setError(otpRequestErrorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifying) return;
    if (otpCode.trim().length < 4) {
      setError("کد تأیید را کامل وارد کنید.");
      return;
    }

    setVerifying(true);
    setError("");
    try {
      const response = await apiRequest<AuthResponse>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ mobile, code: otpCode }),
      });
      setToken(response.token);
      const session = await auth.refreshSession();
      if (!session) {
        throw new Error("اطلاعات حساب کاربری دریافت نشد.");
      }

      onAuthenticated();
      toast.success("شماره موبایل تأیید شد.");
    } catch (caught) {
      setError(otpVerificationErrorMessage(caught));
    } finally {
      setVerifying(false);
    }
  }

  function changeMobile() {
    setStage("mobile");
    setOtpCode("");
    setDevOtpCode("");
    setExpiresAtUtc(null);
    setCooldownSeconds(0);
    setError("");
  }

  return (
    <div>
      <h2 className="text-xl font-black text-foreground" id="checkout-step-title">
        اطلاعات رزروکننده
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
        با تأیید شماره موبایل، رزرو به همان حساب کاربری شما متصل می‌شود.
      </p>

      {interruptionMessage ? (
        <KoochAlert className="mt-6" title="تأیید هویت لازم است" variant="warning">
          {interruptionMessage}
        </KoochAlert>
      ) : null}

      {error && stage !== "otp" ? (
        <KoochAlert className="mt-6" title="ادامه فرایند ممکن نشد" variant="destructive">
          {error}
        </KoochAlert>
      ) : null}

      {stage === "otp" ? (
        <form className="mt-6 grid gap-4" onSubmit={verifyOtp}>
          <KoochAlert title="کد تأیید ارسال شد" variant="info">
            کد ارسال‌شده به <span dir="ltr">{formatPersianDigits(mobile)}</span> را وارد کنید.
          </KoochAlert>
          {devOtpCode && process.env.NODE_ENV !== "production" ? (
            <KoochAlert variant="default">
              کد توسعه: <span dir="ltr">{formatPersianDigits(devOtpCode)}</span>
            </KoochAlert>
          ) : null}
          <KoochField
            error={error || undefined}
            helperText={
              expiresAtUtc
                ? `اعتبار کد تا ${new Date(expiresAtUtc).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`
                : undefined
            }
            label="کد تأیید"
            required
          >
            <KoochInput
              autoComplete="one-time-code"
              autoFocus
              dir="ltr"
              inputMode="numeric"
              maxLength={8}
              minLength={4}
              onChange={(event) => setOtpCode(event.target.value)}
              placeholder="کد تأیید"
              required
              value={otpCode}
            />
          </KoochField>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <KoochButton className="sm:min-w-40" loading={verifying} type="submit">
              تأیید و ادامه
            </KoochButton>
            <KoochButton onClick={changeMobile} type="button" variant="ghost">
              تغییر شماره موبایل
            </KoochButton>
            <KoochButton
              disabled={cooldownSeconds > 0}
              loading={sending}
              onClick={() => void requestOtp()}
              type="button"
              variant="outline"
            >
              {cooldownSeconds > 0
                ? `ارسال مجدد تا ${formatPersianDigits(String(cooldownSeconds))} ثانیه`
                : "ارسال مجدد کد"}
            </KoochButton>
          </div>
        </form>
      ) : (
        <form
          className="mt-6 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void requestOtp();
          }}
        >
          <KoochField label="شماره موبایل" required>
            <KoochInput
              autoComplete="tel"
              autoFocus
              dir="ltr"
              inputMode="tel"
              maxLength={30}
              onChange={(event) => setMobile(event.target.value)}
              placeholder="مثلاً ۰۹۱۲۳۴۵۶۷۸۹"
              required
              value={mobile}
            />
          </KoochField>

          {stage === "registration" ? (
            <>
              <KoochAlert title="تکمیل اطلاعات حساب" variant="info">
                برای این شماره حساب فعالی پیدا نشد. اطلاعات زیر را وارد کنید تا حساب واحد Kooch ساخته و کد تأیید ارسال شود.
              </KoochAlert>
              <div className="grid gap-4 sm:grid-cols-2">
                <KoochField label="نام" required>
                  <KoochInput
                    autoComplete="given-name"
                    maxLength={100}
                    onChange={(event) => setFirstName(event.target.value)}
                    required
                    value={firstName}
                  />
                </KoochField>
                <KoochField label="نام خانوادگی" required>
                  <KoochInput
                    autoComplete="family-name"
                    maxLength={100}
                    onChange={(event) => setLastName(event.target.value)}
                    required
                    value={lastName}
                  />
                </KoochField>
              </div>
              <KoochField helperText="اختیاری" label="ایمیل">
                <KoochInput
                  autoComplete="email"
                  dir="ltr"
                  maxLength={320}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  value={email}
                />
              </KoochField>
            </>
          ) : null}

          <KoochButton className="sm:w-fit sm:min-w-48" loading={sending} type="submit">
            {stage === "registration" ? "ساخت حساب و ارسال کد" : "ارسال کد تأیید"}
          </KoochButton>
          <KoochButton
            className="sm:w-fit"
            onClick={() =>
              router.push(
                `/login?returnTo=${encodeURIComponent("/booking/checkout?step=information")}`,
              )
            }
            type="button"
            variant="ghost"
          >
            ورود به حساب از مسیر دیگر
          </KoochButton>
        </form>
      )}
    </div>
  );
}

function otpRequestErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 429 || /wait|صبر/i.test(error.message)) {
      return "برای دریافت دوباره کد، ۶۰ ثانیه صبر کنید.";
    }
    if (error.status >= 500) {
      return "ارسال کد تأیید موقتاً ممکن نیست. کمی بعد دوباره تلاش کنید.";
    }
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : "ارسال کد تأیید انجام نشد. دوباره تلاش کنید.";
}

function otpVerificationErrorMessage(error: unknown) {
  const status =
    error instanceof ApiRequestError
      ? error.status
      : typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : null;
  if (status === 401) {
    return "کد تأیید نامعتبر یا منقضی شده است. کد را بررسی یا دوباره دریافت کنید.";
  }
  return error instanceof Error
    ? error.message
    : "تأیید شماره موبایل انجام نشد. دوباره تلاش کنید.";
}

function profileUpdateErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 400) {
      return "نام و نام خانوادگی را کامل و صحیح وارد کنید.";
    }
    if (error.status === 401) {
      return "نشست شما منقضی شده است. دوباره وارد حساب شوید.";
    }
  }

  return "ذخیره اطلاعات حساب موقتاً ممکن نیست. اطلاعات واردشده حفظ شده است؛ دوباره تلاش کنید.";
}

export function formatPersianDigits(value: string) {
  const digits = "۰۱۲۳۴۵۶۷۸۹";
  return value.replace(/\d/g, (digit) => digits[Number(digit)]);
}
