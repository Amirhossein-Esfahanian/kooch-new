"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { OwnerPage } from "@/components/owner/OwnerPage";
import {
  AmenityCategoryResponse,
  AmenityResponse,
  AmenityScope,
  apiRequest,
  createSlug,
} from "@/lib/owner-api";

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
const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-soft)] dark:border-white/10 dark:bg-white/5";

export default function AmenityManagementPage() {
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
    <OwnerPage title="مدیریت امکانات">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#171d27]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-950 dark:text-slate-100">
              امکانات اقامتگاه و اتاق
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              دسته‌بندی را انتخاب کنید و امکانات همان دسته را مدیریت کنید.
            </p>
          </div>
          <button
            className="ds-button-primary"
            onClick={openCreateModal}
            type="button"
          >
            افزودن امکان
          </button>
        </div>

        <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
          {categories.map((category) => {
            const active = activeCategory?.id === category.id;
            return (
              <button
                className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-black transition ${
                  active
                    ? "border-blue-600 bg-blue-600 text-white shadow-md"
                    : "border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                }`}
                key={category.id}
                onClick={() => setActiveCategoryId(category.id)}
                type="button"
              >
                {category.icon && <span className="ml-2">{category.icon}</span>}
                {category.name}
              </button>
            );
          })}
        </div>

        <div className="mt-6">
          {loading ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">
              در حال بارگذاری امکانات...
            </p>
          ) : !activeCategory ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">
              دسته‌بندی امکاناتی ثبت نشده است.
            </p>
          ) : visibleAmenities.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">
              در این دسته‌بندی هنوز امکانی ثبت نشده است.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleAmenities.map((amenity) => (
                <article
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:border-blue-300 dark:border-white/10 dark:bg-white/5"
                  key={amenity.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black text-slate-950 dark:text-slate-100">
                        {amenity.name}
                      </h3>
                      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">
                        {amenity.scope} · {amenity.slug}
                      </p>
                    </div>
                    {amenity.icon && (
                      <span className="rounded-xl bg-white px-3 py-1 text-xs font-bold shadow-sm dark:bg-white/10">
                        {amenity.icon}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex gap-3 text-sm font-black">
                    <button
                      className="text-blue-700"
                      onClick={() => openEditModal(amenity)}
                      type="button"
                    >
                      ویرایش
                    </button>
                    <button
                      className="text-red-700"
                      onClick={() => setDeleteTarget(amenity)}
                      type="button"
                    >
                      حذف
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {modalOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[140] grid place-items-center bg-slate-950/60 p-4"
          role="dialog"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[var(--modal-radius)] bg-white p-5 shadow-2xl dark:bg-[#171d27]">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-xl font-black">
                {editingAmenity ? "ویرایش امکان" : "افزودن امکان"}
              </h2>
              <button
                className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-bold dark:border-white/10"
                onClick={closeModal}
                type="button"
              >
                بستن
              </button>
            </div>
            <form className="grid gap-4" onSubmit={saveAmenity}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-bold">
                  نام فارسی
                  <input
                    className={inputClass}
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
                </label>
                <label className="grid gap-1 text-sm font-bold">
                  نام انگلیسی / اسلاگ
                  <input
                    className={inputClass}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        slug: event.target.value,
                      }))
                    }
                    placeholder="در صورت خالی بودن خودکار ساخته می‌شود"
                    value={form.slug}
                  />
                </label>
                <label className="grid gap-1 text-sm font-bold">
                  دسته‌بندی
                  <select
                    className={inputClass}
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
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-bold">
                  دامنه استفاده
                  <select
                    className={inputClass}
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
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-bold">
                  SVG icon
                  <input
                    className={inputClass}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        icon: event.target.value,
                      }))
                    }
                    placeholder="اختیاری"
                    value={form.icon}
                  />
                </label>
                <label className="grid gap-1 text-sm font-bold">
                  ترتیب نمایش
                  <input
                    className={inputClass}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        sortOrder: Number(event.target.value),
                      }))
                    }
                    type="number"
                    value={form.sortOrder}
                  />
                </label>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm font-bold dark:border-white/10">
                <span>وضعیت</span>
                <select
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/5"
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
                </select>
              </label>
              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                  className="ds-button-secondary"
                  disabled={saving}
                  onClick={closeModal}
                  type="button"
                >
                  لغو
                </button>
                <button
                  className="ds-button-primary disabled:opacity-50"
                  disabled={saving}
                  type="submit"
                >
                  {saving ? "در حال ذخیره..." : "ذخیره"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[150] grid place-items-center bg-slate-950/60 p-4"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-[var(--modal-radius)] bg-white p-5 shadow-2xl dark:bg-[#171d27]">
            <h2 className="text-xl font-black">حذف امکان</h2>
            <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-slate-400">
              آیا از حذف «{deleteTarget.name}» مطمئن هستید؟
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="ds-button-secondary"
                disabled={saving}
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                لغو
              </button>
              <button
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                disabled={saving}
                onClick={confirmDeleteAmenity}
                type="button"
              >
                حذف
              </button>
            </div>
          </div>
        </div>
      )}
    </OwnerPage>
  );
}
