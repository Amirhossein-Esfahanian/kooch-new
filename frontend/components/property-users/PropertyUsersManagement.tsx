"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochField, KoochInput, KoochSelect } from "@/components/KoochFormControls";
import { PermissionMatrix } from "@/components/PermissionMatrix";
import {
  CreateUserFields,
  getCreateUserApiError,
  hasCreateUserIdentityErrors,
  validateCreateUserIdentity,
  type CreateUserIdentityErrors,
} from "@/components/users/CreateUserFields";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
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
  PermissionMatrixValue,
  PermissionAction,
  PropertyPermissionMetadataResponse,
  PropertyResponse,
  PropertyUserCandidateResponse,
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

type PropertyUserCreateStep = "lookup" | "identity" | "membership";

type PropertyUserForm = {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  username: string;
  status: PropertyUserStatus;
  role: Exclude<PropertyUserRole, "PropertyOwner">;
  isActive: boolean;
  permissions: PermissionMatrixValue;
};

function normalizePermissionMatrix(
  value: PermissionMatrixValue | null | undefined,
  metadata: PropertyPermissionMetadataResponse | null,
): PermissionMatrixValue {
  if (!metadata) return {};

  return Object.fromEntries(
    metadata.groups.map((group) => [
      group.key,
      Object.fromEntries(
        metadata.actions.map((action) => [
          action.key,
          group.supportedActions.includes(action.key)
            ? Boolean(value?.[group.key]?.[action.key])
            : false,
        ]),
      ),
    ]),
  ) as PermissionMatrixValue;
}

function createEmptyForm(
  metadata: PropertyPermissionMetadataResponse | null,
): PropertyUserForm {
  return {
    firstName: "",
    lastName: "",
    mobile: "",
    email: "",
    username: "",
    status: "Pending",
    role: "Manager",
    isActive: false,
    permissions: normalizePermissionMatrix(
      metadata?.roleDefaults.Manager,
      metadata,
    ),
  };
}

function statusVariant(status: PropertyUserStatus) {
  if (status === "Active") return "success" as const;
  if (status === "Pending") return "warning" as const;
  if (status === "Inactive") return "muted" as const;
  return "destructive" as const;
}

function splitFullName(fullName: string) {
  const [firstName = "", ...lastNameParts] = fullName.trim().split(/\s+/);
  return { firstName, lastName: lastNameParts.join(" ") };
}

