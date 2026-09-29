"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { KoochButton } from "@/components/KoochButton";
import { KoochCheckbox } from "@/components/KoochCheckbox";
import { KoochDialog } from "@/components/KoochDialog";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochField, KoochInput } from "@/components/KoochFormControls";
import { apiRequest, getToken } from "@/lib/owner-api";

type ProfileForm = {
  name: string;
  mobile: string;
  email: string;
  emailNotifications: boolean;
  smsNotifications: boolean;
  inAppNotifications: boolean;
};

const storageKey = "kooch_user_profile";

const defaultForm: ProfileForm = {
  name: "",
  mobile: "",
  email: "",
  emailNotifications: true,
  smsNotifications: true,
  inAppNotifications: true,
};

function readProfile(sessionName: string, sessionEmail: string): ProfileForm {
  if (typeof window === "undefined") {
    return {
      ...defaultForm,
      name: sessionName,
      email: sessionEmail,
    };
  }

  try {
    const savedProfile = localStorage.getItem(storageKey);
    const parsed = savedProfile
      ? (JSON.parse(savedProfile) as Partial<ProfileForm>)
      : {};

    return {
      name: parsed.name || sessionName || defaultForm.name,
      mobile: typeof parsed.mobile === "string" ? parsed.mobile : "",
      email: parsed.email || sessionEmail || defaultForm.email,
      emailNotifications:
        typeof parsed.emailNotifications === "boolean"
          ? parsed.emailNotifications
          : defaultForm.emailNotifications,
      smsNotifications:
        typeof parsed.smsNotifications === "boolean"
          ? parsed.smsNotifications
          : defaultForm.smsNotifications,
      inAppNotifications:
        typeof parsed.inAppNotifications === "boolean"
          ? parsed.inAppNotifications
          : defaultForm.inAppNotifications,
    };
  } catch {
    return {
      ...defaultForm,
      name: sessionName || defaultForm.name,
      email: sessionEmail || defaultForm.email,
    };
  }
}

function initials(name: string, firstName?: string, lastName?: string) {
  const parts = firstName && lastName
    ? [firstName.trim(), lastName.trim()].filter(Boolean)
    : name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "ک";
  return [Array.from(parts[0])[0], ...(parts.length > 1 ? [Array.from(parts[parts.length - 1])[0]] : [])].join(" ");
}

