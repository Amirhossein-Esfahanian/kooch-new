"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { resolveSessionDestination, useAuthSession } from "@/components/auth/AuthSessionProvider";
import { UserProfileAvatarProvider } from "@/components/auth/UserProfileAvatarProvider";
import { KoochUserProfileForm } from "@/components/KoochUserProfileForm";
import { KoochButton } from "@/components/KoochButton";
import { KoochField, KoochInput } from "@/components/KoochFormControls";
import { apiRequest } from "@/lib/owner-api";
import { AccountSkeleton } from "./AccountSkeleton";
import styles from "./GuestProfilePage.module.css";

export function GuestProfilePage() {
  const session = useAuthSession();
  const router = useRouter();
  const allowed = session.authenticated && session.workspaces.includes("account");
  useEffect(() => {
    if (session.loading) return;
    if (!session.authenticated) router.replace("/login?returnTo=%2Faccount%2Fprofile");
    else if (!allowed) router.replace(resolveSessionDestination(session));
  }, [allowed, router, session]);

  return <main dir="rtl" className={styles.page}>
    <header className={styles.header}><h1>پروفایل من</h1><p>تصویر پروفایل، اطلاعات نمایشی و تنظیمات اعلان‌ها را مدیریت کنید.</p></header>
    {(session.loading && !session.user) || !allowed ? <div role="status" aria-busy="true" className={styles.skeleton}>
      <span className="sr-only">در حال آماده‌سازی پروفایل…</span>
      <AccountSkeleton variant="block" /><AccountSkeleton variant="block" /><AccountSkeleton variant="block" />
    </div> : <UserProfileAvatarProvider>
      <GuestProfileNames key={`names-${session.user?.userId ?? "account"}`} />
      <KoochUserProfileForm key={`settings-${session.user?.userId ?? "account"}`} active actionsWhenDirty browserSettingsOnly onCancel={() => {}} onSaved={() => {}}>
        {({ form, actions }) => <div className={styles.editor}>{form}{actions && <footer className={styles.actions}>{actions}</footer>}</div>}
      </KoochUserProfileForm>
    </UserProfileAvatarProvider>}
  </main>;
}

function GuestProfileNames() {
  const { user, refreshSession } = useAuthSession();
  const [names, setNames] = useState(() => ({ firstName: user?.firstName ?? "", lastName: user?.lastName ?? "" }));
  const [saved, setSaved] = useState(names);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = names.firstName !== saved.firstName || names.lastName !== saved.lastName;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || inFlight.current) return;
    const payload = { firstName: names.firstName.trim(), lastName: names.lastName.trim() };
    if (!payload.firstName || !payload.lastName || payload.firstName.length > 100 || payload.lastName.length > 100) {
      setError("نام و نام خانوادگی الزامی هستند و هرکدام باید حداکثر ۱۰۰ نویسه باشند.");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await apiRequest<{ firstName: string; lastName: string }>("/auth/me/profile", {
        method: "PATCH", body: JSON.stringify(payload),
      });
      const next = { firstName: response.firstName, lastName: response.lastName };
      setNames(next);
      setSaved(next);
      toast.success("نام و نام خانوادگی ذخیره شد.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "ذخیره نام و نام خانوادگی انجام نشد.");
      inFlight.current = false;
      setPending(false);
      return;
    }
    try {
      if (!await refreshSession()) toast.error("نام ذخیره شد؛ تازه‌سازی اطلاعات حساب انجام نشد.");
    } catch {
      toast.error("نام ذخیره شد؛ تازه‌سازی اطلاعات حساب انجام نشد.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <form onSubmit={save} className="grid gap-4 rounded-lg border border-border bg-card p-4" aria-label="نام حساب کاربری">
    <div><h2 className="text-sm font-bold">نام حساب کاربری</h2><p className="mt-1 text-xs text-muted-foreground">نام و نام خانوادگی در حساب کوچ ذخیره می‌شوند؛ اطلاعات مهمان و رزروهای قبلی تغییر نمی‌کنند.</p></div>
    <div className="grid gap-4 md:grid-cols-2">
      {(["firstName", "lastName"] as const).map(field => <KoochField key={field} label={field === "firstName" ? "نام" : "نام خانوادگی"} required>
        <KoochInput required maxLength={100} value={names[field]} disabled={pending} aria-invalid={Boolean(error)} aria-describedby={error ? "profile-names-error" : undefined}
          onChange={event => { setNames(current => ({ ...current, [field]: event.target.value })); setError(null); }} />
      </KoochField>)}
    </div>
    {error && <p id="profile-names-error" role="alert" className="text-sm text-destructive">{error}</p>}
    {dirty && <footer className={styles.actions}>
      <KoochButton type="button" variant="outline" disabled={pending} onClick={() => { setNames(saved); setError(null); }}>انصراف</KoochButton>
      <KoochButton type="submit" loading={pending}>ذخیره تغییرات</KoochButton>
    </footer>}
  </form>;
}
