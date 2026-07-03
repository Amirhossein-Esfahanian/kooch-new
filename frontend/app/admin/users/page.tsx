"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import {
  KoochInput,
  KoochSelect,
} from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  AdminUserResponse,
  apiRequest,
  getToken,
  UserRole,
} from "@/lib/owner-api";

const roles: UserRole[] = [
  "SuperAdmin",
  "AdminAssistant",
  "Owner",
  "OwnerAssistant",
  "Client",
];
const roleLabels: Record<UserRole, string> = {
  SuperAdmin: "مدیر ارشد",
  AdminAssistant: "دستیار مدیر",
  Owner: "مالک اقامتگاه",
  OwnerAssistant: "همکار مالک",
  Client: "مسافر",
};

type UserForm = {
  id: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: UserRole;
  parentUserId: string;
  propertyId: string;
};

const emptyForm: UserForm = {
  id: null,
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
  password: "",
  role: "Client",
  parentUserId: "",
  propertyId: "",
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [setupLink, setSetupLink] = useState("");

  async function load() {
    setUsers(await apiRequest<AdminUserResponse[]>("/admin/users"));
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    load()
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [router]);

  function edit(user: AdminUserResponse) {
    setForm({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber ?? "",
      password: "",
      role: user.role,
      parentUserId: user.parentUserId?.toString() ?? "",
      propertyId: "",
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phoneNumber: form.phoneNumber || null,
        password: form.id && form.password ? form.password : null,
        role: form.role,
        parentUserId: form.parentUserId ? Number(form.parentUserId) : null,
        propertyId: form.propertyId ? Number(form.propertyId) : null,
      };
      const saved = await apiRequest<AdminUserResponse>(
        form.id ? `/admin/users/${form.id}` : "/admin/users",
        {
          method: form.id ? "PUT" : "POST",
          body: JSON.stringify(body),
        },
      );
      if (
        !form.id &&
        saved.temporarySetupLink &&
        process.env.NODE_ENV !== "production"
      ) {
        setSetupLink(saved.temporarySetupLink);
      }
      setForm(emptyForm);
      await load();
      toast.success(form.id ? "کاربر ذخیره شد" : "دعوت کاربر ثبت شد");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "ذخیره کاربر انجام نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function setActive(user: AdminUserResponse, active: boolean) {
    setError("");
    try {
      const updated = await apiRequest<AdminUserResponse>(
        `/admin/users/${user.id}/${active ? "activate" : "deactivate"}`,
        { method: "PUT" },
      );
      setUsers((current) =>
        current.map((item) => (item.id === user.id ? updated : item)),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تغییر وضعیت کاربر انجام نشد.",
      );
    }
  }

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          eyebrow="پنل مدیریت"
          title="مدیریت کاربران"
        />

        {error && (
          <KoochCard className="border-destructive/30 bg-destructive/10 text-destructive" padding="sm">
            <p className="text-sm font-bold">{error}</p>
          </KoochCard>
        )}

        {setupLink && process.env.NODE_ENV !== "production" && (
          <KoochCard className="border-primary/30 bg-primary/10" padding="sm">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="text-sm font-black text-foreground">
                  لینک تنظیم رمز عبور آماده است.
                </p>
                <p className="mt-1 break-all text-xs text-muted-foreground" dir="ltr">
                  {setupLink}
                </p>
              </div>
              <KoochButton
                onClick={() => window.open(setupLink, "_blank", "noopener,noreferrer")}
                size="sm"
                type="button"
                variant="outline"
              >
                مشاهده لینک تنظیم رمز
              </KoochButton>
            </div>
          </KoochCard>
        )}

        <KoochCard padding="none" variant="elevated">
          <form className="grid gap-4 p-5" onSubmit={submit}>
            <h2 className="text-xl font-black text-foreground">
              {form.id ? "ویرایش کاربر" : "ایجاد کاربر"}
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              <KoochInput
                onChange={(event) =>
                  setForm({ ...form, firstName: event.target.value })
                }
                placeholder="نام"
                required
                value={form.firstName}
              />
              <KoochInput
                onChange={(event) =>
                  setForm({ ...form, lastName: event.target.value })
                }
                placeholder="نام خانوادگی"
                required
                value={form.lastName}
              />
              <KoochInput
                className={form.id ? "text-left" : "hidden"}
                dir="ltr"
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
                placeholder="ایمیل"
                required
                type="email"
                value={form.email}
              />
              <KoochInput
                className="text-left"
                dir="ltr"
                onChange={(event) =>
                  setForm({ ...form, phoneNumber: event.target.value })
                }
                placeholder="شماره تماس"
                value={form.phoneNumber}
              />
              <KoochInput
                className="text-left"
                dir="ltr"
                minLength={8}
                onChange={(event) =>
                  setForm({ ...form, password: event.target.value })
                }
                placeholder={form.id ? "رمز جدید اختیاری" : "رمز عبور"}
                disabled={!form.id}
                type="password"
                value={form.password}
              />
              <KoochSelect
                onChange={(event) =>
                  setForm({ ...form, role: event.target.value as UserRole })
                }
                value={form.role}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </KoochSelect>
              <KoochSelect
                onChange={(event) =>
                  setForm({ ...form, parentUserId: event.target.value })
                }
                value={form.parentUserId}
              >
                <option value="">والد کاربر</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName || user.email}
                  </option>
                ))}
              </KoochSelect>
              <KoochInput
                min="1"
                onChange={(event) =>
                  setForm({ ...form, propertyId: event.target.value })
                }
                placeholder="شناسه اقامتگاه برای همکار مالک"
                type="number"
                value={form.propertyId}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <KoochButton loading={saving} type="submit">
                {saving ? "در حال ذخیره..." : "ذخیره کاربر"}
              </KoochButton>
              {form.id && (
                <KoochButton
                  onClick={() => setForm(emptyForm)}
                  type="button"
                  variant="outline"
                >
                  لغو ویرایش
                </KoochButton>
              )}
            </div>
          </form>
        </KoochCard>

        {loading && (
          <KoochCard>
            <p className="text-sm font-semibold text-muted-foreground">
              در حال بارگذاری کاربران...
            </p>
          </KoochCard>
        )}
        <div className="grid gap-3">
          {users.map((user) => (
            <KoochCard
              className="flex flex-wrap items-center justify-between gap-4"
              key={user.id}
              padding="sm"
              variant="elevated"
            >
              <div>
                <p className="font-black text-foreground">
                  #{user.id} · {user.fullName || user.email}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {user.email} · {roleLabels[user.role]} · والد:{" "}
                  {user.parentUserName ?? "-"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {user.isActive ? "فعال" : "غیرفعال"} ·{" "}
                  {new Date(user.createdAtUtc).toLocaleDateString("fa-IR")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <KoochButton
                  onClick={() => edit(user)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  ویرایش
                </KoochButton>
                <KoochButton disabled size="sm" type="button" variant="outline">
                  بازنشانی رمز عبور
                </KoochButton>
                <KoochButton
                  onClick={() => setActive(user, !user.isActive)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {user.isActive ? "غیرفعال" : "فعال"}
                </KoochButton>
              </div>
            </KoochCard>
          ))}
        </div>
      </main>
    </AdminLayout>
  );
}
