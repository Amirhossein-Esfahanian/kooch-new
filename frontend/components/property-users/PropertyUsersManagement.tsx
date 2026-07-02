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
  createRolePermissionMatrix,
  normalizePermissionMatrix,
  PermissionMatrix,
} from "@/components/PermissionMatrix";
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
  getAuthRole,
  getAuthUserId,
  PermissionMatrixValue,
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
  { value: "Pending", label: "در انتظار" },
  { value: "Active", label: "فعال" },
  { value: "Suspended", label: "تعلیق‌شده" },
  { value: "Inactive", label: "غیرفعال" },
];

const statusLabels: Record<PropertyUserStatus, string> = {
  Pending: "در انتظار",
  Active: "فعال",
  Suspended: "تعلیق‌شده",
  Inactive: "غیرفعال",
};

type PropertyUserForm = {
  fullName: string;
  mobile: string;
  email: string;
  username: string;
  status: PropertyUserStatus;
  role: Exclude<PropertyUserRole, "PropertyOwner">;
  isActive: boolean;
  permissions: PermissionMatrixValue;
};

const emptyForm: PropertyUserForm = {
  fullName: "",
  mobile: "",
  email: "",
  username: "",
  status: "Pending",
  role: "Manager",
  isActive: false,
  permissions: createRolePermissionMatrix("Manager"),
};

function statusVariant(status: PropertyUserStatus) {
  if (status === "Active") return "success" as const;
  if (status === "Pending") return "warning" as const;
  if (status === "Inactive") return "muted" as const;
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
    permissions: normalizePermissionMatrix(user.permissions),
  };
}

function roleRank(role: PropertyUserRole) {
  const ranks: Record<PropertyUserRole, number> = {
    PropertyOwner: 100,
    Manager: 80,
    Accounting: 60,
    Reception: 50,
    Housekeeping: 40,
    Custom: 10,
  };
  return ranks[role] ?? 0;
}

