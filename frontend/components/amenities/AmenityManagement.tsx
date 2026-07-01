"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AmenityCategoryResponse,
  AmenityResponse,
  AmenityScope,
  apiRequest,
  createSlug,
} from "@/lib/owner-api";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog, KoochDialogButton } from "@/components/KoochDialog";
import {
  KoochField,
  KoochInput,
  KoochSelect,
} from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochSvgUploader } from "@/components/KoochSvgUploader";

interface AmenityFormValues {
  amenityCategoryId: string;
  name: string;
  slug: string;
  icon: string;
  scope: AmenityScope;
  sortOrder: number;
  isActive: boolean;
}

const emptyForm: AmenityFormValues = {
  amenityCategoryId: "",
  name: "",
  slug: "",
  icon: "",
  scope: "Property",
  sortOrder: 0,
  isActive: true,
};

const scopes: AmenityScope[] = ["Property", "RoomType", "Both"];

function isSvgPath(value: string | null | undefined) {
  return Boolean(value?.toLocaleLowerCase().endsWith(".svg"));
}

export function AmenityManagement() {
  const [categories, setCategories] = useState<AmenityCategoryResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [form, setForm] = useState<AmenityFormValues>(emptyForm);
  const [editingAmenity, setEditingAmenity] = useState<AmenityResponse | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<AmenityResponse | null>(
    null,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const activeCategory = useMemo(
    () =>
      categories.find((category) => category.id === activeCategoryId) ??
      categories[0],
    [activeCategoryId, categories],
  );

  const visibleAmenities = useMemo(
    () =>
      activeCategory
        ? amenities.filter(
            (amenity) => amenity.amenityCategoryId === activeCategory.id,
          )
        : [],
    [activeCategory, amenities],
  );

  const iconSlug = form.slug.trim() || createSlug(form.name) || "amenity-icon";

  async function load() {
    const [categoryResults, amenityResults] = await Promise.all([
      apiRequest<AmenityCategoryResponse[]>("/amenity-categories"),
      apiRequest<AmenityResponse[]>("/amenities"),
    ]);
    setCategories(categoryResults);
    setAmenities(amenityResults);
    setActiveCategoryId((current) => current ?? categoryResults[0]?.id ?? null);
  }

  useEffect(() => {
    load()
      .catch((caught: Error) =>
        toast.error(caught.message || "امکانات بارگذاری نشد"),
      )
      .finally(() => setLoading(false));
  }, []);

  function openCreateModal() {
    setEditingAmenity(null);
    setForm({
      ...emptyForm,
      amenityCategoryId: (
        activeCategory?.id ??
        categories[0]?.id ??
        ""
      ).toString(),
    });
    setModalOpen(true);
  }

  function openEditModal(amenity: AmenityResponse) {
    setEditingAmenity(amenity);
    setForm({
      amenityCategoryId: amenity.amenityCategoryId.toString(),
      name: amenity.name,
      slug: amenity.slug,
      icon: amenity.icon ?? "",
      scope: amenity.scope,
      sortOrder: amenity.sortOrder,
      isActive: true,
    });
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingAmenity(null);
    setForm(emptyForm);
  }

  async function saveAmenity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editingAmenity && !form.isActive) {
        await apiRequest<void>(`/amenities/${editingAmenity.id}`, {
          method: "DELETE",
        });
        await load();
        toast.success("امکان غیرفعال شد");
        closeModal();
        return;
      }

      const payload = {
        amenityCategoryId: Number(form.amenityCategoryId),
        name: form.name.trim(),
        slug: form.slug.trim() || createSlug(form.name),
        description: null,
        icon: form.icon.trim() || null,
        scope: form.scope,
        sortOrder: form.sortOrder,
      };

      await apiRequest<AmenityResponse>(
        editingAmenity ? `/amenities/${editingAmenity.id}` : "/amenities",
        {
          method: editingAmenity ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );
      await load();
      toast.success(editingAmenity ? "امکان ویرایش شد" : "امکان جدید اضافه شد");
      closeModal();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "امکان ذخیره نشد");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteAmenity() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await apiRequest<void>(`/amenities/${deleteTarget.id}`, {
        method: "DELETE",
      });
      await load();
      toast.success("امکان حذف شد");
      setDeleteTarget(null);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "امکان حذف نشد");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <KoochCard variant="elevated">
        <KoochPageHeader
          actions={
            <KoochButton
              onClick={openCreateModal}
              variant="primary"
            >
              افزودن امکان
            </KoochButton>
          }
          description="دسته‌بندی را انتخاب کنید و امکانات همان دسته را مدیریت کنید."
          eyebrow="مدیریت امکانات"
          title="امکانات اقامتگاه و اتاق"
        />
        <KoochCard className="mt-6 flex gap-2 overflow-x-auto pb-2" padding="sm" variant="muted">
          {categories.map((category) => {
            const active = activeCategory?.id === category.id;
            return (
              <KoochButton
                className="shrink-0"
                key={category.id}
                onClick={() => setActiveCategoryId(category.id)}
                size="sm"
                variant={active ? "primary" : "outline"}
              >
                {category.icon && <span className="ml-2">{category.icon}</span>}
                {category.name}
              </KoochButton>
            );
          })}
        </KoochCard>

        <div className="mt-6">
          {loading ? (
            <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              در حال بارگذاری امکانات...
            </p>
          ) : !activeCategory ? (
            <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              دسته‌بندی امکاناتی ثبت نشده است.
            </p>
          ) : visibleAmenities.length === 0 ? (
            <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              در این دسته‌بندی هنوز امکانی ثبت نشده است.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleAmenities.map((amenity) => (
                <KoochCard
                  className="transition hover:border-blue-300"
                  padding="sm"
                  variant="muted"
                  key={amenity.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black">
                        {amenity.name}
                      </h3>
                      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        {amenity.scope} · {amenity.slug}
                      </p>
                    </div>
                    {amenity.icon &&
                      (isSvgPath(amenity.icon) ? (
                        <span className="grid h-12 w-12 place-items-center rounded-xl bg-card p-1 shadow-sm">
                          <img
                            alt=""
                            className="h-10 w-10 object-contain"
                            src={amenity.icon}
                          />
                        </span>
                      ) : (
                        <span className="rounded-xl bg-card px-3 py-1 text-xs font-bold shadow-sm">
                          {amenity.icon}
                        </span>
                      ))}
                  </div>
                  <div className="mt-4 flex gap-3 text-sm font-black">
                    <KoochButton
                      onClick={() => openEditModal(amenity)}
                      size="sm"
                      variant="ghost"
                    >
                      ویرایش
                    </KoochButton>
                    <KoochButton
                      onClick={() => setDeleteTarget(amenity)}
                      size="sm"
                      variant="destructive"
                    >
                      حذف
                    </KoochButton>
                  </div>
                </KoochCard>
              ))}
            </div>
          )}
        </div>
      </KoochCard>

      <KoochDialog
        closeDisabled={saving}
        footer={
          <>
            <KoochDialogButton disabled={saving} onClick={closeModal}>
              لغو
            </KoochDialogButton>
            <KoochDialogButton disabled={saving} form="amenity-form" type="submit" variant="primary">
              {saving ? "در حال ذخیره..." : "ذخیره"}
            </KoochDialogButton>
          </>
        }
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        open={modalOpen}
        size="md"
        title={editingAmenity ? "ویرایش امکان" : "افزودن امکان"}
      >
        <form className="grid gap-4" id="amenity-form" onSubmit={saveAmenity}>
          <div className="grid gap-4 sm:grid-cols-2">
            <KoochField label="نام فارسی" required>
              <KoochInput
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                    slug: current.slug || createSlug(event.target.value),
                  }))
                }
                required
                value={form.name}
              />
            </KoochField>
            <KoochField
              helperText="در صورت خالی بودن خودکار ساخته می‌شود"
              label="نام انگلیسی / اسلاگ"
            >
              <KoochInput
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    slug: event.target.value,
                  }))
                }
                placeholder="در صورت خالی بودن خودکار ساخته می‌شود"
                value={form.slug}
              />
            </KoochField>
            <KoochField label="دسته‌بندی" required>
              <KoochSelect
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    amenityCategoryId: event.target.value,
                  }))
                }
                required
                value={form.amenityCategoryId}
              >
                <option value="">انتخاب دسته‌بندی</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </KoochSelect>
            </KoochField>
            <KoochField label="دامنه استفاده">
              <KoochSelect
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scope: event.target.value as AmenityScope,
                  }))
                }
                value={form.scope}
              >
                {scopes.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope === "Property"
                      ? "اقامتگاه"
                      : scope === "RoomType"
                        ? "نوع اتاق"
                        : "هر دو"}
                  </option>
                ))}
              </KoochSelect>
            </KoochField>
            <KoochField
              className="sm:col-span-2"
              helperText="فقط فایل SVG پذیرفته می‌شود و مسیر نسبی آن ذخیره خواهد شد."
              label="آیکن SVG"
            >
              <KoochSvgUploader
                disabled={saving}
                fileNameHint={iconSlug}
                helperText="پیش‌نمایش پس از بارگذاری نمایش داده می‌شود."
                onChange={(path) =>
                  setForm((current) => ({
                    ...current,
                    icon: path,
                  }))
                }
                onRemove={() =>
                  setForm((current) => ({
                    ...current,
                    icon: "",
                  }))
                }
                uploadPath="/amenities/svg"
                value={form.icon}
              />
            </KoochField>
            <KoochField label="ترتیب نمایش">
              <KoochInput
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    sortOrder: Number(event.target.value),
                  }))
                }
                type="number"
                value={form.sortOrder}
              />
            </KoochField>
          </div>
          <KoochField label="وضعیت">
            <KoochSelect
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isActive: event.target.value === "active",
                }))
              }
              value={form.isActive ? "active" : "inactive"}
            >
              <option value="active">فعال</option>
              <option value="inactive">غیرفعال</option>
            </KoochSelect>
          </KoochField>
        </form>
      </KoochDialog>
      <KoochConfirmDialog
        cancelText="انصراف"
        confirmText="حذف"
        description={`آیا از حذف «${deleteTarget?.name ?? ""}» مطمئن هستید؟`}
        disabled={saving}
        loading={saving}
        onConfirm={confirmDeleteAmenity}
        onOpenChange={(open) => {
          if (!open && !saving) setDeleteTarget(null);
        }}
        open={Boolean(deleteTarget)}
        title="حذف امکان"
        variant="destructive"
      />
    </>
  );
}
