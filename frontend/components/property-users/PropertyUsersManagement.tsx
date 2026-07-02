"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochInput, KoochSelect } from "@/components/KoochFormControls";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableEmpty,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";
import {
  apiRequest,
  PropertyUserResponse,
  PropertyUserRole,
  PropertyUserStatus,
} from "@/lib/owner-api";

const roleOptions: Array<{ value: PropertyUserRole; label: string }> = [
  { value: "Manager", label: "مدیر" },
  { value: "Reception", label: "پذیرش" },
  { value: "Accounting", label: "حسابداری" },
  { value: "Housekeeping", label: "خانه‌داری" },
  { value: "Custom", label: "سفارشی" },
];

const roleLabels: Record<PropertyUserRole, string> = {
  PropertyOwner: "مالک اقامتگاه",
  Manager: "مدیر",
  Reception: "پذیرش",
  Accounting: "حسابداری",
  Housekeeping: "خانه‌داری",
  Custom: "سفارشی",
};

const statusOptions: Array<{ value: PropertyUserStatus; label: string }> = [
  { value: "PendingInvitation", label: "در انتظار دعوت" },
  { value: "Active", label: "فعال" },
  { value: "Suspended", label: "تعلیق‌شده" },
];

const statusLabels: Record<PropertyUserStatus, string> = {
  PendingInvitation: "در انتظار دعوت",
  Active: "فعال",
  Suspended: "تعلیق‌شده",
};

type PropertyUserForm = {
  fullName: string;
  mobile: string;
  email: string;
  username: string;
  status: PropertyUserStatus;
  role: Exclude<PropertyUserRole, "PropertyOwner">;
  isActive: boolean;
};

const emptyForm: PropertyUserForm = {
  fullName: "",
  mobile: "",
  email: "",
  username: "",
  status: "PendingInvitation",
  role: "Manager",
  isActive: false,
};

function statusVariant(status: PropertyUserStatus) {
  if (status === "Active") return "success" as const;
  if (status === "PendingInvitation") return "warning" as const;
  return "destructive" as const;
}

function toForm(user: PropertyUserResponse): PropertyUserForm {
  return {
    fullName: user.fullName,
    mobile: user.mobile ?? "",
    email: user.email,
    username: user.username,
    status: user.status,
    role: user.role === "PropertyOwner" ? "Manager" : user.role,
    isActive: user.isActive,
  };
}