export function KoochUserProfileDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { user } = useAuthSession();
  const [form, setForm] = useState<ProfileForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPending, setAvatarPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const avatarRequestVersion = useRef(0);

  useEffect(() => () => {
    if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  }, [avatarUrl]);

  useEffect(() => {
    if (open) {
      setForm(readProfile(user?.fullName ?? "", user?.email ?? ""));
    }
  }, [open, user?.email, user?.fullName]);

  async function loadAvatar(signal?: AbortSignal) {
    const version = ++avatarRequestVersion.current;
    const token = getToken();
    if (!token) { if (version === avatarRequestVersion.current) setAvatarUrl(null); return; }
    const response = await fetch("/api/backend/account/profile/avatar", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal,
    });
    if (response.status === 404) { if (version === avatarRequestVersion.current) setAvatarUrl(null); return; }
    if (!response.ok) throw new Error("بارگذاری تصویر پروفایل انجام نشد.");
    const blob = await response.blob();
    if (!signal?.aborted && version === avatarRequestVersion.current) setAvatarUrl(URL.createObjectURL(blob));
  }

  useEffect(() => {
    if (!open || !user) { avatarRequestVersion.current++; setAvatarUrl(null); return; }
    const controller = new AbortController();
    setAvatarUrl(null);
    void loadAvatar(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "بارگذاری تصویر پروفایل انجام نشد.");
    });
    return () => { avatarRequestVersion.current++; controller.abort(); };
    // The authenticated User and open state define this avatar lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.userId]);

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || avatarPending) return;
    setAvatarPending(true);
    try {
      const body = new FormData();
      body.append("file", file);
      await apiRequest<void>("/account/profile/avatar", { method: "PUT", body });
      await loadAvatar();
      toast.success("تصویر پروفایل ذخیره شد.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ذخیره تصویر پروفایل انجام نشد.");
    } finally {
      event.target.value = "";
      setAvatarPending(false);
    }
  }

  async function deleteAvatar() {
    if (avatarPending) return;
    setAvatarPending(true);
    try {
      await apiRequest<void>("/account/profile/avatar", { method: "DELETE" });
      avatarRequestVersion.current++;
      setAvatarUrl(null);
      toast.success("تصویر پروفایل حذف شد.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "حذف تصویر پروفایل انجام نشد.");
    } finally {
      setAvatarPending(false);
    }
  }

  function update<Key extends keyof ProfileForm>(
    key: Key,
    value: ProfileForm[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim()) {
      toast.error("نام کاربر را وارد کنید.");
      return;
    }

    setSaving(true);
    try {
      const profileToStore: ProfileForm = {
        ...form,
        name: form.name.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim(),
      };

      localStorage.setItem(storageKey, JSON.stringify(profileToStore));
      setForm(profileToStore);
      toast.success("تنظیمات پروفایل در این مرورگر ذخیره شد.");
      onOpenChange(false);
    } catch {
      toast.error("ذخیره تنظیمات پروفایل انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <KoochDialog
      description="اطلاعات حساب و روش‌های دریافت اعلان‌ها را مدیریت کنید."
      footer={
        <>
          <KoochButton
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            انصراف
          </KoochButton>
          <KoochButton form="kooch-profile-form" loading={saving} type="submit">
            ذخیره تغییرات
          </KoochButton>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="md"
      title="پروفایل کاربر"
    >
      <form
        className="grid gap-4"
        id="kooch-profile-form"
        onSubmit={submit}
      >
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center">
          <div className="grid h-20 w-20 shrink-0 overflow-hidden rounded-full border border-border bg-card text-card-foreground">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt="تصویر پروفایل"
                className="h-full w-full object-cover"
                src={avatarUrl}
              />
            ) : (
              <span className="grid h-full w-full place-items-center bg-primary text-xl font-bold text-primary-foreground">
                {initials(form.name, form.name === user?.fullName ? user?.firstName : undefined,
                  form.name === user?.fullName ? user?.lastName : undefined)}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-foreground">
              {form.name.trim() || user?.fullName || "کاربر کوچ"}
            </p>
            <p
              className="mt-1 truncate text-sm text-muted-foreground"
              dir="ltr"
            >
              {form.email.trim() || form.mobile.trim() || "اطلاعات تماس ثبت نشده"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                accept="image/jpeg,image/png,image/webp"
                aria-label="انتخاب تصویر پروفایل"
                className="sr-only"
                onChange={uploadAvatar}
                ref={fileInput}
                type="file"
              />
              <KoochButton disabled={avatarPending} onClick={() => fileInput.current?.click()} size="sm" type="button" variant="outline">
                انتخاب تصویر
              </KoochButton>
              {avatarUrl && (
                <KoochButton disabled={avatarPending} onClick={deleteAvatar} size="sm" type="button" variant="ghost">
                  حذف تصویر
                </KoochButton>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-border bg-card p-4">
          <div>
            <h3 className="text-sm font-bold text-foreground">اطلاعات حساب</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              اطلاعات اصلی حساب کاربری را در این بخش مشاهده و ویرایش کنید.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <KoochField className="md:col-span-2" label="نام و نام خانوادگی" required>
              <KoochInput
                onChange={(event) => update("name", event.target.value)}
                required
                value={form.name}
              />
            </KoochField>

            <KoochField label="شماره موبایل">
              <KoochInput
                dir="ltr"
                inputMode="tel"
                onChange={(event) => update("mobile", event.target.value)}
                value={form.mobile}
              />
            </KoochField>

            <KoochField label="ایمیل">
              <KoochInput
                dir="ltr"
                onChange={(event) => update("email", event.target.value)}
                type="email"
                value={form.email}
              />
            </KoochField>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-bold text-foreground">امنیت حساب</h3>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            تغییر رمز عبور هنوز به سرویس حساب متصل نشده است. برای جلوگیری از
            نمایش عملکرد غیرواقعی، فیلدهای رمز عبور از این فرم حذف شده‌اند.
          </p>
        </section>

        <section className="grid gap-3 rounded-lg border border-border bg-card p-4">
          <div>
            <h3 className="text-sm font-bold text-foreground">تنظیمات اعلان‌ها</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              روش‌های دریافت اعلان‌های حساب را انتخاب کنید.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <KoochCheckbox
              checked={form.inAppNotifications}
              label="اعلان داخل پنل"
              onChange={(event) =>
                update("inAppNotifications", event.target.checked)
              }
            />
            <KoochCheckbox
              checked={form.smsNotifications}
              label="پیامک"
              onChange={(event) =>
                update("smsNotifications", event.target.checked)
              }
            />
            <KoochCheckbox
              checked={form.emailNotifications}
              label="ایمیل"
              onChange={(event) =>
                update("emailNotifications", event.target.checked)
              }
            />
          </div>
        </section>

        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs leading-6 text-muted-foreground">
          در نسخه فعلی، تغییرات این فرم فقط در همین مرورگر ذخیره می‌شوند و هنوز
          جایگزین اطلاعات حساب ثبت‌شده در سرور نیستند.
        </p>
      </form>
    </KoochDialog>
  );
}
