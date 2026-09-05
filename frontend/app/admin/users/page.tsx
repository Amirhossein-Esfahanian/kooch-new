"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochCheckbox } from "@/components/KoochCheckbox";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochField,
  KoochInput,
  KoochSelect,
} from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  CreateUserFields,
  getCreateUserApiError,
  hasCreateUserIdentityErrors,
  validateCreateUserIdentity,
  type CreateUserIdentityErrors,
} from "@/components/users/CreateUserFields";
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
  AdminPermissionKey,
  AdminUserResponse,
  apiRequest,
  UserRole,
} from "@/lib/owner-api";
import { KoochIcon } from "../../../components/KoochIcon";

type PlatformAdminRole = Extract<UserRole, "SuperAdmin" | "AdminAssistant">;

const roles: PlatformAdminRole[] = ["SuperAdmin", "AdminAssistant"];

const roleLabels: Record<PlatformAdminRole, string> = {
  SuperAdmin: "مدیر ارشد",
  AdminAssistant: "دستیار مدیر",
};

function roleLabel(role: UserRole) {
  return roles.includes(role as PlatformAdminRole)
    ? roleLabels[role as PlatformAdminRole]
    : role;
}

type UserRoleFilter = "all" | PlatformAdminRole;
type UserStatusFilter = "all" | "active" | "inactive" | "passwordSetupRequired";

const permissionCategories: Array<{
  key: string;
  label: string;
  permissions: Array<{ key: AdminPermissionKey; label: string }>;
}> = [
  {
    key: "dashboard",
    label: "داشبورد",
    permissions: [
      { key: "ViewDashboard", label: "مشاهده داشبورد" },
      { key: "ManageNotifications", label: "مدیریت اعلان‌ها" },
    ],
  },
  {
    key: "properties",
    label: "اقامتگاه‌ها",
    permissions: [
      { key: "ManageProperties", label: "مدیریت اقامتگاه‌ها" },
      { key: "ManageReviews", label: "مدیریت نظرات اقامتگاه‌ها" },
    ],
  },
  {
    key: "rooms",
    label: "اتاق‌ها",
    permissions: [{ key: "ManageRooms", label: "مدیریت اتاق‌ها" }],
  },
  {
    key: "inventory",
    label: "ظرفیت",
    permissions: [{ key: "ManageAvailability", label: "مدیریت ظرفیت" }],
  },
  {
    key: "pricing",
    label: "قیمت‌گذاری",
    permissions: [{ key: "ManagePricing", label: "مدیریت قیمت‌گذاری" }],
  },
  {
    key: "reservations",
    label: "رزروها",
    permissions: [{ key: "ManageReservations", label: "مدیریت رزروها" }],
  },
  {
    key: "guests",
    label: "مهمان‌ها",
    permissions: [{ key: "ManageGuests", label: "مدیریت مهمان‌ها" }],
  },
  {
    key: "amenities",
    label: "امکانات",
    permissions: [{ key: "ManageAmenities", label: "مدیریت امکانات" }],
  },
  {
    key: "users",
    label: "کاربران",
    permissions: [
      { key: "ManageUsers", label: "مدیریت کاربران" },
      { key: "ManageRoles", label: "مدیریت نقش‌ها" },
      { key: "ManageStaff", label: "مدیریت همکاران" },
    ],
  },
  {
    key: "financial",
    label: "مالی",
    permissions: [{ key: "ManagePayments", label: "مدیریت امور مالی" }],
  },
  {
    key: "reports",
    label: "گزارش‌ها",
    permissions: [{ key: "ViewReports", label: "مشاهده گزارش‌ها" }],
  },
  {
    key: "settings",
    label: "تنظیمات",
    permissions: [
      { key: "ManageSettings", label: "مدیریت تنظیمات" },
      { key: "ManageSeo", label: "مدیریت سئو" },
    ],
  },
];

const allPermissionKeys = permissionCategories.flatMap((category) =>
  category.permissions.map((permission) => permission.key),
);

type UserForm = {
  id: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: PlatformAdminRole;
  permissions: AdminPermissionKey[];
};