function formatOptionalDate(value?: string | null) {
  if (!value) return "ثبت نشده";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ثبت نشده";

  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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
  const [activityUser, setActivityUser] = useState<PropertyUserResponse | null>(
    null,
  );
  const [form, setForm] = useState<PropertyUserForm>(emptyForm);

  const ownerCount = useMemo(
    () => users.filter((user) => user.role === "PropertyOwner").length,
    [users],
  );
  const currentUserId = getAuthUserId();
  const authRole = getAuthRole();
  const actorUser = useMemo(
    () => users.find((user) => user.userId === currentUserId) ?? null,
    [currentUserId, users],
  );
  const actorPropertyRole = useMemo<PropertyUserRole>(() => {
    if (authRole === "SuperAdmin" || authRole === "AdminAssistant" || authRole === "Owner") {
      return "PropertyOwner";
    }
    return actorUser?.role ?? "Custom";
  }, [actorUser, authRole]);
  const availableRoleOptions = useMemo(
    () =>
      roleOptions.filter(
        (role) => roleRank(role.value) <= roleRank(actorPropertyRole),
      ),
    [actorPropertyRole],
  );

  function canManageRole(role: PropertyUserRole) {
    return roleRank(role) <= roleRank(actorPropertyRole);
  }

  function hasUserPermission(action: "view" | "create" | "edit" | "delete") {
    if (authRole === "SuperAdmin" || authRole === "AdminAssistant" || authRole === "Owner") {
      return true;
    }

    return Boolean(actorUser?.permissions?.Users?.[action]);
  }

  function hierarchyError(message = "امکان مدیریت نقش بالاتر وجود ندارد.") {
    setError(message);
    toast.error(message);
  }

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
    const defaultRole =
      (availableRoleOptions[0]?.value as PropertyUserForm["role"] | undefined) ??
      "Custom";
    setForm({
      ...emptyForm,
      role: defaultRole,
      permissions: createRolePermissionMatrix(defaultRole),
    });
    setDialogOpen(true);
  }

  function openEdit(user: PropertyUserResponse) {
    if (!canManageRole(user.role)) {
      hierarchyError("شما نمی‌توانید کاربری با نقش بالاتر را ویرایش کنید.");
      return;
    }
    setEditingUser(user);
    setForm(toForm(user));
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (!canManageRole(form.role)) {
        hierarchyError("شما نمی‌توانید این نقش را برای کاربر تنظیم کنید.");
        return;
      }
      if (editingUser && !canManageRole(editingUser.role)) {
        hierarchyError("شما نمی‌توانید کاربری با نقش بالاتر را ویرایش کنید.");
        return;
      }
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
            status: "Pending",
            isActive: false,
            permissions: form.permissions,
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

  async function changeUserStatus(
    user: PropertyUserResponse,
    status: Exclude<PropertyUserStatus, "Pending">,
    keepDialogOpenOnError = false,
  ) {
    if (!canManageRole(user.role)) {
      hierarchyError("شما نمی‌توانید وضعیت کاربری با نقش بالاتر را تغییر دهید.");
      return;
    }
    try {
      const action = {
        Active: "activate",
        Suspended: "suspend",
        Inactive: "deactivate",
      }[status];
      const saved = await apiRequest<PropertyUserResponse>(
        `/owner/properties/${propertyId}/users/${user.userId}/${action}`,
        {
          method: "PUT",
        },
      );
      setUsers((current) =>
        current.map((item) => (item.userId === saved.userId ? saved : item)),
      );
      toast.success(
        status === "Active"
          ? "کاربر فعال شد"
          : status === "Suspended"
            ? "کاربر تعلیق شد"
            : "کاربر غیرفعال شد",
      );
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "تغییر وضعیت کاربر انجام نشد.";
      setError(message);
      toast.error(message);
      if (keepDialogOpenOnError) {
        throw caught;
      }
    }
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
        {hasUserPermission("create") && (
          <KoochButton onClick={openCreate} type="button" variant="primary">
            افزودن کاربر
          </KoochButton>
        )}
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
                      {user.role !== "PropertyOwner" && canManageRole(user.role) && hasUserPermission("edit") && (
                        <KoochButton
                          onClick={() => openEdit(user)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          ویرایش
                        </KoochButton>
                      )}
                      <KoochButton
                        onClick={() => setActivityUser(user)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        فعالیت
                      </KoochButton>
                      {user.canRemove && canManageRole(user.role) && (
                        <>
                          {user.status !== "Active" && hasUserPermission("edit") && (
                            <KoochButton
                              onClick={() => changeUserStatus(user, "Active")}
                              size="sm"
                              type="button"
                              variant="primary"
                            >
                              فعال‌سازی
                            </KoochButton>
                          )}
                          {user.status === "Active" && hasUserPermission("edit") && (
                            <KoochButton
                              onClick={() => changeUserStatus(user, "Suspended")}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              تعلیق
                            </KoochButton>
                          )}
                          {user.status !== "Inactive" && hasUserPermission("delete") && (
                            <KoochConfirmDialog
                              cancelText="انصراف"
                              confirmText="غیرفعال‌سازی"
                              description="این کاربر غیرفعال می‌شود اما اطلاعات او حذف نخواهد شد. آیا مطمئن هستید؟"
                              onConfirm={() => changeUserStatus(user, "Inactive", true)}
                              title="غیرفعال‌سازی کاربر"
                              trigger={
                                <KoochButton
                                  size="sm"
                                  type="button"
                                  variant="destructive"
                                >
                                  غیرفعال‌سازی
                                </KoochButton>
                              }
                              variant="destructive"
                            />
                          )}
                        </>
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
                permissions: createRolePermissionMatrix(event.target.value),
              }))
            }
            value={form.role}
          >
            {availableRoleOptions.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </KoochSelect>
          <div className="grid gap-2">
            <div>
              <h3 className="text-sm font-black text-foreground">
                سطح دسترسی
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                دسترسی‌های این کاربر را برای بخش‌های مختلف اقامتگاه تنظیم کنید.
              </p>
            </div>
            <PermissionMatrix
              disabled={!hasUserPermission("edit")}
              onChange={(permissions) =>
                setForm((current) => ({ ...current, permissions }))
              }
              value={form.permissions}
            />
          </div>
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

      <KoochDialog
        footer={
          <KoochButton
            onClick={() => setActivityUser(null)}
            type="button"
            variant="outline"
          >
            بستن
          </KoochButton>
        }
        onOpenChange={(open) => {
          if (!open) setActivityUser(null);
        }}
        open={Boolean(activityUser)}
        size="md"
        title="فعالیت کاربر"
      >
        {activityUser && (
          <div className="grid gap-4">
            <div className="rounded-lg border border-border bg-muted p-4">
              <p className="text-lg font-black text-foreground">
                {activityUser.fullName || "-"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground" dir="ltr">
                {activityUser.email}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ReadOnlyActivityItem
                label="Last login"
                value={formatOptionalDate(activityUser.lastLoginAtUtc)}
              />
              <ReadOnlyActivityItem
                label="Last activity"
                value={formatOptionalDate(activityUser.lastActivityAtUtc)}
              />
              <ReadOnlyActivityItem
                label="Created date"
                value={formatOptionalDate(activityUser.createdAtUtc)}
              />
              <ReadOnlyActivityItem
                label="Invitation accepted"
                value={formatOptionalDate(activityUser.invitationAcceptedAtUtc)}
              />
              <ReadOnlyActivityItem
                label="Status"
                value={statusLabels[activityUser.status]}
              />
            </div>
          </div>
        )}
      </KoochDialog>
    </KoochCard>
  );
}

function ReadOnlyActivityItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}