function toForm(
  user: PropertyUserResponse,
  metadata: PropertyPermissionMetadataResponse,
): PropertyUserForm {
  const identity = splitFullName(user.fullName);
  return {
    ...identity,
    mobile: user.mobile ?? "",
    email: user.email,
    username: user.username,
    status: user.status,
    role: user.role === "PropertyOwner" ? "Manager" : user.role,
    isActive: user.isActive,
    permissions: normalizePermissionMatrix(user.permissions, metadata),
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
  context = "owner",
  propertyId,
}: {
  context?: "admin" | "owner";
  propertyId: number;
}) {
  const [users, setUsers] = useState<PropertyUserResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [identityErrors, setIdentityErrors] =
    useState<CreateUserIdentityErrors>({});
  const [createStep, setCreateStep] =
    useState<PropertyUserCreateStep>("lookup");
  const [candidateRequiresCreation, setCandidateRequiresCreation] =
    useState(false);
  const [candidateMaskedName, setCandidateMaskedName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<PropertyUserResponse | null>(
    null,
  );
  const [activityUser, setActivityUser] = useState<PropertyUserResponse | null>(
    null,
  );
  const [setupLink, setSetupLink] = useState("");
  const [permissionMetadata, setPermissionMetadata] =
    useState<PropertyPermissionMetadataResponse | null>(null);
  const [form, setForm] = useState<PropertyUserForm>(() =>
    createEmptyForm(null),
  );
  const [propertyName, setPropertyName] = useState("");
  const { platformRole, refreshSession, user: sessionUser } = useAuthSession();
  const apiBase = `/${context}/properties/${propertyId}/users`;
  const propertyApiBase = `/${context}/properties/${propertyId}`;

  const ownerCount = useMemo(
    () => users.filter((user) => user.role === "PropertyOwner").length,
    [users],
  );
  const actorUser = useMemo(
    () => users.find((user) => user.userId === sessionUser?.userId) ?? null,
    [sessionUser?.userId, users],
  );
  const hasGlobalPropertyUserAccess = platformRole === "SuperAdmin";
  const actorPropertyRole = useMemo<PropertyUserRole>(() => {
    if (hasGlobalPropertyUserAccess) {
      return "PropertyOwner";
    }
    return actorUser?.role ?? "Custom";
  }, [actorUser, hasGlobalPropertyUserAccess]);
  const availableRoleOptions = useMemo(
    () =>
      roleOptions.filter(
        (role) => roleRank(role.value) <= roleRank(actorPropertyRole),
      ),
    [actorPropertyRole],
  );

  async function refreshSessionAfterSelfChange(userId: number) {
    if (userId === sessionUser?.userId) {
      await refreshSession({ redirectOnUnauthorized: true });
    }
  }

  function canManageRole(role: PropertyUserRole) {
    return roleRank(role) <= roleRank(actorPropertyRole);
  }

  function hasUserPermission(action: "view" | "create" | "edit" | "delete") {
    return Boolean(
      permissionMetadata?.actorAssignablePermissions?.Users?.[action],
    );
  }

  function canGrantPermission(group: string, action: PermissionAction) {
    return Boolean(
      permissionMetadata?.actorAssignablePermissions?.[group]?.[action],
    );
  }

  function restrictPermissions(
    matrix: PermissionMatrixValue,
    preserved?: PermissionMatrixValue,
  ) {
    const normalized = normalizePermissionMatrix(matrix, permissionMetadata);
    if (!permissionMetadata) {
      return normalized;
    }

    const preservedPermissions = normalizePermissionMatrix(
      preserved,
      permissionMetadata,
    );
    const next = normalizePermissionMatrix(null, permissionMetadata);
    permissionMetadata.groups.forEach((group) => {
      permissionMetadata.actions.forEach((action) => {
        next[group.key][action.key] = canGrantPermission(group.key, action.key)
          ? Boolean(normalized[group.key]?.[action.key])
          : Boolean(preservedPermissions[group.key]?.[action.key]);
      });
    });
    return next;
  }

  function hierarchyError(message = "امکان مدیریت نقش بالاتر وجود ندارد.") {
    setError(message);
    toast.error(message);
  }

  async function load() {
    setError("");
    const [property, userItems, metadata] = await Promise.all([
      apiRequest<PropertyResponse>(propertyApiBase).catch(() => null),
      apiRequest<PropertyUserResponse[]>(apiBase),
      apiRequest<PropertyPermissionMetadataResponse>(
        `${apiBase}/permission-metadata`,
      ),
    ]);
    setPropertyName(property?.name ?? "");
    setUsers(userItems);
    setPermissionMetadata(metadata);
    setForm(createEmptyForm(metadata));
  }

  useEffect(() => {
    load()
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [apiBase, propertyApiBase]);

  function openCreate() {
    if (!permissionMetadata) return;
    setEditingUser(null);
    const defaultRole =
      (availableRoleOptions[0]?.value as PropertyUserForm["role"] | undefined) ??
      "Custom";
    setIdentityErrors({});
    setCreateStep("lookup");
    setCandidateRequiresCreation(false);
    setCandidateMaskedName("");
    setForm({
      ...createEmptyForm(permissionMetadata),
      role: defaultRole,
      permissions: restrictPermissions(
        permissionMetadata.roleDefaults[defaultRole],
      ),
    });
    setDialogOpen(true);
  }

  function openEdit(user: PropertyUserResponse) {
    if (!permissionMetadata) return;
    if (!canManageRole(user.role)) {
      hierarchyError("شما نمی‌توانید کاربری با نقش بالاتر را ویرایش کنید.");
      return;
    }
    setEditingUser(user);
    const userForm = toForm(user, permissionMetadata);
    setIdentityErrors({});
    setCreateStep("lookup");
    setCandidateRequiresCreation(false);
    setCandidateMaskedName("");
    setForm({
      ...userForm,
      permissions: restrictPermissions(
        userForm.permissions,
        userForm.permissions,
      ),
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingUser && createStep === "lookup") {
      if (!form.mobile.trim()) {
        const message = "شماره موبایل را وارد کنید.";
        setIdentityErrors({ mobile: message });
        toast.error(message);
        return;
      }

      setSaving(true);
      setError("");
      try {
        const candidate = await apiRequest<PropertyUserCandidateResponse>(
          `${apiBase}/resolve`,
          {
            method: "POST",
            body: JSON.stringify({ mobile: form.mobile }),
          },
        );

        if (candidate.outcome === "AlreadyMember") {
          const message = "این کاربر قبلاً عضو همین اقامتگاه است.";
          setError(message);
          toast.error(message);
          return;
        }

        if (candidate.outcome === "Unavailable") {
          const message = "عملیات قابل انجام نیست.";
          setError(message);
          toast.error(message);
          return;
        }

        setCandidateRequiresCreation(candidate.requiresUserCreation);
        setCandidateMaskedName(candidate.maskedName ?? "");
        setIdentityErrors({});
        setCreateStep(
          candidate.requiresUserCreation ? "identity" : "membership",
        );
      } catch (caught) {
        const message = getCreateUserApiError(
          caught,
          "بررسی شماره موبایل انجام نشد.",
        );
        setError(message);
        toast.error(message);
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!editingUser && createStep === "identity") {
      const nextIdentityErrors = validateCreateUserIdentity({
        firstName: form.firstName,
        lastName: form.lastName,
        mobile: form.mobile,
        email: form.email,
      });
      setIdentityErrors(nextIdentityErrors);
      if (hasCreateUserIdentityErrors(nextIdentityErrors)) {
        const message = Object.values(nextIdentityErrors)[0]!;
        setError(message);
        toast.error(message);
        return;
      }

      setCreateStep("membership");
      return;
    }

    if (editingUser) {
      const nextIdentityErrors = validateCreateUserIdentity({
        firstName: form.firstName,
        lastName: form.lastName,
        mobile: form.mobile,
        email: form.email,
      });
      setIdentityErrors(nextIdentityErrors);
      if (hasCreateUserIdentityErrors(nextIdentityErrors)) {
        const message = Object.values(nextIdentityErrors)[0]!;
        setError(message);
        toast.error(message);
        return;
      }
    }

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

      const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
      const body = editingUser
        ? {
            fullName,
            mobile: form.mobile,
            email: form.email.trim() || null,
            username: form.username || null,
            role: form.role,
            status: form.status,
            isActive: form.isActive,
            permissions: restrictPermissions(
              form.permissions,
              normalizePermissionMatrix(
                editingUser.permissions,
                permissionMetadata,
              ),
            ),
          }
        : {
            fullName: candidateRequiresCreation ? fullName : null,
            mobile: form.mobile,
            email: candidateRequiresCreation
              ? form.email.trim() || null
              : null,
            username: null,
            role: form.role,
            status: form.status,
            isActive: form.status === "Active",
            permissions: restrictPermissions(form.permissions),
          };
      const saved = await apiRequest<PropertyUserResponse>(
        editingUser
          ? `${apiBase}/${editingUser.userId}`
          : apiBase,
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
      await refreshSessionAfterSelfChange(saved.userId);
      if (
        !editingUser &&
        saved.temporarySetupLink &&
        process.env.NODE_ENV !== "production"
      ) {
        setSetupLink(saved.temporarySetupLink);
      }
      setDialogOpen(false);
      toast.success(
        editingUser ? "کاربر اقامتگاه ذخیره شد" : "عضویت کاربر ثبت شد",
      );
    } catch (caught) {
      const message = getCreateUserApiError(
        caught,
        "ذخیره کاربر انجام نشد.",
      );
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
        `${apiBase}/${user.userId}/${action}`,
        {
          method: "PUT",
        },
      );
      setUsers((current) =>
        current.map((item) => (item.userId === saved.userId ? saved : item)),
      );
      await refreshSessionAfterSelfChange(saved.userId);
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

  async function resendInvitation(user: PropertyUserResponse) {
    if (!canManageRole(user.role)) {
      hierarchyError("شما نمی‌توانید دعوت کاربری با نقش بالاتر را دوباره ارسال کنید.");
      return;
    }
    try {
      const saved = await apiRequest<PropertyUserResponse>(
        `${apiBase}/${user.userId}/resend-invitation`,
        { method: "POST" },
      );
      setUsers((current) =>
        current.map((item) => (item.userId === saved.userId ? saved : item)),
      );
      if (
        saved.temporarySetupLink &&
        process.env.NODE_ENV !== "production"
      ) {
        setSetupLink(saved.temporarySetupLink);
      }
      toast.success("دعوت‌نامه دوباره ارسال شد.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "ارسال دوباره دعوت‌نامه انجام نشد.";
      setError(message);
      toast.error(message);
      throw caught;
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

      {setupLink && process.env.NODE_ENV !== "production" && (
        <div className="mx-5 rounded-lg border border-primary/30 bg-primary/10 p-3">
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
                      {user.passwordSetupRequired && canManageRole(user.role) && hasUserPermission("edit") && (
                        <KoochConfirmDialog
                          cancelText="انصراف"
                          confirmText="ارسال دوباره"
                          description="یک لینک جدید تنظیم رمز برای این کاربر ساخته می‌شود و لینک‌های فعال قبلی نامعتبر می‌شوند."
                          onConfirm={() => resendInvitation(user)}
                          title="ارسال دوباره دعوت‌نامه"
                          trigger={
                            <KoochButton
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              ارسال دعوت
                            </KoochButton>
                          }
                          variant="info"
                        />
                      )}
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
              {!editingUser && createStep !== "membership" ? "ادامه" : "ذخیره"}
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
          <KoochCard className="border-primary/20 bg-primary/10" padding="sm">
            <p className="text-xs font-black text-muted-foreground">
              اقامتگاه فعلی
            </p>
            <p className="mt-1 text-sm font-black text-foreground">
              {propertyName || "این اقامتگاه"}
            </p>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              کاربر جدید فقط به همین اقامتگاه اضافه می‌شود.
            </p>
          </KoochCard>
          {!editingUser && createStep === "lookup" && (
            <KoochCard padding="sm" variant="muted">
              <div className="grid gap-4">
                <div>
                  <h3 className="text-sm font-black text-foreground">
                    افزودن با شماره موبایل
                  </h3>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    فقط امکان افزودن به همین اقامتگاه بررسی می‌شود.
                  </p>
                </div>
                <KoochField
                  error={identityErrors.mobile}
                  label="شماره موبایل"
                  required
                >
                  <KoochInput
                    dir="ltr"
                    error={identityErrors.mobile}
                    inputMode="tel"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        mobile: event.target.value,
                      }))
                    }
                    required
                    value={form.mobile}
                  />
                </KoochField>
              </div>
            </KoochCard>
          )}

          {(editingUser || createStep === "identity") && (
            <KoochCard padding="sm" variant="muted">
              <div className="grid gap-4">
                <div>
                  <h3 className="text-sm font-black text-foreground">
                    اطلاعات کاربر
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    مشخصات هویتی حساب جدید را وارد کنید.
                  </p>
                </div>
                <CreateUserFields
                  errors={identityErrors}
                  idPrefix="property-user"
                  mobileReadOnly={!editingUser}
                  onChange={(identity) =>
                    setForm((current) => ({
                      ...current,
                      firstName: identity.firstName,
                      lastName: identity.lastName,
                      mobile: identity.mobile,
                      email: identity.email,
                    }))
                  }
                  value={{
                    firstName: form.firstName,
                    lastName: form.lastName,
                    mobile: form.mobile,
                    email: form.email,
                  }}
                />
              </div>
            </KoochCard>
          )}

          {!editingUser && createStep === "membership" && (
            <KoochCard padding="sm" variant="muted">
              <p className="text-xs font-black text-muted-foreground">
                کاربر انتخاب‌شده
              </p>
              <p className="mt-1 text-sm font-black text-foreground">
                {candidateRequiresCreation
                  ? `${form.firstName} ${form.lastName}`.trim()
                  : candidateMaskedName || "کاربر موجود"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                {form.mobile}
              </p>
            </KoochCard>
          )}

          {(editingUser || createStep === "membership") && (
            <>
              <KoochCard padding="sm">
                <div className="grid gap-4">
                  <div>
                    <h3 className="text-sm font-black text-foreground">
                      نقش و سطح دسترسی
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      انتخاب نقش، matrix پیش‌فرض را اعمال می‌کند و سپس می‌توانید مجوزها را ویرایش کنید.
                    </p>
                  </div>
                  <KoochField label="نقش اقامتگاه" required>
                    <KoochSelect
                      onChange={(event) => {
                        const role = event.target
                          .value as PropertyUserForm["role"];
                        setForm((current) => ({
                          ...current,
                          role,
                          permissions: restrictPermissions(
                            permissionMetadata?.roleDefaults[role] ?? {},
                            editingUser
                              ? normalizePermissionMatrix(
                                  editingUser.permissions,
                                  permissionMetadata,
                                )
                              : undefined,
                          ),
                        }));
                      }}
                      value={form.role}
                    >
                      {roleOptions.map((role) => (
                        <option
                          disabled={
                            !availableRoleOptions.some(
                              (item) => item.value === role.value,
                            )
                          }
                          key={role.value}
                          value={role.value}
                        >
                          {role.label}
                        </option>
                      ))}
                    </KoochSelect>
                  </KoochField>

                  <div className="grid gap-2">
                    <div>
                      <h3 className="text-sm font-black text-foreground">
                        سطح دسترسی
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        فقط دسترسی‌های همین اقامتگاه و در محدوده دسترسی‌های فعلی شما قابل واگذاری هستند.
                      </p>
                    </div>
                    <PermissionMatrix
                      actions={permissionMetadata?.actions ?? []}
                      disabled={
                        !hasUserPermission(editingUser ? "edit" : "create")
                      }
                      groups={permissionMetadata?.groups ?? []}
                      isActionDisabled={(group, action) =>
                        !canGrantPermission(group, action)
                      }
                      onChange={(permissions) =>
                        setForm((current) => ({
                          ...current,
                          permissions: restrictPermissions(
                            permissions,
                            editingUser
                              ? normalizePermissionMatrix(
                                  editingUser.permissions,
                                  permissionMetadata,
                                )
                              : undefined,
                          ),
                        }))
                      }
                      value={form.permissions}
                    />
                  </div>
                </div>
              </KoochCard>

              {editingUser && (
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
              )}

              <KoochField label="وضعیت عضویت">
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
              </KoochField>
            </>
          )}        </form>
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


