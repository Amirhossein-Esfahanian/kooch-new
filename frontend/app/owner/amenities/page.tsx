"use client";

import { FormEvent, useEffect, useState } from "react";
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
  description: string;
  icon: string;
  scope: AmenityScope;
  sortOrder: number;
}

const emptyForm: AmenityFormValues = {
  amenityCategoryId: "",
  name: "",
  slug: "",
  description: "",
  icon: "",
  scope: "Property",
  sortOrder: 0,
};

const inputClass = "w-full rounded-lg border border-ink/20 bg-white px-3 py-2";
const scopes: AmenityScope[] = ["Property", "RoomType", "Both"];

export default function AmenityManagementPage() {
  const [categories, setCategories] = useState<AmenityCategoryResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [form, setForm] = useState<AmenityFormValues>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [categoryResults, amenityResults] = await Promise.all([
      apiRequest<AmenityCategoryResponse[]>("/amenity-categories"),
      apiRequest<AmenityResponse[]>("/amenities"),
    ]);
    setCategories(categoryResults);
    setAmenities(amenityResults);
    setForm((current) => ({
      ...current,
      amenityCategoryId: current.amenityCategoryId || categoryResults[0]?.id.toString() || "",
    }));
  }

  useEffect(() => {
    load()
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyForm, amenityCategoryId: categories[0]?.id.toString() || "" });
  }

  function editAmenity(amenity: AmenityResponse) {
    setEditingId(amenity.id);
    setForm({
      amenityCategoryId: amenity.amenityCategoryId.toString(),
      name: amenity.name,
      slug: amenity.slug,
      description: amenity.description ?? "",
      icon: amenity.icon ?? "",
      scope: amenity.scope,
      sortOrder: amenity.sortOrder,
    });
  }

  async function saveAmenity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const payload = {
        amenityCategoryId: Number(form.amenityCategoryId),
        name: form.name.trim(),
        slug: form.slug.trim() || createSlug(form.name),
        description: form.description.trim() || null,
        icon: form.icon.trim() || null,
        scope: form.scope,
        sortOrder: form.sortOrder,
      };
      await apiRequest<AmenityResponse>(editingId ? `/amenities/${editingId}` : "/amenities", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await load();
      resetForm();
      setMessage(editingId ? "امکان ویرایش شد." : "امکان جدید ساخته شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "امکان ذخیره نشد.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAmenity(id: number) {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await apiRequest<void>(`/amenities/${id}`, { method: "DELETE" });
      await load();
      if (editingId === id) resetForm();
      setMessage("امکان غیرفعال شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "امکان غیرفعال نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <OwnerPage title="مدیریت امکانات">
      <p className="mb-6 text-ink/65">
        امکانات قابل انتخاب برای اقامتگاه و نوع اتاق را مدیریت کنید.
      </p>
      {loading && <p>در حال بارگذاری امکانات...</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {message && <p className="mb-4 rounded-lg bg-green-50 p-3 text-green-800">{message}</p>}
      <form className="mb-6 grid gap-4 rounded-xl border border-ink/10 bg-white p-5 shadow-sm" onSubmit={saveAmenity}>
        <h2 className="text-xl font-bold">{editingId ? "ویرایش امکان" : "ایجاد امکان"}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold">دسته‌بندی<select className={inputClass} onChange={(event) => setForm({ ...form, amenityCategoryId: event.target.value })} required value={form.amenityCategoryId}><option value="">انتخاب دسته‌بندی</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold">دامنه استفاده<select className={inputClass} onChange={(event) => setForm({ ...form, scope: event.target.value as AmenityScope })} value={form.scope}>{scopes.map((scope) => <option key={scope} value={scope}>{scope === "Property" ? "اقامتگاه" : scope === "RoomType" ? "نوع اتاق" : "هر دو"}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold">ترتیب نمایش<input className={inputClass} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} type="number" value={form.sortOrder} /></label>
          <label className="grid gap-1 text-sm font-semibold">نام<input className={inputClass} onChange={(event) => setForm({ ...form, name: event.target.value, slug: form.slug || createSlug(event.target.value) })} required value={form.name} /></label>
          <label className="grid gap-1 text-sm font-semibold">اسلاگ<input className={inputClass} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="در صورت خالی بودن خودکار ساخته می‌شود" value={form.slug} /></label>
          <label className="grid gap-1 text-sm font-semibold">آیکن<input className={inputClass} onChange={(event) => setForm({ ...form, icon: event.target.value })} placeholder="اختیاری" value={form.icon} /></label>
        </div>
        <label className="grid gap-1 text-sm font-semibold">توضیحات<textarea className={inputClass} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} value={form.description} /></label>
        <div className="flex flex-wrap gap-3">
          <button className="rounded-lg bg-ink px-4 py-3 font-bold text-white disabled:opacity-50" disabled={saving} type="submit">{saving ? "در حال ذخیره..." : editingId ? "ذخیره تغییرات" : "ایجاد امکان"}</button>
          {editingId && <button className="rounded-lg border border-ink/20 px-4 py-3 font-bold" disabled={saving} onClick={resetForm} type="button">لغو ویرایش</button>}
        </div>
      </form>
      <div className="grid gap-5">
        {categories.map((category) => {
          const categoryAmenities = amenities.filter(
            (amenity) => amenity.amenityCategoryId === category.id,
          );

          return (
            <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm" key={category.id}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{category.name}</h2>
                  <p className="text-sm text-ink/50">{categoryAmenities.length} امکان</p>
                </div>
                {category.icon && <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold">{category.icon}</span>}
              </div>
              {categoryAmenities.length === 0 ? (
                <p className="text-sm text-ink/50">در این دسته‌بندی امکانی ثبت نشده است.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {categoryAmenities.map((amenity) => (
                    <article className="rounded-lg border border-ink/10 bg-cream/50 p-3" key={amenity.id}>
                      <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{amenity.name}</h3><p className="mt-1 text-xs font-semibold uppercase tracking-wide text-ink/45">{amenity.scope} · {amenity.slug}</p></div>{amenity.icon && <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{amenity.icon}</span>}</div>
                      {amenity.description && <p className="mt-2 text-sm text-ink/65">{amenity.description}</p>}
                      <div className="mt-3 flex gap-3 text-sm font-bold"><button className="text-blue-700" onClick={() => editAmenity(amenity)} type="button">ویرایش</button><button className="text-red-700" disabled={saving} onClick={() => deleteAmenity(amenity.id)} type="button">غیرفعال</button></div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </OwnerPage>
  );
}
