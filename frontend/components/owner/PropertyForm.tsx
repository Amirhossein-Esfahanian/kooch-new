"use client";

import { FormEvent } from "react";
import {
  PropertyFormValues,
  propertyTypes,
} from "@/lib/owner-api";

interface PropertyFormProps {
  values: PropertyFormValues;
  onChange: (values: PropertyFormValues) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  disabled?: boolean;
}

const inputClass = "w-full rounded-lg border border-ink/20 bg-white px-3 py-2";

export function PropertyForm({ values, onChange, onSubmit, submitLabel, disabled }: PropertyFormProps) {
  function set<K extends keyof PropertyFormValues>(key: K, value: PropertyFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <form className="grid gap-4 rounded-xl border border-ink/10 bg-white p-5 shadow-sm" onSubmit={onSubmit}>
      <label className="grid gap-1 text-sm font-semibold">نام فارسی اقامتگاه<input className={inputClass} dir="rtl" onChange={(event) => set("name", event.target.value)} required value={values.name} /></label>
      <label className="grid gap-1 text-sm font-semibold">نام انگلیسی اقامتگاه<input className={inputClass} dir="ltr" onChange={(event) => set("englishName", event.target.value)} placeholder="Khademi Traditional House" required value={values.englishName} /></label>
      <label className="grid gap-1 text-sm font-semibold">نوع اقامتگاه<select className={inputClass} onChange={(event) => set("type", event.target.value as PropertyFormValues["type"])} value={values.type}>{propertyTypes.map((type) => <option key={type} value={type}>{type.replace(/([a-z])([A-Z])/g, "$1 $2")}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold">شهر<input className={inputClass} dir="rtl" onChange={(event) => set("city", event.target.value)} required value={values.city} /></label>
      <label className="grid gap-1 text-sm font-semibold">نشانی<input className={inputClass} dir="rtl" onChange={(event) => set("address", event.target.value)} required value={values.address} /></label>
      <label className="grid gap-1 text-sm font-semibold">توضیحات<textarea className={inputClass} dir="rtl" onChange={(event) => set("description", event.target.value)} required rows={4} value={values.description} /></label>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">مدل موجودی</legend>
        <label className="flex items-start gap-3 rounded-lg border border-ink/15 p-3">
          <input checked={values.inventoryMode === "NamedRooms"} className="mt-1" name="inventoryMode" onChange={() => set("inventoryMode", "NamedRooms")} type="radio" />
          <span><strong>اتاق‌های نام‌دار</strong><span className="block text-sm font-normal text-ink/60">هر اتاق نام و مشخصات مستقل دارد؛ مانند شاه‌عباسی یا ترنج.</span></span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-ink/15 p-3">
          <input checked={values.inventoryMode === "TypeBasedInventory"} className="mt-1" name="inventoryMode" onChange={() => set("inventoryMode", "TypeBasedInventory")} type="radio" />
          <span><strong>موجودی بر اساس نوع اتاق</strong><span className="block text-sm font-normal text-ink/60">نوع‌هایی مانند دابل یا تویین با تعداد موجودی مشترک.</span></span>
        </label>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">ساعت ورود<input className={inputClass} onChange={(event) => set("checkInTime", event.target.value)} type="time" value={values.checkInTime} /></label>
        <label className="grid gap-1 text-sm font-semibold">ساعت خروج<input className={inputClass} onChange={(event) => set("checkOutTime", event.target.value)} type="time" value={values.checkOutTime} /></label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">وضعیت صبحانه<select className={inputClass} onChange={(event) => set("breakfastOption", event.target.value as PropertyFormValues["breakfastOption"])} value={values.breakfastOption}><option value="NoBreakfast">بدون صبحانه</option><option value="Included">صبحانه رایگان</option><option value="Paid">صبحانه با هزینه</option></select></label>
      {values.breakfastOption === "Paid" && <label className="grid gap-1 text-sm font-semibold">هزینه صبحانه<input className={inputClass} min="0" onChange={(event) => set("breakfastPrice", event.target.value === "" ? null : Number(event.target.value))} type="number" value={values.breakfastPrice ?? ""} /></label>}
      <button className="rounded-lg bg-ink px-4 py-3 font-bold text-white disabled:opacity-50" disabled={disabled} type="submit">{submitLabel}</button>
    </form>
  );
}