export function PropertyUsersManagement({
  propertyId,
}: {
  context?: "admin" | "owner";
  propertyId: number;
}) {
  const [users, setUsers] = useState<PropertyUserResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<PropertyUserResponse | null>(
    null,
  );
  const [form, setForm] = useState<PropertyUserForm>(emptyForm);

  const ownerCount = useMemo(
    () => users.filter((user) => user.role === "PropertyOwner").length,
    [users],
  );

  async function load() {
    setError("");
    setUsers(
      await apiRequest<PropertyUserResponse[]>(
        `/owner/properties/${propertyId}/users`,
      ),
    );
  }

  useEffect(() => {
    load()
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  function openCreate() {
    setEditingUser(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(user: PropertyUserResponse) {
    setEditingUser(user);
    setForm(toForm(user));
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = editingUser
        ? {
            ...form,
            mobile: form.mobile || null,
            username: form.username || null,
          }
        : {
            fullName: form.fullName,
            mobile: form.mobile || null,
            email: form.email,
            username: null,
            role: form.role,
            status: "PendingInvitation",
            isActive: false,
          };
      const saved = await apiRequest<PropertyUserResponse>(
        editingUser
          ? `/owner/properties/${propertyId}/users/${editingUser.userId}`
          : `/owner/properties/${propertyId}/users`,
        {
          method: editingUser ? "PUT" : "POST",
          body: JSON.stringify(body),
        },
      );
      setUsers((current) =>
        editingUser
          ? current.map((item) => (item.userId === saved.userId ? saved : item))
          : [...current, saved],
      );
      setDialogOpen(false);
      toast.success(editingUser ? "کاربر اقامتگاه ذخیره شد" : "دعوت کاربر ثبت شد");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "ذخیره کاربر انجام نشد.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user: PropertyUserResponse) {
    await apiRequest(`/owner/properties/${propertyId}/users/${user.userId}`, {
      method: "DELETE",
    });
    setUsers((current) =>
      current.filter((item) => item.userId !== user.userId),
    );
    toast.success("کاربر از اقامتگاه حذف شد");
  }

  return (
    <KoochCard className="grid gap-4" padding="none" variant="elevated">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 className="text-xl font-black text-foreground">
            مدیریت کاربران
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            برای هر اقامتگاه یک مالک اصلی و چند کاربر عملیاتی تعریف کنید.
          </p>
        </div>
        <KoochButton onClick={openCreate} type="button" variant="primary">
          افزودن کاربر
        </KoochButton>
      </div>

      {error && (
        <div className="mx-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
          {error}
        </div>
      )}

      {ownerCount !== 1 && (
        <div className="mx-5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm font-semibold text-yellow-700 dark:text-yellow-300">
          هر اقامتگاه باید دقیقاً یک مالک اصلی داشته باشد.
        </div>
      )}

      <div className="px-5 pb-5">
        <KoochTable>
          <KoochTableHeader>
            <KoochTableRow>
              <KoochTableHead>نام</KoochTableHead>
              <KoochTableHead>موبایل</KoochTableHead>
              <KoochTableHead>ایمیل</KoochTableHead>
              <KoochTableHead>نام کاربری</KoochTableHead>
              <KoochTableHead>نقش</KoochTableHead>
              <KoochTableHead>وضعیت</KoochTableHead>
              <KoochTableHead>فعال</KoochTableHead>
              <KoochTableHead>عملیات</KoochTableHead>
            </KoochTableRow>
          </KoochTableHeader>
          <KoochTableBody>
            {loading ? (
              <KoochTableEmpty colSpan={8}>در حال بارگذاری...</KoochTableEmpty>
            ) : users.length === 0 ? (
              <KoochTableEmpty colSpan={8}>
                هنوز کاربری برای این اقامتگاه ثبت نشده است.
              </KoochTableEmpty>
            ) : (
              users.map((user) => (
                <KoochTableRow key={`${user.role}-${user.userId}`}>
                  <KoochTableCell className="font-black">
                    {user.fullName || "-"}
                  </KoochTableCell>
                  <KoochTableCell dir="ltr">{user.mobile ?? "-"}</KoochTableCell>
                  <KoochTableCell dir="ltr">{user.email}</KoochTableCell>
                  <KoochTableCell dir="ltr">{user.username}</KoochTableCell>
                  <KoochTableCell>
                    <KoochBadge
                      variant={user.role === "PropertyOwner" ? "default" : "muted"}
                    >
                      {roleLabels[user.role]}
                    </KoochBadge>
                  </KoochTableCell>
                  <KoochTableCell>
                    <KoochBadge variant={statusVariant(user.status)}>
                      {statusLabels[user.status]}
                    </KoochBadge>
                  </KoochTableCell>
                  <KoochTableCell>
                    {user.isActive ? "بله" : "خیر"}
                  </KoochTableCell>
                  <KoochTableCell>
                    <div className="flex flex-wrap gap-2">
                      {user.role !== "PropertyOwner" && (
                        <KoochButton
                          onClick={() => openEdit(user)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          ویرایش
                        </KoochButton>
                      )}
                      {user.canRemove && (
                        <KoochConfirmDialog
                          cancelText="انصراف"
                          confirmText="حذف"
                          description="این کاربر از این اقامتگاه حذف می‌شود. آیا مطمئن هستید؟"
                          onConfirm={() => deleteUser(user)}
                          title="حذف کاربر"
                          trigger={
                            <KoochButton
                              size="sm"
                              type="button"
                              variant="destructive"
                            >
                              حذف
                            </KoochButton>
                          }
                          variant="destructive"
                        />
                      )}
                    </div>
                  </KoochTableCell>
                </KoochTableRow>
              ))
            )}
          </KoochTableBody>
        </KoochTable>
      </div>

      <KoochDialog
        footer={
          <>
            <KoochButton
              onClick={() => setDialogOpen(false)}
              type="button"
              variant="outline"
            >
              لغو
            </KoochButton>
            <KoochButton form="property-user-form" loading={saving} type="submit">
              ذخیره
            </KoochButton>
          </>
        }
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        title={editingUser ? "ویرایش کاربر" : "افزودن کاربر"}
      >
        <form
          className="grid gap-4"
          id="property-user-form"
          onSubmit={submit}
        >
          <KoochInput
            onChange={(event) =>
              setForm((current) => ({ ...current, fullName: event.target.value }))
            }
            placeholder="نام کامل"
            required
            value={form.fullName}
          />
          <KoochInput
            dir="ltr"
            onChange={(event) =>
              setForm((current) => ({ ...current, mobile: event.target.value }))
            }
            placeholder="موبایل"
            value={form.mobile}
          />
          <KoochInput
            dir="ltr"
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            placeholder="ایمیل"
            required
            type="email"
            value={form.email}
          />
          <KoochSelect
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                role: event.target.value as PropertyUserForm["role"],
              }))
            }
            value={form.role}
          >
            {roleOptions.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </KoochSelect>
          {editingUser && (
            <>
              <KoochInput
                dir="ltr"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                placeholder="نام کاربری"
                value={form.username}
              />
              <KoochSelect
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as PropertyUserStatus,
                    isActive: event.target.value === "Active",
                  }))
                }
                value={form.status}
              >
                {statusOptions.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </KoochSelect>
              <label className="flex items-center gap-2 text-sm font-bold text-foreground">
                <input
                  checked={form.isActive}
                  className="h-4 w-4 accent-primary"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      isActive: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                کاربر فعال باشد
              </label>
            </>
          )}
        </form>
      </KoochDialog>
    </KoochCard>
  );
}
