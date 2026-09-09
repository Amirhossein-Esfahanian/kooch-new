"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
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
  KoochSearchableSelect,
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
  PropertyResponse,
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
type AdminUsersView = "platform" | "property";

const adminUserViews: Array<{ id: AdminUsersView; label: string }> = [
  { id: "platform", label: "کاربران مدیریتی سامانه" },
  { id: "property", label: "اعضای اقامتگاه‌ها" },
];

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

type UserWizardStep = 1 | 2 | 3;

const userWizardSteps: Array<{ step: UserWizardStep; label: string }> = [
  { step: 1, label: "اطلاعات" },
  { step: 2, label: "مجوزها" },
  { step: 3, label: "بررسی و امنیت" },
];

function permissionLabel(permissionKey: AdminPermissionKey) {
  for (const category of permissionCategories) {
    const permission = category.permissions.find(
      (item) => item.key === permissionKey,
    );
    if (permission) return permission.label;
  }
  return permissionKey;
}

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

function normalizeIranMobileInput(value: string) {
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

  return value
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/\D/g, "")
    .slice(0, 11);
}

function validateIranMobile(value: string) {
  if (!value) return "شماره موبایل الزامی است.";
  if (!/^09\d{9}$/.test(value)) {
    return "شماره موبایل باید ۱۱ رقم، فقط عدد و با ۰۹ شروع شود؛ مانند 09132645025.";
  }
  return "";
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
  const router = useRouter();
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
  const [wizardStep, setWizardStep] = useState<UserWizardStep>(1);
  const wizardContentRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [identityErrors, setIdentityErrors] =
    useState<CreateUserIdentityErrors>({});
  const [setupLink, setSetupLink] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all");
  const [activeView, setActiveView] = useState<AdminUsersView>("platform");
  const viewTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [propertiesError, setPropertiesError] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const canManageUsers =
    platformRole === "SuperAdmin" ||
    platformPermissions.includes("ManageUsers");
  const canBrowseProperties =
    platformRole === "SuperAdmin" ||
    platformPermissions.includes("ManageProperties");
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
  const selectedAssignablePermissionCount = assignablePermissionKeys.filter(
    (permission) => form.permissions.includes(permission),
  ).length;

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
  const propertyOptions = useMemo(
    () =>
      properties.map((property) => ({
        value: property.id,
        label: property.name,
        description: [property.city, property.ownerName]
          .filter(Boolean)
          .join(" · "),
        searchText: [
          property.name,
          property.englishName,
          property.city,
          property.ownerName,
          property.ownerEmail,
          property.id,
        ]
          .filter(Boolean)
          .join(" "),
      })),
    [properties],
  );

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

  useEffect(() => {
    if (
      sessionLoading ||
      !authenticated ||
      !workspaces.includes("admin") ||
      !canManageUsers
    ) {
      return;
    }

    if (!canBrowseProperties) {
      setPropertiesLoading(false);
      return;
    }

    let active = true;
    setPropertiesError("");
    setPropertiesLoading(true);

    apiRequest<PropertyResponse[]>("/admin/properties")
      .then((items) => {
        if (active) setProperties(items);
      })
      .catch((caught: Error) => {
        if (active) setPropertiesError(caught.message);
      })
      .finally(() => {
        if (active) setPropertiesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    authenticated,
    canBrowseProperties,
    canManageUsers,
    sessionLoading,
    workspaces,
  ]);

  useLayoutEffect(() => {
    if (!dialogOpen) return;

    const dialogBody = wizardContentRef.current?.closest(
      '[data-slot="dialog-body"]',
    ) as HTMLElement | null;
    dialogBody?.scrollTo({ top: 0 });
  }, [dialogOpen, wizardStep]);

  function freezeWizardDialogHeight() {
    const dialogContent = wizardContentRef.current?.closest(
      '[data-slot="dialog-content"]',
    ) as HTMLElement | null;
    if (!dialogContent) return;

    // Freeze the whole dialog at the exact natural height of step 1.
    // Later steps can only scroll inside the body; they cannot resize it.
    const currentHeight = Math.ceil(
      dialogContent.getBoundingClientRect().height,
    );
    dialogContent.style.height = `${currentHeight}px`;
    dialogContent.style.maxHeight = `${currentHeight}px`;
  }

  function resetFilters() {
    setSearchTerm("");
    setRoleFilter("all");
    setStatusFilter("all");
  }

  function openCreate() {
    setForm(emptyForm);
    setError("");
    setIdentityErrors({});
    setWizardStep(1);
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
    setWizardStep(1);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setForm(emptyForm);
    setIdentityErrors({});
    setWizardStep(1);
  }

  function validateIdentityStep() {
    const nextIdentityErrors = validateCreateUserIdentity({
      firstName: form.firstName,
      lastName: form.lastName,
      mobile: form.phoneNumber,
      email: form.email,
    });
    const mobileError = validateIranMobile(form.phoneNumber);
    if (mobileError) nextIdentityErrors.mobile = mobileError;
    setIdentityErrors(nextIdentityErrors);
    if (hasCreateUserIdentityErrors(nextIdentityErrors)) {
      const message = Object.values(nextIdentityErrors)[0]!;
      setError(message);
      toast.error(message);
      return false;
    }

    setError("");
    return true;
  }

  function goToNextWizardStep() {
    if (wizardStep === 1) {
      if (!validateIdentityStep()) return;
      freezeWizardDialogHeight();
      setWizardStep(2);
      return;
    }

    if (wizardStep === 2) {
      setError("");
      setWizardStep(3);
    }
  }

  function goToPreviousWizardStep() {
    setError("");
    setWizardStep((current) =>
      current === 3 ? 2 : current === 2 ? 1 : current,
    );
  }

  function handleWizardSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (wizardStep < 3) goToNextWizardStep();
  }

  async function saveUser() {
    if (wizardStep !== 3 || saving) return;

    if (!validateIdentityStep()) {
      setWizardStep(1);
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

  function selectView(view: AdminUsersView) {
    setActiveView(view);
  }

  function handleViewTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number;

    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = adminUserViews.length - 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const isRtl = getComputedStyle(event.currentTarget).direction === "rtl";
      const moveForward = event.key === "ArrowLeft" ? isRtl : !isRtl;
      nextIndex =
        (currentIndex + (moveForward ? 1 : -1) + adminUserViews.length) %
        adminUserViews.length;
    } else {
      return;
    }

    event.preventDefault();
    selectView(adminUserViews[nextIndex].id);
    viewTabRefs.current[nextIndex]?.focus();
  }

  return (
    <AdminLayout requiredPlatformPermission="ManageUsers">
      <main className="mx-auto grid w-full min-w-0 max-w-[1480px] gap-5 overflow-x-hidden p-4 lg:p-6">
        <KoochPageHeader
          actions={
            activeView === "platform" ? (
              <KoochButton
                onClick={() => selectView("property")}
                type="button"
                variant="outline"
              >
                مدیریت اعضای اقامتگاه‌ها
              </KoochButton>
            ) : null
          }
          appearance="plain"
          description="مدیریت حساب‌های مدیریتی سامانه و دسترسی به اعضای هر اقامتگاه"
          eyebrow="پنل مدیریت"
          title="کاربران مدیریتی سامانه"
        />

        <div
          aria-label="بخش مدیریت کاربران"
          className="grid w-full grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:inline-grid sm:w-fit"
          dir="rtl"
          role="tablist"
        >
          {adminUserViews.map((view, index) => {
            const active = activeView === view.id;

            return (
              <button
                aria-controls={`admin-users-${view.id}-panel`}
                aria-selected={active}
                className={[
                  "min-h-11 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                ].join(" ")}
                id={`admin-users-${view.id}-tab`}
                key={view.id}
                onClick={() => selectView(view.id)}
                onKeyDown={(event) => handleViewTabKeyDown(event, index)}
                ref={(element) => {
                  viewTabRefs.current[index] = element;
                }}
                role="tab"
                tabIndex={active ? 0 : -1}
                type="button"
              >
                {view.label}
              </button>
            );
          })}
        </div>

        {activeView === "platform" && (
          <section
            aria-labelledby="admin-users-platform-tab"
            className="grid gap-4"
            id="admin-users-platform-panel"
            role="tabpanel"
          >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2
                className="text-lg font-semibold text-foreground"
                id="platform-admin-users-title"
              >
                کاربران مدیریتی سامانه
              </h2>
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                مدیران ارشد و دستیاران مدیریتی با دسترسی سراسری سامانه
              </p>
            </div>
            <KoochButton onClick={openCreate} type="button">
              <KoochIcon name="plus" />
              افزودن مدیر سامانه
            </KoochButton>
          </div>

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
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(320px,1fr)_180px_180px_auto] lg:items-end">
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

              <KoochButton
                disabled={!hasActiveFilters}
                onClick={resetFilters}
                type="button"
                variant="outline"
              >
                حذف فیلترها
              </KoochButton>
            </div>
          </KoochCard>
          )}

          {!loading && users.length > 0 && (
          <div
            className="flex min-h-6 flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground"
            dir="rtl"
          >
            <span>
              {hasActiveFilters
                ? `نمایش ${filteredUsers.length.toLocaleString("fa-IR")} از ${users.length.toLocaleString("fa-IR")} کاربر`
                : `${users.length.toLocaleString("fa-IR")} کاربر`}
            </span>

            {hasActiveFilters && (
              <span className="rounded-md bg-[var(--theme-warning-soft)] px-2 py-1 font-bold text-[var(--theme-warning)]">
                فیلتر فعال است
              </span>
            )}
          </div>
          )}

          <div className="min-w-0 max-w-full">
          <KoochTable>
            <KoochTableHeader>
              <KoochTableRow>
                <KoochTableHead>کاربر</KoochTableHead>
                <KoochTableHead>شماره تماس</KoochTableHead>
                <KoochTableHead>نقش</KoochTableHead>
                <KoochTableHead>وضعیت</KoochTableHead>
                <KoochTableHead className="w-28">عملیات</KoochTableHead>
              </KoochTableRow>
            </KoochTableHeader>

            <KoochTableBody>
              {loading ? (
                <KoochTableEmpty colSpan={5}>
                  در حال بارگذاری...
                </KoochTableEmpty>
              ) : users.length === 0 ? (
                <KoochTableEmpty colSpan={5}>
                  هنوز کاربری ثبت نشده است.
                </KoochTableEmpty>
              ) : filteredUsers.length === 0 ? (
                <KoochTableEmpty colSpan={5}>
                  موردی با فیلترهای انتخاب‌شده پیدا نشد.
                </KoochTableEmpty>
              ) : (
                filteredUsers.map((user) => (
                  <KoochTableRow key={user.id}>
                    <KoochTableCell className="min-w-56">
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

                    <KoochTableCell>
                      <span className="font-medium" dir="ltr">
                        {user.phoneNumber || "—"}
                      </span>
                    </KoochTableCell>

                    <KoochTableCell>
                      <KoochBadge variant="muted">
                        {roleLabel(user.role)}
                      </KoochBadge>
                    </KoochTableCell>

                    <KoochTableCell>
                      <KoochBadge variant={statusVariant(user)}>
                        {statusLabel(user)}
                      </KoochBadge>
                    </KoochTableCell>

                    <KoochTableCell>
                      <div className="flex items-center gap-2">
                        {(platformRole === "SuperAdmin" ||
                          user.role !== "SuperAdmin") && (
                          <>
                            <KoochButton
                              aria-label="ویرایش کاربر"
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
                                    aria-label="غیرفعال‌سازی کاربر"
                                    title="غیرفعال‌سازی کاربر"
                                    size="sm"
                                    type="button"
                                    variant="destructive"
                                  >
                                    <KoochIcon name="suspend" />
                                  </KoochButton>
                                }
                                variant="destructive"
                              />
                            ) : (
                              <KoochButton
                                aria-label="فعال‌سازی کاربر"
                                title="فعال‌سازی کاربر"
                                onClick={() => setActive(user, true)}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                فعال‌سازی
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
          </section>
        )}

        {activeView === "property" && (
          <KoochCard
            aria-labelledby="admin-users-property-tab"
            className="min-w-0"
            id="admin-users-property-panel"
            padding="md"
            role="tabpanel"
          >
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)] lg:items-end">
            <div className="min-w-0">
              <h2
                className="text-lg font-semibold text-foreground"
                id="property-members-title"
              >
                اعضای اقامتگاه‌ها
              </h2>
              <p className="mt-1 max-w-2xl text-sm font-normal leading-6 text-muted-foreground">
                برای مدیریت مدیر و کارکنان، ابتدا اقامتگاه را انتخاب کنید.
                اعضا در صفحه اختصاصی همان اقامتگاه مدیریت می‌شوند.
              </p>
              <p className="mt-2 max-w-2xl text-xs font-normal leading-6 text-muted-foreground">
                مالک اقامتگاه از مسیر مدیریت یا انتقال مالکیت اقامتگاه تعیین می‌شود.
              </p>
            </div>

            {canBrowseProperties ? (
              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <KoochField label="اقامتگاه">
                  <KoochSearchableSelect
                    clearText="پاک کردن انتخاب اقامتگاه"
                    disabled={propertiesLoading}
                    emptyText="اقامتگاهی پیدا نشد."
                    id="property-members-property"
                    onChange={setSelectedPropertyId}
                    options={propertyOptions}
                    placeholder={
                      propertiesLoading
                        ? "در حال بارگذاری اقامتگاه‌ها..."
                        : "انتخاب یا جستجوی اقامتگاه"
                    }
                    searchPlaceholder="جستجو با نام، شهر یا مالک..."
                    value={selectedPropertyId}
                  />
                </KoochField>
                <KoochButton
                  disabled={!selectedPropertyId || propertiesLoading}
                  onClick={() =>
                    router.push(
                      `/admin/properties/${selectedPropertyId}/users`,
                    )
                  }
                  type="button"
                >
                  مدیریت اعضای اقامتگاه
                </KoochButton>
              </div>
            ) : (
              <KoochAlert icon="info" variant="information">
                برای مشاهده فهرست اقامتگاه‌ها، مجوز مدیریت اقامتگاه‌ها لازم است.
              </KoochAlert>
            )}
          </div>

          {propertiesError && (
            <KoochAlert
              className="mt-4"
              title="فهرست اقامتگاه‌ها بارگذاری نشد"
              variant="destructive"
            >
              {propertiesError}
            </KoochAlert>
          )}
          </KoochCard>
        )}

        <KoochDialog
          bodyClassName="overflow-x-hidden px-4 py-4"
          closeDisabled={saving}
          footer={
            <div
              className="flex w-full items-center justify-between gap-2"
              dir="rtl"
            >
              <div>
                {wizardStep > 1 && (
                  <KoochButton
                    disabled={saving}
                    onClick={goToPreviousWizardStep}
                    type="button"
                    variant="outline"
                  >
                    قبلی
                  </KoochButton>
                )}
              </div>

              <div className="flex items-center gap-2">
                <KoochButton
                  disabled={saving}
                  onClick={closeDialog}
                  type="button"
                  variant="ghost"
                >
                  لغو
                </KoochButton>

                {wizardStep < 3 ? (
                  <KoochButton
                    disabled={saving}
                    onClick={goToNextWizardStep}
                    type="button"
                  >
                    ادامه
                  </KoochButton>
                ) : (
                  <KoochButton
                    loading={saving}
                    onClick={() => void saveUser()}
                    type="button"
                  >
                    ذخیره
                  </KoochButton>
                )}
              </div>
            </div>
          }
          onOpenChange={(open) => {
            if (!open) closeDialog();
            else setDialogOpen(true);
          }}
          open={dialogOpen}
          size="sm"
          title={form.id ? "ویرایش مدیر سامانه" : "افزودن مدیر سامانه"}
        >
          <form
            className="grid gap-4"
            id="admin-user-form"
            onSubmit={handleWizardSubmit}
          >
            <div ref={wizardContentRef}>
              <div
                aria-label="مراحل فرم مدیر سامانه"
                className="relative grid min-w-0 grid-cols-3 items-start pb-2"
                dir="rtl"
              >
                <span
                  aria-hidden="true"
                  className={`absolute right-[16.6667%] top-[11px] h-0.5 w-1/3 rounded-full transition-colors duration-150 ease-out ${
                    wizardStep >= 2 ? "bg-primary" : "bg-border"
                  }`}
                />
                <span
                  aria-hidden="true"
                  className={`absolute right-1/2 top-[11px] h-0.5 w-1/3 rounded-full transition-colors duration-150 ease-out ${
                    wizardStep >= 3 ? "bg-primary" : "bg-border"
                  }`}
                />

                {userWizardSteps.map((item) => {
                  const active = wizardStep === item.step;
                  const completed = wizardStep > item.step;
                  const reached = active || completed;

                  return (
                    <div
                      className="relative z-10 grid min-w-0 justify-items-center gap-1.5 px-1"
                      key={item.step}
                    >
                      <span
                        className={`grid h-6 w-6 place-items-center rounded-full border text-[10px] font-bold transition-colors duration-150 ease-out ${
                          reached
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground"
                        }`}
                      >
                        {item.step.toLocaleString("fa-IR")}
                      </span>
                      <span
                        className={`max-w-full truncate text-center text-[11px] font-medium leading-4 ${
                          reached ? "text-primary" : "text-muted-foreground"
                        }`}
                        title={item.label}
                      >
                        {item.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {wizardStep === 1 && (
              <div className="grid min-w-0 gap-4 [&_label]:text-[13px] [&_label]:font-semibold [&_label]:leading-5">
                <div className="min-w-0 [&>div]:!grid-cols-1 [&>div]:items-start">
                  <CreateUserFields
                    errors={identityErrors}
                    idPrefix="admin-user"
                    onChange={(identity) =>
                      setForm((current) => ({
                        ...current,
                        firstName: identity.firstName,
                        lastName: identity.lastName,
                        phoneNumber: normalizeIranMobileInput(identity.mobile),
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
                </div>

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
            )}

            {wizardStep === 2 && form.role === "AdminAssistant" && (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      مجوزهای دسترسی
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {selectedAssignablePermissionCount.toLocaleString(
                        "fa-IR",
                      )}{" "}
                      از{" "}
                      {assignablePermissionKeys.length.toLocaleString("fa-IR")}{" "}
                      مجوز انتخاب شده
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
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
                      disabled={selectedAssignablePermissionCount === 0}
                      onClick={() =>
                        setCategoryPermissions(assignablePermissionKeys, false)
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      پاک کردن
                    </KoochButton>
                  </div>
                </div>

                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                  {assignablePermissionCategories.map((category) => {
                    const categoryKeys = category.permissions.map(
                      (permission) => permission.key,
                    );
                    const categorySelected = categoryKeys.every((permission) =>
                      form.permissions.includes(permission),
                    );
                    const singlePermission = category.permissions.length === 1;

                    if (singlePermission) {
                      const permission = category.permissions[0];
                      return (
                        <div className="px-3 py-2.5" key={category.key}>
                          <KoochCheckbox
                            checked={form.permissions.includes(permission.key)}
                            label={permission.label}
                            onChange={(event) =>
                              setPermission(
                                permission.key,
                                event.target.checked,
                              )
                            }
                          />
                        </div>
                      );
                    }

                    return (
                      <div
                        className="grid gap-2.5 px-3 py-3"
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
                          wrapperClassName="font-bold"
                        />
                        <div className="grid gap-2 border-r border-border pr-4">
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
            )}

            {wizardStep === 2 && form.role === "SuperAdmin" && (
              <KoochCard padding="sm" variant="muted">
                <p className="text-sm font-bold text-foreground">دسترسی کامل</p>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  مدیر ارشد به‌صورت پیش‌فرض به همه بخش‌های پنل مدیریت دسترسی
                  دارد و نیازی به انتخاب مجوز جداگانه نیست.
                </p>
              </KoochCard>
            )}

            {wizardStep === 3 && (
              <div className="grid gap-4">
                <KoochCard padding="sm" variant="muted">
                  <div className="grid gap-3 text-sm">
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-muted-foreground">مدیر سامانه</span>
                      <span className="text-left font-bold text-foreground">
                        {[form.firstName, form.lastName]
                          .filter(Boolean)
                          .join(" ") || "—"}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-muted-foreground">شماره تماس</span>
                      <span className="font-semibold text-foreground" dir="ltr">
                        {form.phoneNumber || "—"}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-muted-foreground">ایمیل</span>
                      <span
                        className="max-w-[65%] break-all text-left font-semibold text-foreground"
                        dir="ltr"
                      >
                        {form.email || "—"}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-muted-foreground">نقش</span>
                      <KoochBadge variant="muted">
                        {roleLabels[form.role]}
                      </KoochBadge>
                    </div>
                  </div>
                </KoochCard>

                {form.role === "AdminAssistant" && (
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-foreground">
                        مجوزهای انتخاب‌شده
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {selectedAssignablePermissionCount.toLocaleString(
                          "fa-IR",
                        )}{" "}
                        مجوز
                      </span>
                    </div>
                    {selectedAssignablePermissionCount > 0 ? (
                      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
                        {assignablePermissionKeys
                          .filter((permission) =>
                            form.permissions.includes(permission),
                          )
                          .map((permission) => (
                            <KoochBadge key={permission} variant="muted">
                              {permissionLabel(permission)}
                            </KoochBadge>
                          ))}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        هیچ مجوز سراسری انتخاب نشده است.
                      </p>
                    )}
                  </div>
                )}

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
              </div>
            )}
          </form>
        </KoochDialog>
      </main>
    </AdminLayout>
  );
}
