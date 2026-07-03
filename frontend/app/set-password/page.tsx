"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochField, KoochInput } from "@/components/KoochFormControls";

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<SetPasswordFallback />}>
      <SetPasswordForm />
    </Suspense>
  );
}

function SetPasswordFallback() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <KoochCard className="mx-auto max-w-md" padding="lg" variant="elevated">
        <p className="text-sm font-semibold text-muted-foreground">
          در حال بارگذاری...
        </p>
      </KoochCard>
    </main>
  );
}

function SetPasswordForm() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!token) {
      const message = "لینک تنظیم رمز عبور معتبر نیست.";
      setError(message);
      toast.error(message);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/backend/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword,
          confirmPassword,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "تنظیم رمز عبور انجام نشد.");
      }

      setDone(true);
      toast.success("رمز عبور با موفقیت تنظیم شد.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "تنظیم رمز عبور انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <KoochCard className="mx-auto max-w-md" padding="lg" variant="elevated">
        <div className="mb-6 text-right">
          <p className="text-sm font-bold text-primary">دعوت کاربری</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">
            تنظیم رمز عبور
          </h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            برای فعال شدن حساب، رمز عبور ثابت خود را وارد کنید.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            {error}
          </div>
        )}

        {done ? (
          <div className="grid gap-4">
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm font-semibold text-foreground">
              حساب شما فعال شد و از این پس می‌توانید با رمز عبور وارد شوید.
            </div>
            <Link
              className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-[var(--primary-hover)] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              href="/login"
            >
              رفتن به ورود
            </Link>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            <KoochField
              helperText="حداقل ۸ کاراکتر همراه با حرف بزرگ، حرف کوچک و عدد."
              label="رمز عبور جدید"
              required
            >
              <KoochInput
                dir="ltr"
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
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
            <KoochButton className="w-full" loading={saving} type="submit">
              ثبت رمز عبور
            </KoochButton>
          </form>
        )}
      </KoochCard>
    </main>
  );
}