const emptyForm: UserForm = {
  id: null,
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
  password: "",
  role: "AdminAssistant",
  permissions: [],
};

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("ي", "ی")
    .replaceAll("ك", "ک");
}

function statusVariant(user: AdminUserResponse) {
  if (user.passwordSetupRequired) return "warning" as const;
  if (user.isActive) return "success" as const;
  return "muted" as const;
}

function statusLabel(user: AdminUserResponse) {
  if (user.passwordSetupRequired) return "در انتظار تنظیم رمز";
  return user.isActive ? "فعال" : "غیرفعال";
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

export default function AdminUsersPage() {
  const {
    authenticated,
    loading: sessionLoading,
    platformPermissions,
    platformRole,
    workspaces,
  } = useAuthSession();
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [identityErrors, setIdentityErrors] =
    useState<CreateUserIdentityErrors>({});
  const [setupLink, setSetupLink] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all");
  const canManageUsers =
    platformRole === "SuperAdmin" ||
    platformPermissions.includes("ManageUsers");
  const assignableRoles: PlatformAdminRole[] =
    platformRole === "SuperAdmin" ? roles : ["AdminAssistant"];
  const assignablePermissionKeys =
    platformRole === "SuperAdmin"
      ? allPermissionKeys
      : allPermissionKeys.filter((permission) =>
          platformPermissions.includes(permission),
        );
  const assignablePermissionCategories = permissionCategories
    .map((category) => ({
      ...category,
      permissions: category.permissions.filter((permission) =>
        assignablePermissionKeys.includes(permission.key),
      ),
    }))
    .filter((category) => category.permissions.length > 0);

  const filteredUsers = useMemo(() => {
    const query = normalizeSearchText(searchTerm);

    return users.filter((user) => {
      const matchesSearch =
        !query ||
        [
          user.fullName,
          user.firstName,
          user.lastName,
          user.email,
          user.phoneNumber,
          roleLabel(user.role),
          statusLabel(user),
        ]
          .map(normalizeSearchText)
          .some((value) => value.includes(query));

      const matchesRole = roleFilter === "all" || user.role === roleFilter;

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" &&
          user.isActive &&
          !user.passwordSetupRequired) ||
        (statusFilter === "inactive" && !user.isActive) ||
        (statusFilter === "passwordSetupRequired" &&
          user.passwordSetupRequired);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [roleFilter, searchTerm, statusFilter, users]);

  const hasActiveFilters =
    Boolean(searchTerm.trim()) ||
    roleFilter !== "all" ||
    statusFilter !== "all";

  async function load() {
    setUsers(await apiRequest<AdminUserResponse[]>("/admin/users"));
  }

  useEffect(() => {
    if (
      sessionLoading ||
      !authenticated ||
      !workspaces.includes("admin") ||
      !canManageUsers
    )
      return;

    load()
      .catch((caught: Error) => {
        setError(caught.message);
        toast.error(caught.message);
      })
      .finally(() => setLoading(false));
  }, [authenticated, canManageUsers, sessionLoading, workspaces]);

  function resetFilters() {
    setSearchTerm("");
    setRoleFilter("all");
    setStatusFilter("all");
  }

  function openCreate() {
    setForm(emptyForm);
    setError("");
    setIdentityErrors({});
    setDialogOpen(true);
  }

  function openEdit(user: AdminUserResponse) {
    setForm({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber ?? "",
      password: "",
      role: user.role as PlatformAdminRole,
      permissions: user.permissions ?? [],
    });
    setError("");
    setIdentityErrors({});
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setForm(emptyForm);
    setIdentityErrors({});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextIdentityErrors = validateCreateUserIdentity({
      firstName: form.firstName,
      lastName: form.lastName,
      mobile: form.phoneNumber,
      email: form.email,
    });
    setIdentityErrors(nextIdentityErrors);
    if (hasCreateUserIdentityErrors(nextIdentityErrors)) {
      const message = Object.values(nextIdentityErrors)[0]!;
      setError(message);
      toast.error(message);
      return;
    }

    const passwordError = form.password ? validatePassword(form.password) : "";
    if (passwordError) {
      setError(passwordError);
      toast.error(passwordError);
      return;
    }

    setSaving(true);
    setError("");

    try {
      const saved = await apiRequest<AdminUserResponse>(
        form.id ? `/admin/users/${form.id}` : "/admin/users",
        {
          method: form.id ? "PUT" : "POST",
          body: JSON.stringify({
            firstName: form.firstName,
            lastName: form.lastName,
            email: form.email.trim() || null,
            phoneNumber: form.phoneNumber,
            password: form.password ? form.password : null,
            role: form.role,
            parentUserId: null,
            permissions: form.permissions,
          }),
        },
      );

      if (
        !form.id &&
        saved.temporarySetupLink &&
        process.env.NODE_ENV !== "production"
      ) {
        setSetupLink(saved.temporarySetupLink);
      }

      await load();
      closeDialog();
      toast.success(form.id ? "کاربر ذخیره شد" : "دعوت کاربر ثبت شد");
    } catch (caught) {
      const message = getCreateUserApiError(caught, "ذخیره کاربر انجام نشد.");
      setError(message);
      toast.error(message);
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

      toast.success(active ? "کاربر فعال شد" : "کاربر غیرفعال شد");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "تغییر وضعیت کاربر انجام نشد.";

      setError(message);
      toast.error(message);
      throw caught;
    }
  }

  function setPermission(permission: AdminPermissionKey, checked: boolean) {
    setForm((current) => ({
      ...current,
      permissions: checked
        ? Array.from(new Set([...current.permissions, permission]))
        : current.permissions.filter((item) => item !== permission),
    }));
  }

  function setCategoryPermissions(
    permissions: AdminPermissionKey[],
    checked: boolean,
  ) {
    setForm((current) => ({
      ...current,
      permissions: checked
        ? Array.from(new Set([...current.permissions, ...permissions]))
        : current.permissions.filter((item) => !permissions.includes(item)),
    }));
  }

  return (
    <AdminLayout requiredPlatformPermission="ManageUsers">
      <main className="mx-auto grid w-full min-w-0 max-w-[1480px] gap-5 overflow-x-hidden p-4 lg:p-6">
        <KoochPageHeader
          appearance="plain"
          actions={
            <KoochButton onClick={openCreate} type="button">
              <KoochIcon name="plus" />
              افزودن کاربر
            </KoochButton>
          }
          eyebrow="پنل مدیریت"
          title="مدیریت کاربران"
        />

        {error && (
          <KoochAlert title="عملیات انجام نشد" variant="destructive">
            {error}
          </KoochAlert>
        )}

        {setupLink && process.env.NODE_ENV !== "production" && (
          <KoochCard className="border-primary/30 bg-primary/10" padding="sm">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="text-sm font-bold text-foreground">
                  لینک تنظیم رمز عبور آماده است.
                </p>
                <p
                  className="mt-1 break-all text-xs text-muted-foreground"
                  dir="ltr"
                >
                  {setupLink}
                </p>
              </div>
              <KoochButton
                onClick={() =>
                  window.open(setupLink, "_blank", "noopener,noreferrer")
                }
                size="sm"
                type="button"
                variant="outline"
              >
                مشاهده لینک تنظیم رمز
              </KoochButton>
            </div>
          </KoochCard>
        )}

        {!loading && users.length > 0 && (
          <KoochCard
            className="min-w-0 max-w-full"
            padding="sm"
            variant="elevated"
          >
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_190px_190px_auto] xl:items-end">
              <KoochField label="جستجو">
                <KoochInput
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="نام، ایمیل، شماره تماس یا نقش..."
                  value={searchTerm}
                />
              </KoochField>

              <KoochField label="نقش">
                <KoochSelect
                  onChange={(event) =>
                    setRoleFilter(event.target.value as UserRoleFilter)
                  }
                  value={roleFilter}
                >
                  <option value="all">همه نقش‌ها</option>
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </KoochSelect>
              </KoochField>

              <KoochField label="وضعیت">
                <KoochSelect
                  onChange={(event) =>
                    setStatusFilter(event.target.value as UserStatusFilter)
                  }
                  value={statusFilter}
                >
                  <option value="all">همه وضعیت‌ها</option>
                  <option value="active">فعال</option>
                  <option value="inactive">غیرفعال</option>
                  <option value="passwordSetupRequired">
                    در انتظار تنظیم رمز
                  </option>
                </KoochSelect>
              </KoochField>

              <div className="flex flex-wrap items-center gap-2">
                <KoochButton
                  disabled={!hasActiveFilters}
                  onClick={resetFilters}
                  type="button"
                  variant="outline"
                >
                  حذف فیلترها
                </KoochButton>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm text-muted-foreground">
              <span>
                نمایش {filteredUsers.length.toLocaleString("fa-IR")} از{" "}
                {users.length.toLocaleString("fa-IR")} کاربر
              </span>

              {hasActiveFilters && (
                <span className="rounded-md bg-[var(--theme-warning-soft)] px-3 py-1 text-xs font-bold text-[var(--theme-warning)]">
                  فیلتر فعال است
                </span>
              )}
            </div>
          </KoochCard>
        )}
        <div className="min-w-0 max-w-full">
          <KoochTable>
            <KoochTableHeader>
              <KoochTableRow>
                <KoochTableHead className="w-14">ردیف</KoochTableHead>
                <KoochTableHead>کاربر</KoochTableHead>
                <KoochTableHead>شماره تماس</KoochTableHead>
                <KoochTableHead>نقش</KoochTableHead>
                <KoochTableHead>وضعیت</KoochTableHead>
                <KoochTableHead>عملیات</KoochTableHead>
              </KoochTableRow>
            </KoochTableHeader>

            <KoochTableBody>
              {loading ? (
                <KoochTableEmpty colSpan={6}>
                  در حال بارگذاری...
                </KoochTableEmpty>
              ) : users.length === 0 ? (
                <KoochTableEmpty colSpan={6}>
                  هنوز کاربری ثبت نشده است.
                </KoochTableEmpty>
              ) : filteredUsers.length === 0 ? (
                <KoochTableEmpty colSpan={6}>
                  موردی با فیلترهای انتخاب‌شده پیدا نشد.
                </KoochTableEmpty>
              ) : (
                filteredUsers.map((user, index) => (
                  <KoochTableRow key={user.id}>
                    <KoochTableCell className="font-bold text-muted-foreground">
                      {index + 1}
                    </KoochTableCell>

                    <KoochTableCell>
                      <p className="font-bold text-foreground">
                        {user.fullName || user.email}
                      </p>
                      <p
                        className="mt-1 text-xs text-muted-foreground"
                        dir="ltr"
                      >
                        {user.email}
                      </p>
                    </KoochTableCell>

                    <KoochTableCell>{user.phoneNumber}</KoochTableCell>
                    <KoochTableCell>{roleLabel(user.role)}</KoochTableCell>

                    <KoochTableCell>
                      <KoochBadge variant={statusVariant(user)}>
                        {statusLabel(user)}
                      </KoochBadge>
                    </KoochTableCell>

                    <KoochTableCell>
                      <div className="flex flex-wrap gap-2">
                        {(platformRole === "SuperAdmin" ||
                          user.role !== "SuperAdmin") && (
                          <>
                            <KoochButton
                              title="ویرایش کاربر"
                              onClick={() => openEdit(user)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              <KoochIcon name="edit" />
                            </KoochButton>

                            {user.isActive ? (
                              <KoochConfirmDialog
                                cancelText="انصراف"
                                confirmText="غیرفعال شود"
                                description="این کاربر غیرفعال می‌شود. آیا مطمئن هستید؟"
                                onConfirm={() => setActive(user, false)}
                                title="غیرفعال‌سازی کاربر"
                                trigger={
                                  <KoochButton
                                    title="غیرفعال‌سازی کاربر"
                                    size="sm"
                                    type="button"
                                    variant="destructive"
                                  >
                                    <KoochIcon name="suspend" />{" "}
                                  </KoochButton>
                                }
                                variant="destructive"
                              />
                            ) : (
                              <KoochButton
                                onClick={() => setActive(user, true)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                فعال
                              </KoochButton>
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
          closeDisabled={saving}
          footer={
            <>
              <KoochButton
                disabled={saving}
                onClick={closeDialog}
                type="button"
                variant="outline"
              >
                لغو
              </KoochButton>
              <KoochButton
                form="admin-user-form"
                loading={saving}
                type="submit"
              >
                ذخیره
              </KoochButton>
            </>
          }
          onOpenChange={(open) => {
            if (!open) closeDialog();
            else setDialogOpen(true);
          }}
          open={dialogOpen}
          title={form.id ? "ویرایش کاربر" : "افزودن کاربر"}
        >
          <form className="grid gap-4" id="admin-user-form" onSubmit={submit}>
            <CreateUserFields
              errors={identityErrors}
              idPrefix="admin-user"
              onChange={(identity) =>
                setForm((current) => ({
                  ...current,
                  firstName: identity.firstName,
                  lastName: identity.lastName,
                  phoneNumber: identity.mobile,
                  email: identity.email,
                }))
              }
              value={{
                firstName: form.firstName,
                lastName: form.lastName,
                mobile: form.phoneNumber,
                email: form.email,
              }}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <>
                <KoochField
                  helperText={
                    form.id
                      ? "برای تغییر ندادن رمز، این فیلد را خالی بگذارید. حداقل ۸ کاراکتر، شامل حرف کوچک انگلیسی و عدد."
                      : "اگر خالی بماند لینک تنظیم رمز عبور ساخته می‌شود. حداقل ۸ کاراکتر، شامل حرف کوچک انگلیسی و عدد."
                  }
                  label={form.id ? "رمز جدید اختیاری" : "رمز اولیه اختیاری"}
                >
                  <KoochInput
                    dir="ltr"
                    minLength={8}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    type="password"
                    value={form.password}
                  />
                </KoochField>
              </>

              <KoochField label="نقش" required>
                <KoochSelect
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      role: event.target.value as PlatformAdminRole,
                      permissions:
                        event.target.value === "AdminAssistant"
                          ? current.permissions
                          : [],
                    }))
                  }
                  value={form.role}
                >
                  {assignableRoles.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </KoochSelect>
              </KoochField>
            </div>

            {form.role === "AdminAssistant" && (
              <KoochCard padding="sm" variant="muted">
                <div className="grid gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        مجوزها
                      </p>
                      <p className="mt-1 text-xs leading-6 text-muted-foreground">
                        دسترسی‌های سراسری دستیار مدیر را انتخاب کنید.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <KoochButton
                        onClick={() =>
                          setCategoryPermissions(assignablePermissionKeys, true)
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        انتخاب همه
                      </KoochButton>
                      <KoochButton
                        disabled={form.permissions.length === 0}
                        onClick={() =>
                          setCategoryPermissions(
                            assignablePermissionKeys,
                            false,
                          )
                        }
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        پاک کردن همه
                      </KoochButton>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {assignablePermissionCategories.map((category) => {
                      const categoryKeys = category.permissions.map(
                        (permission) => permission.key,
                      );
                      const categorySelected = categoryKeys.every(
                        (permission) => form.permissions.includes(permission),
                      );

                      return (
                        <div
                          className="grid content-start gap-3 rounded-lg border border-border bg-card p-3"
                          key={category.key}
                        >
                          <KoochCheckbox
                            checked={categorySelected}
                            label={category.label}
                            onChange={(event) =>
                              setCategoryPermissions(
                                categoryKeys,
                                event.target.checked,
                              )
                            }
                            wrapperClassName="border-b border-border pb-2 font-bold"
                          />
                          <div className="grid gap-2">
                            {category.permissions.map((permission) => (
                              <KoochCheckbox
                                checked={form.permissions.includes(
                                  permission.key,
                                )}
                                key={permission.key}
                                label={permission.label}
                                onChange={(event) =>
                                  setPermission(
                                    permission.key,
                                    event.target.checked,
                                  )
                                }
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </KoochCard>
            )}

            {form.role === "SuperAdmin" && (
              <KoochCard padding="sm" variant="muted">
                <p className="text-sm font-bold text-foreground">مجوزها</p>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  مدیر ارشد به‌صورت پیش‌فرض به همه بخش‌ها دسترسی دارد.
                </p>
              </KoochCard>
            )}
          </form>
        </KoochDialog>
      </main>
    </AdminLayout>
  );
}
