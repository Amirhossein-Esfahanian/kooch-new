"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KoochButton } from "@/components/KoochButton";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochCard } from "@/components/KoochCard";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochField,
  KoochInput,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import { KoochIcon } from "@/components/KoochIcon";
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
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import {
  apiRequest,
  AdminPropertyOwnerAccountResponse,
  InventoryMode,
  PropertyResponse,
  PropertyStatus,
  propertyTypes,
  PropertyType,
  PropertyUserRole,
  resolveDestinationId,

} from "@/lib/owner-api";

const statuses: PropertyStatus[] = [
  "Draft",
  "PendingReview",
  "Approved",
  "Rejected",
  "Suspended",
];

const statusLabels: Record<PropertyStatus, string> = {
  Draft: "پیش‌نویس",
  PendingReview: "در انتظار تایید",
  Approved: "تایید شده",
  Rejected: "رد شده",
  Suspended: "تعلیق شده",
};

const actionLinkClass =
  "inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

const propertyTypeLabels: Record<PropertyType, string> = {
  TraditionalHouse: "خانه سنتی",
  BoutiqueHotel: "هتل بوتیک",
  EcoLodge: "بوم‌گردی",
  Hotel: "هتل",
  Villa: "ویلا",
  Apartment: "آپارتمان",
};

type AdminCreateMode = "existing-owner" | "new-owner";
type TransferOwnerMode = "existing-owner" | "new-owner";
type PreviousOwnerAction = "DeactivateMembership" | "Demote";
type PropertyStatusFilter = "all" | PropertyStatus;
type PropertyTypeFilter = "all" | PropertyType;

type CreatePropertyForm = {
  ownerMode: AdminCreateMode;
  ownerId: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerPhoneNumber: string;
  ownerPassword: string;
  name: string;
  englishName: string;
  type: PropertyType;
  city: string;
  address: string;
  description: string;
  inventoryMode: InventoryMode;
};

const previousOwnerRoleOptions: Exclude<PropertyUserRole, "PropertyOwner">[] = [
  "Manager",
  "Reception",
  "Accounting",
  "Housekeeping",
  "Custom",
];

const propertyUserRoleLabels: Record<PropertyUserRole, string> = {
  PropertyOwner: "Owner",
  Manager: "Manager",
  Reception: "Reception",
  Accounting: "Accounting",
  Housekeeping: "Housekeeping",
  Custom: "Custom",
};

type TransferOwnershipForm = {
  ownerMode: TransferOwnerMode;
  newOwnerId: string;
  newOwnerFirstName: string;
  newOwnerLastName: string;
  newOwnerEmail: string;
  newOwnerPhoneNumber: string;
  newOwnerPassword: string;
  previousOwnerAction: PreviousOwnerAction;
  previousOwnerRole: Exclude<PropertyUserRole, "PropertyOwner">;
};

const emptyTransferForm: TransferOwnershipForm = {
  ownerMode: "existing-owner",
  newOwnerId: "",
  newOwnerFirstName: "",
  newOwnerLastName: "",
  newOwnerEmail: "",
  newOwnerPhoneNumber: "",
  newOwnerPassword: "",
  previousOwnerAction: "DeactivateMembership",
  previousOwnerRole: "Manager",
};

const emptyCreateForm: CreatePropertyForm = {
  ownerMode: "existing-owner",
  ownerId: "",
  ownerFirstName: "",
  ownerLastName: "",
  ownerEmail: "",
  ownerPhoneNumber: "",
  ownerPassword: "",
  name: "",
  englishName: "",
  type: "TraditionalHouse",
  city: "Kashan",
  address: "",
  description: "",
  inventoryMode: "NamedRooms",
};

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("ي", "ی")
    .replaceAll("ك", "ک");
}

