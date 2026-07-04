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
import { KoochSvgIcon } from "../KoochSvgIcon";
import { KoochIcon } from "../KoochIcon";

interface AmenityFormValues {
  amenityCategoryId: string;
  name: string;
  slug: string;
  icon: string;
  scope: AmenityScope;
  sortOrder: number;
  isActive: boolean;
}

interface AmenityCategoryFormValues {
  name: string;
  slug: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
}

type AmenityManagementTab = "amenities" | "categories";

const emptyForm: AmenityFormValues = {
  amenityCategoryId: "",
  name: "",
  slug: "",
  icon: "",
  scope: "Property",
  sortOrder: 0,
  isActive: true,
};

const emptyCategoryForm: AmenityCategoryFormValues = {
  name: "",
  slug: "",
  icon: "",
  sortOrder: 0,
  isActive: true,
};

const scopes: AmenityScope[] = ["Property", "RoomType", "Both"];

function isSvgPath(value: string | null | undefined) {
  return Boolean(value?.toLocaleLowerCase().endsWith(".svg"));
}

export function AmenityManagement({
  mode = "admin",
}: {
  mode?: "admin" | "owner";
}) {
  const [categories, setCategories] = useState<AmenityCategoryResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<AmenityManagementTab>("amenities");
  const [form, setForm] = useState<AmenityFormValues>(emptyForm);
  const [categoryForm, setCategoryForm] =
    useState<AmenityCategoryFormValues>(emptyCategoryForm);
  const [editingAmenity, setEditingAmenity] = useState<AmenityResponse | null>(
    null,
  );
  const [editingCategory, setEditingCategory] =
    useState<AmenityCategoryResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AmenityResponse | null>(
    null,
  );
  const [categoryDeleteTarget, setCategoryDeleteTarget] =
    useState<AmenityCategoryResponse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isAdminMode = mode === "admin";

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
  const categoryIconSlug =
    categoryForm.slug.trim() ||
    createSlug(categoryForm.name) ||
    "amenity-category-icon";

  async function load() {
    const [categoryResults, amenityResults] = await Promise.all([
      apiRequest<AmenityCategoryResponse[]>(
        "/amenity-categories?includeInactive=true",
      ),
      apiRequest<AmenityResponse[]>("/amenities"),
    ]);

    setCategories(categoryResults);
    setAmenities(amenityResults);
    setActiveCategoryId(
      (current) =>
        current ??
        categoryResults.find((category) => category.isActive)?.id ??
        categoryResults[0]?.id ??
        null,
    );
  }

  useEffect(() => {
    load()
      .catch((caught: Error) =>
        toast.error(caught.message || "امکانات بارگذاری نشد"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdminMode && activeTab === "categories") {
      setActiveTab("amenities");
    }
  }, [activeTab, isAdminMode]);

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

  function openCreateCategoryModal() {
    setEditingCategory(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryModalOpen(true);
  }

  function openEditCategoryModal(category: AmenityCategoryResponse) {
    setEditingCategory(category);
    setCategoryForm({
      name: category.name,
      slug: category.slug,
      icon: category.icon ?? "",
      sortOrder: category.sortOrder,
      isActive: category.isActive,
    });
    setCategoryModalOpen(true);
  }

  function closeCategoryModal() {
    if (saving) return;
    setCategoryModalOpen(false);
    setEditingCategory(null);
    setCategoryForm(emptyCategoryForm);
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);

    try {
      const payload = {
        name: categoryForm.name.trim(),
        slug: categoryForm.slug.trim() || createSlug(categoryForm.name),
        sortOrder: categoryForm.sortOrder,
        icon: categoryForm.icon.trim() || null,
        isActive: categoryForm.isActive,
      };

      await apiRequest<AmenityCategoryResponse>(
        editingCategory
          ? `/amenity-categories/${editingCategory.id}`
          : "/amenity-categories",
        {
          method: editingCategory ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );

      await load();
      toast.success(
        editingCategory ? "دسته‌بندی ویرایش شد" : "دسته‌بندی جدید اضافه شد",
      );
      closeCategoryModal();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "دسته‌بندی ذخیره نشد",
      );
    } finally {
      setSaving(false);
    }
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

  async function confirmDeleteCategory() {
    if (!categoryDeleteTarget) return;
    setSaving(true);

    try {
      await apiRequest<void>(`/amenity-categories/${categoryDeleteTarget.id}`, {
        method: "DELETE",
      });

      await load();
      toast.success("دسته‌بندی حذف شد");
      setCategoryDeleteTarget(null);
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "دسته‌بندی حذف نشد",
      );
    } finally {
      setSaving(false);
    }
  }

  function showCategoryAmenities(categoryId: number) {
    setActiveCategoryId(categoryId);
    setActiveTab("amenities");
  }

  return (
    <>
      <KoochCard variant="elevated">
        {/* <KoochPageHeader
          actions={
            activeTab === "categories" && isAdminMode ? (
              <KoochButton onClick={openCreateCategoryModal} variant="primary">
                افزودن دسته‌بندی
              </KoochButton>
            ) : (
              <KoochButton onClick={openCreateModal} variant="primary">
                افزودن امکان
              </KoochButton>
            )
          }
          description="دسته‌بندی را انتخاب کنید و امکانات همان دسته را مدیریت کنید."
          eyebrow="مدیریت امکانات"
          title="امکانات اقامتگاه و اتاق"
        /> */}

        {isAdminMode && (
          <KoochCard
            className="mt-6 flex flex-wrap gap-2 border border-border/70"
            padding="sm"
            variant="muted"
          >
            <KoochButton
              onClick={() => setActiveTab("categories")}
              size="sm"
              variant={activeTab === "categories" ? "primary" : "outline"}
            >
              دسته‌بندی امکانات
            </KoochButton>
            <KoochButton
              onClick={() => setActiveTab("amenities")}
              size="sm"
              variant={activeTab === "amenities" ? "primary" : "outline"}
            >
              لیست امکانات
            </KoochButton>
          </KoochCard>
        )}

        {isAdminMode && activeTab === "categories" ? (
          <KoochCard
            className="mt-6 border border-border/70"
            padding="md"
            variant="muted"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-black text-foreground">
                  دسته‌بندی امکانات
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  دسته‌بندی‌ها را مدیریت کنید و ترتیب/وضعیت نمایش آنها را تنظیم
                  کنید.
                </p>
              </div>
              <KoochButton onClick={openCreateCategoryModal} variant="primary">
                <KoochIcon name="plus"></KoochIcon>
                افزودن دسته‌بندی
              </KoochButton>
            </div>

            <div className="mt-5">
              {loading ? (
                <p className="rounded-lg bg-background/70 p-4 text-sm text-muted-foreground">
                  در حال بارگذاری دسته‌بندی‌ها...
                </p>
              ) : categories.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
                  هنوز دسته‌بندی‌ای ثبت نشده است.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {categories.map((category, index) => {
                    const active = activeCategory?.id === category.id;

                    return (
                      <KoochCard
                        className={`min-w-0 transition hover:border-blue-300  ${
                          active ? "border-primary" : ""
                        }`}
                        key={category.id}
                        padding="sm"
                        variant="elevated"
                      >
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-background">
                              {category.icon ? (
                                <KoochSvgIcon size="xl" src={category.icon} />
                              ) : (
                                <span className="text-[10px] font-black text-muted-foreground">
                                  SVG
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-black text-foreground">
                                {index + 1}. {category.name}
                              </h3>
                              <p className="mt-1 break-all text-xs text-muted-foreground">
                                نام انگلیسی: {category.slug}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                ترتیب: {category.sortOrder}
                              </p>
                            </div>
                          </div>

                          <span
                            className={`shrink-0 rounded-lg px-3 py-1 text-xs font-black ${
                              category.isActive
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                            }`}
                          >
                            {category.isActive ? "فعال" : "غیرفعال"}
                          </span>
                        </div>

                        <div className="h-px mt-6 w-full bg-border"></div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <KoochButton
                            onClick={() => showCategoryAmenities(category.id)}
                            size="sm"
                            variant="primary"
                            title="نمایش امکانات"
                          >
                            <KoochIcon name="listl"></KoochIcon>
                          </KoochButton>
                          <KoochButton
                            onClick={() => openEditCategoryModal(category)}
                            size="sm"
                            variant="outline"
                            title="ویرایش"
                          >
                            <KoochIcon name="editl"></KoochIcon>
                          </KoochButton>
                          <KoochButton
                            onClick={() => setCategoryDeleteTarget(category)}
                            size="sm"
                            variant="destructive"
                            title="حذف"
                          >
                            <KoochIcon name="deletel"></KoochIcon>
                          </KoochButton>
                        </div>
                      </KoochCard>
                    );
                  })}
                </div>
              )}
            </div>
          </KoochCard>
        ) : (
          <>
            <KoochCard
              className="mt-6 max-w-full border border-border/70"
              padding="md"
              variant="muted"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-black text-foreground">لیست امکانات</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    یک دسته‌بندی را انتخاب کنید تا امکانات همان دسته نمایش داده
                    شود.
                  </p>
                </div>
                <KoochButton onClick={openCreateModal} variant="primary">
                  <KoochIcon name="plus"></KoochIcon>
                  افزودن امکان
                </KoochButton>
              </div>

              <div className="mt-5 flex max-w-full gap-2 overflow-x-auto pb-2">
                {categories.map((category) => {
                  const active = activeCategory?.id === category.id;

                  return (
                    <KoochButton
                      className="max-w-[220px] shrink-0"
                      key={category.id}
                      onClick={() => setActiveCategoryId(category.id)}
                      size="sm"
                      variant={active ? "primary" : "outline"}
                    >
                      {category.icon ? (
                        <KoochSvgIcon size="md" src={category.icon} />
                      ) : (
                        <span className="ml-2 text-[10px] font-black text-muted-foreground">
                          SVG
                        </span>
                      )}
                      <span className="truncate">{category.name}</span>
                    </KoochButton>
                  );
                })}
              </div>
            </KoochCard>

            <div className="mt-6">
              {loading ? (
                <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                  در حال بارگذاری امکانات...
                </p>
              ) : !activeCategory ? (
                <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                  دسته‌بندی امکاناتی ثبت نشده است.
                </p>
              ) : visibleAmenities.length === 0 ? (
                <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                  در این دسته‌بندی هنوز امکانی ثبت نشده است.
                </p>
              ) : (
                <div className="grid bg-muted p-4 rounded-lg border gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleAmenities.map((amenity) => (
                    <KoochCard
                      className="min-w-0 transition hover:border-blue-300"
                      key={amenity.id}
                      padding="sm"
                      variant="default"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate font-black">
                            {amenity.name}
                          </h3>
                          <p className="mt-1 break-all text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            {amenity.scope} · {amenity.slug}
                          </p>
                        </div>

                        {amenity.icon &&
                          (isSvgPath(amenity.icon) ? (
                            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-card p-1 shadow-sm">
                              <img
                                alt=""
                                className="h-10 w-10 object-contain"
                                src={amenity.icon}
                              />
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-lg bg-card px-3 py-1 text-xs font-bold shadow-sm">
                              {amenity.icon}
                            </span>
                          ))}
                      </div>
                      <div className="h-px mt-6  w-full bg-border"></div>
                      <div className="mt-4 flex flex-wrap gap-3 text-sm font-black">
                        <KoochButton
                          onClick={() => openEditModal(amenity)}
                          size="sm"
                          variant="outline"
                        >
                          <KoochIcon name="editl"></KoochIcon>
                        </KoochButton>
                        <KoochButton
                          onClick={() => setDeleteTarget(amenity)}
                          size="sm"
                          variant="destructive"
                        >
                          <KoochIcon name="deletel"></KoochIcon>
                        </KoochButton>
                      </div>
                    </KoochCard>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </KoochCard>

      {isAdminMode && (
        <KoochDialog
          closeDisabled={saving}
          footer={
            <>
              <KoochDialogButton disabled={saving} onClick={closeCategoryModal}>
                لغو
              </KoochDialogButton>
              <KoochDialogButton
                disabled={saving}
                form="category-form"
                type="submit"
                variant="primary"
              >
                {saving ? "در حال ذخیره..." : "ذخیره"}
              </KoochDialogButton>
            </>
          }
          onOpenChange={(open) => {
            if (!open) closeCategoryModal();
          }}
          open={categoryModalOpen}
          size="md"
          title={editingCategory ? "ویرایش دسته‌بندی" : "افزودن دسته‌بندی"}
        >
          <form
            className="grid gap-4"
            id="category-form"
            onSubmit={saveCategory}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <KoochField label="نام فارسی" required>
                <KoochInput
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      name: event.target.value,
                      slug: current.slug || createSlug(event.target.value),
                    }))
                  }
                  required
                  value={categoryForm.name}
                />
              </KoochField>
              <KoochField
                helperText="در صورت خالی بودن خودکار ساخته می‌شود"
                label="نام انگلیسی / اسلاگ"
              >
                <KoochInput
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      slug: event.target.value,
                    }))
                  }
                  placeholder="در صورت خالی بودن خودکار ساخته می‌شود"
                  value={categoryForm.slug}
                />
              </KoochField>
              <KoochField label="ترتیب نمایش">
                <KoochInput
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      sortOrder: Number(event.target.value),
                    }))
                  }
                  type="number"
                  value={categoryForm.sortOrder}
                />
              </KoochField>
              <KoochField label="وضعیت">
                <KoochSelect
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      isActive: event.target.value === "active",
                    }))
                  }
                  value={categoryForm.isActive ? "active" : "inactive"}
                >
                  <option value="active">فعال</option>
                  <option value="inactive">غیرفعال</option>
                </KoochSelect>
              </KoochField>
              <KoochField
                className="sm:col-span-2"
                helperText="فقط فایل SVG پذیرفته می‌شود و مسیر نسبی آن در دیتابیس ذخیره خواهد شد."
                label="آیکن SVG"
              >
                <KoochSvgUploader
                  disabled={saving}
                  fileNameHint={categoryIconSlug}
                  helperText="پیش‌نمایش پس از بارگذاری نمایش داده می‌شود."
                  onChange={(path) =>
                    setCategoryForm((current) => ({
                      ...current,
                      icon: path,
                    }))
                  }
                  onRemove={() =>
                    setCategoryForm((current) => ({
                      ...current,
                      icon: "",
                    }))
                  }
                  uploadPath="/amenity-categories/svg"
                  value={categoryForm.icon}
                />
              </KoochField>
            </div>
          </form>
        </KoochDialog>
      )}

      <KoochDialog
        closeDisabled={saving}
        footer={
          <>
            <KoochDialogButton disabled={saving} onClick={closeModal}>
              لغو
            </KoochDialogButton>
            <KoochDialogButton
              disabled={saving}
              form="amenity-form"
              type="submit"
              variant="primary"
            >
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

      {isAdminMode && (
        <KoochConfirmDialog
          cancelText="انصراف"
          confirmText="حذف"
          description={`آیا از حذف «${categoryDeleteTarget?.name ?? ""}» مطمئن هستید؟`}
          disabled={saving}
          loading={saving}
          onConfirm={confirmDeleteCategory}
          onOpenChange={(open) => {
            if (!open && !saving) setCategoryDeleteTarget(null);
          }}
          open={Boolean(categoryDeleteTarget)}
          title="حذف دسته‌بندی"
          variant="destructive"
        />
      )}

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
