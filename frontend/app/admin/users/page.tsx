"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochField,
  KoochInput,
  KoochSelect,
} from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
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
  AdminUserResponse,
  apiRequest,
  getToken,
  PropertyResponse,
  UserRole,
} from "@/lib/owner-api";
import { KoochIcon } from "../../../components/KoochIcon";

const roles: UserRole[] = [
  "SuperAdmin",
  "AdminAssistant",
  "Owner",
  "OwnerAssistant",
];

const roleLabels: Record<UserRole, string> = {
  SuperAdmin: "مدیر ارشد",
  AdminAssistant: "دستیار مدیر",
  Owner: "مالک اقامتگاه",
  OwnerAssistant: "همکار مالک",
  Client: "مسافر",
};

type UserRoleFilter = "all" | UserRole;
type UserStatusFilter = "all" | "active" | "inactive" | "passwordSetupRequired";

type UserForm = {
  id: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: UserRole;
  propertyIds: string[];
};

const emptyForm: UserForm = {
  id: null,
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
  password: "",
  role: "Owner",
  propertyIds: [],
};

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("ي", "ی")
    .replaceAll("ك", "ک");
}

function isGlobalAdminRole(role: UserRole) {
  return role === "SuperAdmin" || role === "AdminAssistant";
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
  if (password.length < 8 || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return "رمز عبور باید حداقل ۸ کاراکتر و شامل حرف کوچک انگلیسی و عدد باشد.";
  }

  return "";
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const [error, setError] = useState("");
  const [setupLink, setSetupLink] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all");
  const [propertyFilter, setPropertyFilter] = useState("all");

  const filteredProperties = useMemo(() => {
    const query = normalizeSearchText(propertySearch);

    if (!query) return properties;

    return properties.filter((property) =>
      [property.name, property.englishName, property.city, property.ownerName]
        .map(normalizeSearchText)
        .some((value) => value.includes(query)),
    );
  }, [properties, propertySearch]);

  const selectedProperties = useMemo(
    () =>
      form.propertyIds
        .map((id) =>
          properties.find((property) => property.id.toString() === id),
        )
        .filter((property): property is PropertyResponse => Boolean(property)),
    [form.propertyIds, properties],
  );

  const filteredUsers = useMemo(() => {
    const query = normalizeSearchText(searchTerm);

    return users.filter((user) => {
      const userPropertyIds =
        user.properties?.map((property) => property.propertyId.toString()) ??
        (user.propertyId ? [user.propertyId.toString()] : []);

      const userPropertyNames =
        user.properties?.map((property) => property.propertyName) ??
        (user.propertyName ? [user.propertyName] : []);

      const matchesSearch =
        !query ||
        [
          user.fullName,
          user.firstName,
          user.lastName,
          user.email,
          user.phoneNumber,
          roleLabels[user.role],
          statusLabel(user),
          ...userPropertyNames,
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

      const matchesProperty =
        propertyFilter === "all" || userPropertyIds.includes(propertyFilter);

      return matchesSearch && matchesRole && matchesStatus && matchesProperty;
    });
  }, [propertyFilter, roleFilter, searchTerm, statusFilter, users]);

  const hasActiveFilters =
    Boolean(searchTerm.trim()) ||
    roleFilter !== "all" ||
    statusFilter !== "all" ||
    propertyFilter !== "all";

  async function load() {
    const [userItems, propertyItems] = await Promise.all([
      apiRequest<AdminUserResponse[]>("/admin/users"),
      apiRequest<PropertyResponse[]>("/admin/properties").catch(() => []),
    ]);

    setUsers(userItems);
    setProperties(propertyItems);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    load()
      .catch((caught: Error) => {
        setError(caught.message);
        toast.error(caught.message);
      })
      .finally(() => setLoading(false));
  }, [router]);

  function resetFilters() {
    setSearchTerm("");
    setRoleFilter("all");
    setStatusFilter("all");
    setPropertyFilter("all");
  }

  function openCreate() {
    setForm(emptyForm);
    setPropertySearch("");
    setError("");
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
      role: user.role,
      propertyIds:
        user.properties?.map((property) => property.propertyId.toString()) ??
        (user.propertyId ? [user.propertyId.toString()] : []),
    });
    setPropertySearch("");
    setError("");
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setForm(emptyForm);
    setPropertySearch("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isGlobalAdminRole(form.role) && form.propertyIds.length === 0) {
      const message = "برای این کاربر حداقل یک اقامتگاه انتخاب کنید.";
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
            email: form.email,
            phoneNumber: form.phoneNumber || null,
            password: form.password ? form.password : null,
            role: form.role,
            parentUserId: null,
            propertyId: form.propertyIds[0]
              ? Number(form.propertyIds[0])
              : null,
            propertyIds: form.propertyIds.map((id) => Number(id)),
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
      const message =
        caught instanceof Error ? caught.message : "ذخیره کاربر انجام نشد.";
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

  function addPropertyAccess(propertyId: string) {
    if (!propertyId) return;

    setForm((current) => ({
      ...current,
      propertyIds: current.propertyIds.includes(propertyId)
        ? current.propertyIds
        : [...current.propertyIds, propertyId],
    }));
  }

  function removePropertyAccess(propertyId: string) {
    setForm((current) => ({
      ...current,
      propertyIds: current.propertyIds.filter((id) => id !== propertyId),
    }));
  }

  return (
    <AdminLayout>
      <main className="mx-auto grid w-full min-w-0 max-w-[1480px] gap-5 overflow-x-hidden p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <KoochButton onClick={openCreate} type="button">
              <KoochIcon name="plus" />
              افزودن کاربر
            </KoochButton>
          }
          eyebrow=""
          title="مدیریت کاربران"
        />

        {error && (
          <KoochCard
            className="border-destructive/30 bg-destructive/10 text-destructive"
            padding="sm"
          >
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
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_190px_190px_220px_auto] xl:items-end">
              <KoochField label="جستجو">
                <KoochInput
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="نام، ایمیل، شماره تماس، نقش، اقامتگاه..."
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

              <KoochField label="اقامتگاه">
                <KoochSelect
                  onChange={(event) => setPropertyFilter(event.target.value)}
                  value={propertyFilter}
                >
                  <option value="all">همه اقامتگاه‌ها</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id.toString()}>
                      {property.name}
                    </option>
                  ))}
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
                <span className="rounded-md bg-amber-300 px-3 py-1 text-xs font-bold text-amber-800 dark:bg-amber-200 dark:text-amber-900">
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
                <KoochTableHead>اقامتگاه</KoochTableHead>
                <KoochTableHead>وضعیت</KoochTableHead>
                <KoochTableHead>عملیات</KoochTableHead>
              </KoochTableRow>
            </KoochTableHeader>

            <KoochTableBody>
              {loading ? (
                <KoochTableEmpty colSpan={7}>
                  در حال بارگذاری...
                </KoochTableEmpty>
              ) : users.length === 0 ? (
                <KoochTableEmpty colSpan={7}>
                  هنوز کاربری ثبت نشده است.
                </KoochTableEmpty>
              ) : filteredUsers.length === 0 ? (
                <KoochTableEmpty colSpan={7}>
                  موردی با فیلترهای انتخاب‌شده پیدا نشد.
                </KoochTableEmpty>
              ) : (
                filteredUsers.map((user, index) => (
                  <KoochTableRow key={user.id}>
                    <KoochTableCell className="font-bold text-muted-foreground">
                      {index + 1}
                    </KoochTableCell>

                    <KoochTableCell>
                      <p className="font-black text-foreground">
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
                    <KoochTableCell>{roleLabels[user.role]}</KoochTableCell>

                    <KoochTableCell className="text-muted-foreground">
                      {user.properties?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {user.properties.map((property) => (
                            <KoochBadge
                              key={property.propertyId}
                              variant="muted"
                            >
                              {property.propertyName}
                            </KoochBadge>
                          ))}
                        </div>
                      ) : (
                        (user.propertyName ?? "-")
                      )}
                    </KoochTableCell>

                    <KoochTableCell>
                      <KoochBadge variant={statusVariant(user)}>
                        {statusLabel(user)}
                      </KoochBadge>
                    </KoochTableCell>

                    <KoochTableCell>
                      <div className="flex flex-wrap gap-2">
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
            <div className="grid gap-4 md:grid-cols-2">
              <KoochField label="نام" required>
                <KoochInput
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      firstName: event.target.value,
                    }))
                  }
                  required
                  value={form.firstName}
                />
              </KoochField>

              <KoochField label="نام خانوادگی" required>
                <KoochInput
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      lastName: event.target.value,
                    }))
                  }
                  required
                  value={form.lastName}
                />
              </KoochField>

              <KoochField label="ایمیل" required>
                <KoochInput
                  dir="ltr"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  required
                  type="email"
                  value={form.email}
                />
              </KoochField>

              <KoochField label="شماره تماس">
                <KoochInput
                  dir="ltr"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      phoneNumber: event.target.value,
                    }))
                  }
                  value={form.phoneNumber}
                />
              </KoochField>

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
                      role: event.target.value as UserRole,
                      propertyIds: isGlobalAdminRole(
                        event.target.value as UserRole,
                      )
                        ? []
                        : current.propertyIds,
                    }))
                  }
                  value={form.role}
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </KoochSelect>
              </KoochField>
            </div>

            {!isGlobalAdminRole(form.role) && (
              <KoochCard padding="sm" variant="muted">
                <div className="grid gap-3">
                  <div>
                    <p className="text-sm font-black text-foreground">
                      اتصال به اقامتگاه
                    </p>
                    <p className="mt-1 text-xs leading-6 text-muted-foreground">
                      برای نقش‌های سراسری این بخش می‌تواند خالی بماند. برای
                      همکار مالک، اقامتگاه را با نام انتخاب کنید.
                    </p>
                  </div>

                  <KoochInput
                    onChange={(event) => setPropertySearch(event.target.value)}
                    placeholder="جستجوی نام اقامتگاه، شهر یا مالک"
                    value={propertySearch}
                  />

                  <KoochSelect
                    onChange={(event) => addPropertyAccess(event.target.value)}
                    value=""
                  >
                    <option value="">بدون اقامتگاه / دسترسی سراسری</option>
                    {filteredProperties
                      .filter(
                        (property) =>
                          !form.propertyIds.includes(property.id.toString()),
                      )
                      .map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.name} - {property.city} -{" "}
                          {property.ownerName}
                        </option>
                      ))}
                  </KoochSelect>

                  {selectedProperties.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedProperties.map((property) => (
                        <span
                          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-bold text-card-foreground"
                          key={property.id}
                        >
                          {property.name}
                          <button
                            aria-label={`حذف دسترسی ${property.name}`}
                            className="text-muted-foreground transition hover:text-destructive"
                            onClick={() =>
                              removePropertyAccess(property.id.toString())
                            }
                            type="button"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs font-bold text-destructive">
                      حداقل یک اقامتگاه انتخاب کنید.
                    </p>
                  )}
                </div>
              </KoochCard>
            )}
          </form>
        </KoochDialog>
      </main>
    </AdminLayout>
  );
}