export default function AdminPropertiesPage() {
  const router = useRouter();
  const { authenticated, loading: sessionLoading, workspaces } = useAuthSession();
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [users, setUsers] = useState<AdminPropertyOwnerAccountResponse[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<CreatePropertyForm>(emptyCreateForm);
  const [creating, setCreating] = useState(false);
  const [transferProperty, setTransferProperty] = useState<PropertyResponse | null>(null);
  const [transferForm, setTransferForm] = useState<TransferOwnershipForm>(emptyTransferForm);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState("");
  const [createIdentityErrors, setCreateIdentityErrors] =
    useState<CreateUserIdentityErrors>({});
  const [transferIdentityErrors, setTransferIdentityErrors] =
    useState<CreateUserIdentityErrors>({});
  const [setupLink, setSetupLink] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<PropertyStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<PropertyTypeFilter>("all");

  const ownerOptions = useMemo(
    () => users,
    [users],
  );

  const filteredProperties = useMemo(() => {
    const normalizedSearch = normalizeSearchText(searchTerm);

    return properties.filter((property) => {
      const matchesSearch =
        !normalizedSearch ||
        [
          property.name,
          property.englishName,
          property.city,
          property.ownerName,
          property.ownerEmail,
          property.ownerId,
          // property.slug,
          // statusLabels[property.status],
          propertyTypeLabels[property.type],
        ]
          .map(normalizeSearchText)
          .some((value) => value.includes(normalizedSearch));

      const matchesStatus =
        statusFilter === "all" || property.status === statusFilter;

      const matchesType = typeFilter === "all" || property.type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [properties, searchTerm, statusFilter, typeFilter]);

  const hasActiveFilters =
    Boolean(searchTerm.trim()) ||
    statusFilter !== "all" ||
    typeFilter !== "all";

  const selectedTransferOwner = transferForm.newOwnerId
    ? users.find((user) => user.id === Number(transferForm.newOwnerId)) ?? null
    : null;

  const load = useCallback(async () => {
    const [propertyItems, userItems] = await Promise.all([
      apiRequest<PropertyResponse[]>("/admin/properties"),
      apiRequest<AdminPropertyOwnerAccountResponse[]>("/admin/properties/owner-candidates").catch(() => []),
    ]);

    setProperties(propertyItems);
    setUsers(userItems);
  }, []);

  useEffect(() => {
    if (sessionLoading || !authenticated || !workspaces.includes("admin")) return;

    load()
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [authenticated, load, sessionLoading, workspaces]);

  function resetFilters() {
    setSearchTerm("");
    setStatusFilter("all");
    setTypeFilter("all");
  }

  async function setStatus(id: number, status: PropertyStatus) {
    setWorkingId(id);
    setError("");

    try {
      const updated = await apiRequest<PropertyResponse>(
        `/admin/properties/${id}/status`,
        { method: "PUT", body: JSON.stringify({ status }) },
      );

      setProperties((current) =>
        current.map((property) => (property.id === id ? updated : property)),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تغییر وضعیت اقامتگاه انجام نشد.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  function openCreateDialog() {
    setCreateForm({
      ...emptyCreateForm,
      ownerId: ownerOptions[0]?.id ? String(ownerOptions[0].id) : "",
    });
    setError("");
    setCreateIdentityErrors({});
    setCreateOpen(true);
  }

  async function createOwnerIfNeeded() {
    if (createForm.ownerMode === "existing-owner") {
      if (!createForm.ownerId) {
        throw new Error("مالک اقامتگاه را انتخاب کنید.");
      }

      return { ownerId: Number(createForm.ownerId), setupLink: null };
    }

    const createdOwner = await apiRequest<AdminPropertyOwnerAccountResponse>("/admin/properties/owner-candidates", {
      method: "POST",
      body: JSON.stringify({
        firstName: createForm.ownerFirstName.trim(),
        lastName: createForm.ownerLastName.trim(),
        email: createForm.ownerEmail.trim() || null,
        phoneNumber: createForm.ownerPhoneNumber.trim(),
        password: createForm.ownerPassword.trim() || null,
      }),
    });

    setUsers((current) => [...current, createdOwner]);

    const ownerSetupLink = createdOwner.temporarySetupLink ?? null;

    if (ownerSetupLink && process.env.NODE_ENV !== "production") {
      setSetupLink(ownerSetupLink);
    }

    return { ownerId: createdOwner.id, setupLink: ownerSetupLink };
  }

  function openTransferDialog(property: PropertyResponse) {
    const firstCandidate = ownerOptions.find((owner) => owner.id !== property.ownerId);
    setTransferProperty(property);
    setTransferForm({
      ...emptyTransferForm,
      newOwnerId: firstCandidate ? String(firstCandidate.id) : "",
    });
    setError("");
    setTransferIdentityErrors({});
  }

  async function transferOwnership() {
    if (!transferProperty) return;

    if (transferForm.ownerMode === "existing-owner" && !transferForm.newOwnerId) {
      toast.error("Select the new owner.");
      throw new Error("Select the new owner.");
    }

    if (transferForm.ownerMode === "new-owner") {
      const nextIdentityErrors = validateCreateUserIdentity({
        firstName: transferForm.newOwnerFirstName,
        lastName: transferForm.newOwnerLastName,
        mobile: transferForm.newOwnerPhoneNumber,
        email: transferForm.newOwnerEmail,
      });
      setTransferIdentityErrors(nextIdentityErrors);
      if (hasCreateUserIdentityErrors(nextIdentityErrors)) {
        const message = Object.values(nextIdentityErrors)[0]!;
        toast.error(message);
        throw new Error(message);
      }

      if (!transferForm.newOwnerPassword.trim()) {
        const message = "رمز عبور اولیه مالک جدید را وارد کنید.";
        toast.error(message);
        throw new Error(message);
      }
    }

    setTransferring(true);
    setError("");
    try {
      const updated = await apiRequest<PropertyResponse>(
        `/admin/properties/${transferProperty.id}/transfer-ownership`,
        {
          method: "POST",
          body: JSON.stringify({
            newOwnerId:
              transferForm.ownerMode === "existing-owner"
                ? Number(transferForm.newOwnerId)
                : null,
            newOwner:
              transferForm.ownerMode === "new-owner"
                ? {
                    firstName: transferForm.newOwnerFirstName.trim(),
                    lastName: transferForm.newOwnerLastName.trim(),
                    email: transferForm.newOwnerEmail.trim() || null,
                    phoneNumber: transferForm.newOwnerPhoneNumber.trim(),
                    password: transferForm.newOwnerPassword,
                  }
                : null,
            previousOwnerAction: transferForm.previousOwnerAction,
            previousOwnerRole:
              transferForm.previousOwnerAction === "Demote"
                ? transferForm.previousOwnerRole
                : null,
          }),
        },
      );

      setProperties((current) =>
        current.map((property) =>
          property.id === updated.id ? updated : property,
        ),
      );
      await load();
      toast.success("Ownership transferred.");
      setTransferProperty(null);
      setTransferForm(emptyTransferForm);
    } catch (caught) {
      const message = getCreateUserApiError(
        caught,
        "انتقال مالکیت انجام نشد.",
      );
      setError(message);
      toast.error(message);
      throw caught;
    } finally {
      setTransferring(false);
    }
  }

  async function createDraftProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!createForm.name.trim()) {
      toast.error("نام اقامتگاه را وارد کنید.");
      return;
    }

    if (!createForm.city.trim()) {
      toast.error("شهر را وارد کنید.");
      return;
    }

    if (!createForm.address.trim()) {
      toast.error("آدرس را وارد کنید.");
      return;
    }

    if (createForm.ownerMode === "new-owner") {
      const nextIdentityErrors = validateCreateUserIdentity({
        firstName: createForm.ownerFirstName,
        lastName: createForm.ownerLastName,
        mobile: createForm.ownerPhoneNumber,
        email: createForm.ownerEmail,
      });
      setCreateIdentityErrors(nextIdentityErrors);
      if (hasCreateUserIdentityErrors(nextIdentityErrors)) {
        toast.error(Object.values(nextIdentityErrors)[0]!);
        return;
      }
    }

    setCreating(true);
    setError("");

    try {
      const owner = await createOwnerIfNeeded();

      const created = await apiRequest<PropertyResponse>("/admin/properties", {
        method: "POST",
        body: JSON.stringify({
          ownerId: owner.ownerId,
          destinationId: resolveDestinationId(createForm.city),
          name: createForm.name.trim(),
          englishName: createForm.englishName.trim() || null,
          description: createForm.description.trim() || createForm.name.trim(),
          address: createForm.address.trim(),
          city: createForm.city.trim(),
          country: "Iran",
          type: createForm.type,
          inventoryMode: createForm.inventoryMode,
          checkInTime: "14:00",
          checkOutTime: "12:00",
          breakfastOption: "NoBreakfast",
          status: "Draft",
          hasElevator: false,
        }),
      });

      toast.success("اقامتگاه پیش‌نویس ایجاد شد.");
      setCreateOpen(false);
      setCreateForm(emptyCreateForm);
      await load();

      if (!owner.setupLink || process.env.NODE_ENV === "production") {
        router.push(`/admin/properties/${created.id}`);
      }
    } catch (caught) {
      const message = getCreateUserApiError(
        caught,
        "ایجاد اقامتگاه انجام نشد.",
      );

      setError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <KoochButton onClick={openCreateDialog} type="button">
              <KoochIcon name="plus" />
              افزودن اقامتگاه
            </KoochButton>
          }
          description="اقامتگاه‌ها، وضعیت بررسی، ظرفیت و قیمت‌گذاری را از همین صفحه مدیریت کنید."
          eyebrow=""
          title="مدیریت اقامتگاه‌ها"
        />

        {/* {error && (
          <KoochCard
            className="border-destructive text-destructive"
            variant="elevated"
          >
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )} */}

        {setupLink && process.env.NODE_ENV !== "production" && (
          <KoochCard className="border-primary/30 bg-primary/10" padding="sm">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="text-sm font-black text-foreground">
                  لینک تنظیم رمز عبور مالک آماده است.
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

        {loading && (
          <KoochCard variant="elevated">
            <p className="text-sm text-muted-foreground">
              در حال بارگذاری اقامتگاه‌ها...
            </p>
          </KoochCard>
        )}

        {!loading && properties.length === 0 && (
          <KoochCard
            className="border-dashed text-center"
            padding="lg"
            variant="elevated"
          >
            <p className="text-sm text-muted-foreground">اقامتگاهی پیدا نشد.</p>
          </KoochCard>
        )}

        {!loading && properties.length > 0 && (
          <>
            <KoochCard padding="sm" variant="elevated">
              <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_220px_220px_auto] lg:items-end">
                <KoochField label="جستجو">
                  <KoochInput
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="نام اقامتگاه، مالک، ایمیل، شهر..."
                    value={searchTerm}
                  />
                </KoochField>

                <KoochField label="وضعیت">
                  <KoochSelect
                    onChange={(event) =>
                      setStatusFilter(
                        event.target.value as PropertyStatusFilter,
                      )
                    }
                    value={statusFilter}
                  >
                    <option value="all">همه وضعیت‌ها</option>
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {statusLabels[status]}
                      </option>
                    ))}
                  </KoochSelect>
                </KoochField>

                <KoochField label="نوع اقامتگاه">
                  <KoochSelect
                    onChange={(event) =>
                      setTypeFilter(event.target.value as PropertyTypeFilter)
                    }
                    value={typeFilter}
                  >
                    <option value="all">همه نوع‌ها</option>
                    {propertyTypes.map((type) => (
                      <option key={type} value={type}>
                        {propertyTypeLabels[type]}
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
                  نمایش {filteredProperties.length.toLocaleString("fa-IR")} از{" "}
                  {properties.length.toLocaleString("fa-IR")} اقامتگاه
                </span>

                {hasActiveFilters && (
                  <span className="rounded-md bg-amber-300 px-3 py-1 text-xs font-bold text-amber-800 dark:bg-amber-200 dark:text-primary-foreground">
                    فیلتر فعال است
                  </span>
                )}
              </div>
            </KoochCard>

            <KoochTable>
              <KoochTableHeader>
                <KoochTableRow>
                  <KoochTableHead className="w-14">ردیف</KoochTableHead>
                  <KoochTableHead>نام</KoochTableHead>
                  <KoochTableHead>مالک</KoochTableHead>
                  <KoochTableHead>وضعیت</KoochTableHead>
                  <KoochTableHead className="min-w-[280px]">
                    عملیات
                  </KoochTableHead>
                </KoochTableRow>
              </KoochTableHeader>

              <KoochTableBody>
                {filteredProperties.length === 0 ? (
                  <KoochTableEmpty colSpan={5}>
                    موردی با فیلترهای انتخاب‌شده پیدا نشد.
                  </KoochTableEmpty>
                ) : (
                  filteredProperties.map((property, index) => (
                    <KoochTableRow key={property.id}>
                      <KoochTableCell className="font-bold text-muted-foreground">
                        {index + 1}
                      </KoochTableCell>

                      <KoochTableCell>
                        <p className="font-black text-foreground">
                          {property.name}
                        </p>
                        {property.englishName && (
                          <p
                            className="text-xs text-muted-foreground"
                            dir="ltr"
                          >
                            {property.englishName}
                          </p>
                        )}
                      </KoochTableCell>

                      <KoochTableCell className="text-muted-foreground">
                        {property.ownerName || property.ownerId}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {property.ownerEmail}
                        </span>
                      </KoochTableCell>

                      <KoochTableCell>
                        <KoochSelect
                          disabled={workingId === property.id}
                          onChange={(event) =>
                            setStatus(
                              property.id,
                              event.target.value as PropertyStatus,
                            )
                          }
                          value={property.status}
                        >
                          {statuses.map((status) => (
                            <option key={status} value={status}>
                              {statusLabels[status]}
                            </option>
                          ))}
                        </KoochSelect>
                      </KoochTableCell>

                      <KoochTableCell>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            className={actionLinkClass}
                            href={`/admin/properties/${property.id}`}
                            title="ویرایش"
                          >
                            <KoochIcon name="edit" />
                          </Link>

                          <Link
                            className={actionLinkClass}
                            href={`/admin/properties/${property.id}/inventory`}
                            rel="noopener noreferrer"
                            target="_blank"
                            title="تعیین ظرفیت"
                          >
                            <KoochIcon name="capacity" />
                          </Link>

                          <Link
                            className={actionLinkClass}
                            href={`/admin/properties/${property.id}/pricing`}
                            rel="noopener noreferrer"
                            target="_blank"
                            title="تعیین قیمت"
                          >
                            <KoochIcon name="price" />
                          </Link>

                          <Link
                            className={actionLinkClass}
                            href={`/admin/properties/${property.id}/change-logs`}
                            title="سوابق عملیات"
                          >
                            <KoochIcon name="audit" />
                          </Link>

                          <KoochButton
                            onClick={() => openTransferDialog(property)}
                            size="sm"
                            title="Transfer ownership"
                            type="button"
                            variant="outline"
                          >
                            Transfer Ownership
                          </KoochButton>

                          {property.status === "Approved" && (
                            <Link
                              className={actionLinkClass}
                              href={`/properties/${property.slug}`}
                              rel="noopener noreferrer"
                              target="_blank"
                              title="نمایش در سایت"
                            >
                              <KoochIcon name="view" />
                            </Link>
                          )}
                        </div>
                      </KoochTableCell>
                    </KoochTableRow>
                  ))
                )}
              </KoochTableBody>
            </KoochTable>
          </>
        )}


        <KoochConfirmDialog
          cancelText="Cancel"
          confirmText="Transfer ownership"
          description={
            transferProperty ? (
              <span>
                Current owner: {transferProperty.ownerName || transferProperty.ownerId}
                <br />
                New owner: {transferForm.ownerMode === "existing-owner"
                  ? selectedTransferOwner?.fullName || selectedTransferOwner?.email || "Not selected"
                  : [transferForm.newOwnerFirstName, transferForm.newOwnerLastName].filter(Boolean).join(" ") || "New user"}
              </span>
            ) : undefined
          }
          disabled={transferring}
          loading={transferring}
          onConfirm={transferOwnership}
          onOpenChange={(open) => {
            if (!open && !transferring) setTransferProperty(null);
          }}
          open={Boolean(transferProperty)}
          title="Transfer property ownership"
          variant="warning"
        >
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <KoochButton
                onClick={() => setTransferForm({ ...transferForm, ownerMode: "existing-owner" })}
                size="sm"
                type="button"
                variant={transferForm.ownerMode === "existing-owner" ? "primary" : "outline"}
              >
                Existing user
              </KoochButton>
              <KoochButton
                onClick={() => setTransferForm({ ...transferForm, ownerMode: "new-owner" })}
                size="sm"
                type="button"
                variant={transferForm.ownerMode === "new-owner" ? "primary" : "outline"}
              >
                Create Client account
              </KoochButton>
            </div>

            {transferForm.ownerMode === "existing-owner" ? (
              <KoochField label="New owner">
                <KoochSelect
                  onChange={(event) =>
                    setTransferForm({ ...transferForm, newOwnerId: event.target.value })
                  }
                  value={transferForm.newOwnerId}
                >
                  <option value="">Select user</option>
                  {ownerOptions
                    .filter((owner) => owner.id !== transferProperty?.ownerId)
                    .map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.fullName || owner.email} - {owner.email}
                        {!owner.isActive ? " (inactive)" : ""}
                      </option>
                    ))}
                </KoochSelect>
              </KoochField>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <CreateUserFields
                  className="md:col-span-2"
                  errors={transferIdentityErrors}
                  idPrefix="transfer-owner"
                  onChange={(identity) =>
                    setTransferForm({
                      ...transferForm,
                      newOwnerFirstName: identity.firstName,
                      newOwnerLastName: identity.lastName,
                      newOwnerPhoneNumber: identity.mobile,
                      newOwnerEmail: identity.email,
                    })
                  }
                  value={{
                    firstName: transferForm.newOwnerFirstName,
                    lastName: transferForm.newOwnerLastName,
                    mobile: transferForm.newOwnerPhoneNumber,
                    email: transferForm.newOwnerEmail,
                  }}
                />
                <KoochField className="md:col-span-2" label="Initial password">
                  <KoochInput
                    dir="ltr"
                    minLength={8}
                    onChange={(event) =>
                      setTransferForm({ ...transferForm, newOwnerPassword: event.target.value })
                    }
                    type="password"
                    value={transferForm.newOwnerPassword}
                  />
                </KoochField>
              </div>
            )}

            <KoochField label="Previous owner">
              <KoochSelect
                onChange={(event) =>
                  setTransferForm({
                    ...transferForm,
                    previousOwnerAction: event.target.value as PreviousOwnerAction,
                  })
                }
                value={transferForm.previousOwnerAction}
              >
                <option value="DeactivateMembership">Deactivate membership</option>
                <option value="Demote">Demote to role</option>
              </KoochSelect>
            </KoochField>

            {transferForm.previousOwnerAction === "Demote" && (
              <KoochField label="Previous owner role">
                <KoochSelect
                  onChange={(event) =>
                    setTransferForm({
                      ...transferForm,
                      previousOwnerRole: event.target.value as Exclude<PropertyUserRole, "PropertyOwner">,
                    })
                  }
                  value={transferForm.previousOwnerRole}
                >
                  {previousOwnerRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {propertyUserRoleLabels[role]}
                    </option>
                  ))}
                </KoochSelect>
              </KoochField>
            )}
          </div>
        </KoochConfirmDialog>

        <KoochDialog
          closeDisabled={creating}
          description="اقامتگاه جدید به صورت پیش‌نویس و غیرعمومی ساخته می‌شود."
          footer={
            <>
              <KoochButton
                disabled={creating}
                onClick={() => setCreateOpen(false)}
                type="button"
                variant="outline"
              >
                لغو
              </KoochButton>
              <KoochButton
                form="admin-create-property-form"
                loading={creating}
                type="submit"
              >
                ایجاد پیش‌نویس
              </KoochButton>
            </>
          }
          onOpenChange={(open) => {
            if (!open && !creating) setCreateOpen(false);
          }}
          open={createOpen}
          title="افزودن اقامتگاه"
        >
          <form
            className="grid gap-5"
            id="admin-create-property-form"
            onSubmit={createDraftProperty}
          >
            <KoochCard padding="sm" variant="muted">
              <div className="grid gap-4">
                <div className="flex flex-wrap gap-2">
                  <KoochButton
                    onClick={() =>
                      setCreateForm({
                        ...createForm,
                        ownerMode: "existing-owner",
                      })
                    }
                    type="button"
                    variant={
                      createForm.ownerMode === "existing-owner"
                        ? "primary"
                        : "outline"
                    }
                  >
                    انتخاب مالک موجود
                  </KoochButton>

                  <KoochButton
                    onClick={() =>
                      setCreateForm({ ...createForm, ownerMode: "new-owner" })
                    }
                    type="button"
                    variant={
                      createForm.ownerMode === "new-owner"
                        ? "primary"
                        : "outline"
                    }
                  >
                    ایجاد مالک جدید
                  </KoochButton>
                </div>

                {createForm.ownerMode === "existing-owner" ? (
                  <KoochField
                    helperText="مالک بعدا می‌تواند از پنل مالک، اقامتگاه را تکمیل کند."
                    label="مالک اقامتگاه"
                    required
                  >
                    <KoochSelect
                      onChange={(event) =>
                        setCreateForm({
                          ...createForm,
                          ownerId: event.target.value,
                        })
                      }
                      required
                      value={createForm.ownerId}
                    >
                      <option value="">انتخاب مالک</option>
                      {ownerOptions.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.fullName || owner.email} - {owner.email}
                        </option>
                      ))}
                    </KoochSelect>
                  </KoochField>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <CreateUserFields
                      className="md:col-span-2"
                      errors={createIdentityErrors}
                      idPrefix="property-owner-candidate"
                      onChange={(identity) =>
                        setCreateForm({
                          ...createForm,
                          ownerFirstName: identity.firstName,
                          ownerLastName: identity.lastName,
                          ownerPhoneNumber: identity.mobile,
                          ownerEmail: identity.email,
                        })
                      }
                      value={{
                        firstName: createForm.ownerFirstName,
                        lastName: createForm.ownerLastName,
                        mobile: createForm.ownerPhoneNumber,
                        email: createForm.ownerEmail,
                      }}
                    />
                    <KoochField className="hidden" label="رمز عبور اولیه">
                      <KoochInput
                        dir="ltr"
                        minLength={8}
                        onChange={(event) =>
                          setCreateForm({
                            ...createForm,
                            ownerPassword: event.target.value,
                          })
                        }
                        type="password"
                        value={createForm.ownerPassword}
                      />
                    </KoochField>

                  </div>
                )}
              </div>
            </KoochCard>

            <div className="grid gap-4 md:grid-cols-2">
              <KoochField label="نام اقامتگاه" required>
                <KoochInput
                  onChange={(event) =>
                    setCreateForm({ ...createForm, name: event.target.value })
                  }
                  required
                  value={createForm.name}
                />
              </KoochField>

              <KoochField label="نام انگلیسی / اسلاگ">
                <KoochInput
                  dir="ltr"
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      englishName: event.target.value,
                    })
                  }
                  value={createForm.englishName}
                />
              </KoochField>

              <KoochField label="نوع اقامتگاه">
                <KoochSelect
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      type: event.target.value as PropertyType,
                    })
                  }
                  value={createForm.type}
                >
                  {propertyTypes.map((type) => (
                    <option key={type} value={type}>
                      {propertyTypeLabels[type]}
                    </option>
                  ))}
                </KoochSelect>
              </KoochField>

              <KoochField label="مدل موجودی">
                <KoochSelect
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      inventoryMode: event.target.value as InventoryMode,
                    })
                  }
                  value={createForm.inventoryMode}
                >
                  <option value="NamedRooms">اتاق‌های نام‌دار</option>
                  <option value="TypeBasedInventory">
                    موجودی بر اساس نوع اتاق
                  </option>
                </KoochSelect>
              </KoochField>

              <KoochField label="شهر" required>
                <KoochInput
                  onChange={(event) =>
                    setCreateForm({ ...createForm, city: event.target.value })
                  }
                  required
                  value={createForm.city}
                />
              </KoochField>

              <KoochField className="md:col-span-2" label="آدرس" required>
                <KoochInput
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      address: event.target.value,
                    })
                  }
                  required
                  value={createForm.address}
                />
              </KoochField>

              <KoochField className="md:col-span-2" label="توضیح کوتاه">
                <KoochTextarea
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      description: event.target.value,
                    })
                  }
                  value={createForm.description}
                />
              </KoochField>
            </div>
          </form>
        </KoochDialog>
      </main>
    </AdminLayout>
  );
}
