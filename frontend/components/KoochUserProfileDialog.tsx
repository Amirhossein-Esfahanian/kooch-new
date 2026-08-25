"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { KoochButton } from "@/components/KoochButton";
import { KoochCheckbox } from "@/components/KoochCheckbox";
import { KoochDialog } from "@/components/KoochDialog";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import {
  KoochField,
  KoochInput,
  KoochSelect,
} from "@/components/KoochFormControls";

type ProfileForm = {
  avatar: string;
  name: string;
  mobile: string;
  email: string;
  password: string;
  passwordConfirm: string;
  language: "fa" | "en" | "ar";
  theme: "ocean" | "forest" | "royal" | "sunset";
  emailNotifications: boolean;
  smsNotifications: boolean;
  inAppNotifications: boolean;
};

const storageKey = "kooch_user_profile";
const themeKey = "kooch_theme";

const defaultForm: ProfileForm = {
  avatar: "",
  name: "",
  mobile: "",
  email: "",
  password: "",
  passwordConfirm: "",
  language: "fa",
  theme: "ocean",
  emailNotifications: true,
  smsNotifications: true,
  inAppNotifications: true,
};

function readProfile(sessionName: string): ProfileForm {
  if (typeof window === "undefined") return defaultForm;

  const savedProfile = localStorage.getItem(storageKey);
  const savedTheme = localStorage.getItem(themeKey);

  try {
    const parsed = savedProfile
      ? (JSON.parse(savedProfile) as Partial<ProfileForm>)
      : {};

    return {
      ...defaultForm,
      ...parsed,
      name: parsed.name || sessionName || defaultForm.name,
      password: "",
      passwordConfirm: "",
      theme:
        savedTheme === "forest" ||
        savedTheme === "royal" ||
        savedTheme === "sunset" ||
        savedTheme === "ocean"
          ? savedTheme
          : parsed.theme || defaultForm.theme,
    };
  } catch {
    return {
      ...defaultForm,
      name: sessionName || defaultForm.name,
    };
  }
}

function initials(name: string) {
  const cleanName = name.trim();
  return cleanName ? cleanName.slice(0, 2) : "ک";
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

  useEffect(() => {
    if (open) {
      setForm(readProfile(user?.fullName ?? ""));
    }
  }, [open, user?.fullName]);

  const avatarPreview = useMemo(() => form.avatar.trim(), [form.avatar]);

  function update<Key extends keyof ProfileForm>(
    key: Key,
    value: ProfileForm[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const passwordError = form.password ? validatePassword(form.password) : "";
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    if (form.password !== form.passwordConfirm) {
      toast.error("تکرار رمز عبور با رمز عبور یکسان نیست.");
      return;
    }

    setSaving(true);
    try {
      const { password, passwordConfirm, ...profileToStore } = form;
      localStorage.setItem(storageKey, JSON.stringify(profileToStore));
      localStorage.setItem(themeKey, form.theme);
      document.documentElement.dataset.theme = form.theme;
      toast.success("پروفایل ذخیره شد");
      onOpenChange(false);
      setForm((current) => ({
        ...current,
        password: "",
        passwordConfirm: "",
      }));
    } catch {
      toast.error("ذخیره پروفایل انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <KoochDialog
      description="اطلاعات حساب، ترجیحات ظاهری و اعلان‌های پنل را تنظیم کنید."
      footer={
        <>
          <KoochButton
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            لغو
          </KoochButton>
          <KoochButton form="kooch-profile-form" loading={saving} type="submit">
            ذخیره پروفایل
          </KoochButton>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="md"
      title="پروفایل کاربر"
    >
      <form className="grid gap-6" id="kooch-profile-form" onSubmit={submit}>
        <section className="grid gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="grid justify-items-center gap-2">
            <div className="grid h-24 w-24 overflow-hidden rounded-full border border-border bg-card text-card-foreground">
              {avatarPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="Avatar"
                  className="h-full w-full object-cover"
                  src={avatarPreview}
                />
              ) : (
                <span className="grid h-full w-full place-items-center bg-primary text-2xl font-bold text-primary-foreground">
                  {initials(form.name)}
                </span>
              )}
            </div>
            <span className="text-xs font-semibold text-muted-foreground">
              تصویر پروفایل
            </span>
          </div>
          <KoochField
            helperText="آدرس تصویر را وارد کنید. آپلود واقعی آواتار بعداً می‌تواند به API وصل شود."
            label="Avatar"
          >
            <KoochInput
              dir="ltr"
              onChange={(event) => update("avatar", event.target.value)}
              placeholder="https://..."
              value={form.avatar}
            />
          </KoochField>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <KoochField label="Name" required>
            <KoochInput
              onChange={(event) => update("name", event.target.value)}
              required
              value={form.name}
            />
          </KoochField>
          <KoochField label="Mobile">
            <KoochInput
              dir="ltr"
              onChange={(event) => update("mobile", event.target.value)}
              value={form.mobile}
            />
          </KoochField>
          <KoochField label="Email">
            <KoochInput
              dir="ltr"
              onChange={(event) => update("email", event.target.value)}
              type="email"
              value={form.email}
            />
          </KoochField>
          <KoochField label="Language">
            <KoochSelect
              onChange={(event) =>
                update(
                  "language",
                  event.target.value as ProfileForm["language"],
                )
              }
              value={form.language}
            >
              <option value="fa">فارسی</option>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </KoochSelect>
          </KoochField>
          <KoochField
            helperText="حداقل ۸ کاراکتر، شامل حرف کوچک انگلیسی و عدد."
            label="Password"
          >
            <KoochInput
              autoComplete="new-password"
              onChange={(event) => update("password", event.target.value)}
              placeholder="برای تغییر رمز عبور پر کنید"
              type="password"
              value={form.password}
            />
          </KoochField>
          <KoochField label="Confirm password">
            <KoochInput
              autoComplete="new-password"
              onChange={(event) =>
                update("passwordConfirm", event.target.value)
              }
              type="password"
              value={form.passwordConfirm}
            />
          </KoochField>
        </section>

        <section className="grid gap-4 rounded-lg border border-border bg-card p-4">
          <KoochField label="Theme">
            <KoochSelect
              onChange={(event) =>
                update("theme", event.target.value as ProfileForm["theme"])
              }
              value={form.theme}
            >
              <option value="ocean">Ocean</option>
              <option value="forest">Forest</option>
              <option value="royal">Royal</option>
              <option value="sunset">Sunset</option>
            </KoochSelect>
          </KoochField>
        </section>

        <section className="grid gap-3 rounded-lg border border-border bg-card p-4">
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Notification preferences
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              روش‌های دریافت اعلان‌های پنل را انتخاب کنید.
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
      </form>
    </KoochDialog>
  );
}
