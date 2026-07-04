"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KoochButton } from "@/components/KoochButton";
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
import { PropertyCompletionCard } from "@/components/property/PropertyCompletionCard";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import {
  apiRequest,
  AdminUserResponse,
  getToken,
  InventoryMode,
  PropertyCompletionResponse,
  PropertyResponse,
  PropertyStatus,
  propertyTypes,
  PropertyType,
  resolveDestinationId,
  UserRole,
} from "@/lib/owner-api";
import { propertyCompletionHref } from "@/lib/property-completion";

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

export default function AdminPropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [completions, setCompletions] = useState<
    Record<number, PropertyCompletionResponse>
  >({});
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<CreatePropertyForm>(emptyCreateForm);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [setupLink, setSetupLink] = useState("");

  const ownerOptions = useMemo(
    () =>
      users.filter(
        (user) =>
          user.isActive &&
          (user.role === "Owner" || user.role === "SuperAdmin"),
      ),
    [users],
  );

  const load = useCallback(async () => {
    const [propertyItems, userItems] = await Promise.all([
      apiRequest<PropertyResponse[]>("/admin/properties"),
      apiRequest<AdminUserResponse[]>("/admin/users").catch(() => []),
    ]);
    setProperties(propertyItems);
    setUsers(userItems);
    const completionEntries = await Promise.all(
      propertyItems.map(async (property) => {
        const completion = await apiRequest<PropertyCompletionResponse>(
          `/admin/properties/${property.id}/completion`,
        ).catch(() => null);
        return [property.id, completion] as const;
      }),
    );
    setCompletions(
      Object.fromEntries(
        completionEntries.filter(([, completion]) => completion),
      ) as Record<number, PropertyCompletionResponse>,
    );
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    load()
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [load, router]);

  async function setStatus(id: number, status: PropertyStatus) {
    setWorkingId(id);
    setError("");
    try {
      const updated = await apiRequest<PropertyResponse>(
        `/admin/properties/${id}/status`,
        { method: "PUT", body: JSON.stringify({ status }) },
      );
      const completion = await apiRequest<PropertyCompletionResponse>(
        `/admin/properties/${id}/completion`,
      ).catch(() => null);
      setProperties((current) =>
        current.map((property) => (property.id === id ? updated : property)),
      );
      if (completion) {
        setCompletions((current) => ({ ...current, [id]: completion }));
      }
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
    setCreateOpen(true);
  }

  async function createOwnerIfNeeded() {
    if (createForm.ownerMode === "existing-owner") {
      if (!createForm.ownerId) {
        throw new Error("مالک اقامتگاه را انتخاب کنید.");
      }
      return { ownerId: Number(createForm.ownerId), setupLink: null };
    }

    const createdOwner = await apiRequest<AdminUserResponse>("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        firstName: createForm.ownerFirstName.trim(),
        lastName: createForm.ownerLastName.trim(),
        email: createForm.ownerEmail.trim(),
        phoneNumber: createForm.ownerPhoneNumber.trim() || null,
        password: null,
        role: "Owner" satisfies UserRole,
        parentUserId: null,
        propertyId: null,
      }),
    });
    setUsers((current) => [...current, createdOwner]);
    const ownerSetupLink = createdOwner.temporarySetupLink ?? null;
    if (ownerSetupLink && process.env.NODE_ENV !== "production") {
      setSetupLink(ownerSetupLink);
    }
    return { ownerId: createdOwner.id, setupLink: ownerSetupLink };
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
    if (
      createForm.ownerMode === "new-owner" &&
      (!createForm.ownerFirstName.trim() ||
        !createForm.ownerLastName.trim() ||
        !createForm.ownerEmail.trim())
    ) {
      toast.error("برای مالک جدید، نام و ایمیل لازم است.");
      return;
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
      const message =
        caught instanceof Error ? caught.message : "ایجاد اقامتگاه انجام نشد.";
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
              <KoochIcon name="plus"></KoochIcon>
              افزودن اقامتگاه
            </KoochButton>
          }
          description="اقامتگاه‌ها، وضعیت بررسی، ظرفیت و قیمت‌گذاری را از همین صفحه مدیریت کنید."
          eyebrow=""
          title="مدیریت اقامتگاه‌ها"
        />

        {error && (
          <KoochCard
            className="border-destructive text-destructive"
            variant="elevated"
          >
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )}

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
          <KoochTable>
            <KoochTableHeader>
              <KoochTableRow>
                <KoochTableHead className="w-14">ردیف</KoochTableHead>
                <KoochTableHead>نام</KoochTableHead>
                <KoochTableHead>شهر</KoochTableHead>
                <KoochTableHead>مالک</KoochTableHead>
                <KoochTableHead>وضعیت</KoochTableHead>
                <KoochTableHead>تاریخ ایجاد</KoochTableHead>
                <KoochTableHead className="min-w-[280px]">
                  عملیات
                </KoochTableHead>
              </KoochTableRow>
            </KoochTableHeader>
            <KoochTableBody>
              {properties.map((property, index) => (
                <KoochTableRow key={property.id}>
                  <KoochTableCell className="font-bold text-muted-foreground">
                    {index + 1}
                  </KoochTableCell>
                  <KoochTableCell>
                    <p className="font-black text-foreground">
                      {property.name}
                    </p>
                    {property.englishName && (
                      <p className="text-xs text-muted-foreground" dir="ltr">
                        {property.englishName}
                      </p>
                    )}
                  </KoochTableCell>
                  <KoochTableCell>{property.city}</KoochTableCell>
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
                  <KoochTableCell className="text-xs text-muted-foreground">
                    {new Date(property.createdAtUtc).toLocaleDateString(
                      "fa-IR",
                    )}
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
                        target="_blank"
                        rel="noopener noreferrer"
                        title="تعیین ظرفیت"
                        className={actionLinkClass}
                        href={`/admin/properties/${property.id}/inventory`}
                      >
                        <KoochIcon name="capacity" />
                      </Link>
                      <Link
                        target="_blank"
                        rel="noopener noreferrer"
                        title="تعیین قیمت"
                        className={actionLinkClass}
                        href={`/admin/properties/${property.id}/pricing`}
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
                        disabled={workingId === property.id}
                        onClick={() => setStatus(property.id, "Suspended")}
                        size="sm"
                        variant="outline"
                        title="تعلیق اقامتگاه"
                      >
                        <KoochIcon name="suspend" />
                      </KoochButton>
                      {property.status === "Approved" && (
                        <Link
                          className={actionLinkClass}
                          title="نمایش در سایت"
                          target="_blank"
                          rel="noopener noreferrer"
                          href={`/properties/${property.slug}`}
                        >
                          <KoochIcon name="view" />
                        </Link>
                      )}
                    </div>
                  </KoochTableCell>
                </KoochTableRow>
              ))}
            </KoochTableBody>
          </KoochTable>
        )}

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
                    <KoochField label="نام مالک" required>
                      <KoochInput
                        onChange={(event) =>
                          setCreateForm({
                            ...createForm,
                            ownerFirstName: event.target.value,
                          })
                        }
                        required
                        value={createForm.ownerFirstName}
                      />
                    </KoochField>
                    <KoochField label="نام خانوادگی مالک" required>
                      <KoochInput
                        onChange={(event) =>
                          setCreateForm({
                            ...createForm,
                            ownerLastName: event.target.value,
                          })
                        }
                        required
                        value={createForm.ownerLastName}
                      />
                    </KoochField>
                    <KoochField label="ایمیل مالک" required>
                      <KoochInput
                        dir="ltr"
                        onChange={(event) =>
                          setCreateForm({
                            ...createForm,
                            ownerEmail: event.target.value,
                          })
                        }
                        required
                        type="email"
                        value={createForm.ownerEmail}
                      />
                    </KoochField>
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
                    <KoochField label="شماره تماس">
                      <KoochInput
                        dir="ltr"
                        onChange={(event) =>
                          setCreateForm({
                            ...createForm,
                            ownerPhoneNumber: event.target.value,
                          })
                        }
                        value={createForm.ownerPhoneNumber}
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
