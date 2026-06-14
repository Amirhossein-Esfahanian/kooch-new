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
      <label className="grid gap-1 text-sm font-semibold">Property name<input className={inputClass} onChange={(event) => set("name", event.target.value)} required value={values.name} /></label>
      <label className="grid gap-1 text-sm font-semibold">Accommodation type<select className={inputClass} onChange={(event) => set("type", event.target.value as PropertyFormValues["type"])} value={values.type}>{propertyTypes.map((type) => <option key={type} value={type}>{type.replace(/([a-z])([A-Z])/g, "$1 $2")}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold">City<input className={inputClass} onChange={(event) => set("city", event.target.value)} required value={values.city} /></label>
      <label className="grid gap-1 text-sm font-semibold">Address<input className={inputClass} onChange={(event) => set("address", event.target.value)} required value={values.address} /></label>
      <label className="grid gap-1 text-sm font-semibold">Description<textarea className={inputClass} onChange={(event) => set("description", event.target.value)} required rows={4} value={values.description} /></label>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Inventory model</legend>
        <label className="flex items-start gap-3 rounded-lg border border-ink/15 p-3">
          <input checked={values.inventoryMode === "NamedRooms"} className="mt-1" name="inventoryMode" onChange={() => set("inventoryMode", "NamedRooms")} type="radio" />
          <span><strong>Named rooms</strong><span className="block text-sm font-normal text-ink/60">Each room has its own name, such as Shah-Abbasi or Toranj.</span></span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-ink/15 p-3">
          <input checked={values.inventoryMode === "TypeBasedInventory"} className="mt-1" name="inventoryMode" onChange={() => set("inventoryMode", "TypeBasedInventory")} type="radio" />
          <span><strong>Room-type inventory</strong><span className="block text-sm font-normal text-ink/60">Use shared types such as Double room or Twin room with an inventory count.</span></span>
        </label>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Check-in time<input className={inputClass} onChange={(event) => set("checkInTime", event.target.value)} type="time" value={values.checkInTime} /></label>
        <label className="grid gap-1 text-sm font-semibold">Check-out time<input className={inputClass} onChange={(event) => set("checkOutTime", event.target.value)} type="time" value={values.checkOutTime} /></label>
      </div>
      <button className="rounded-lg bg-ink px-4 py-3 font-bold text-white disabled:opacity-50" disabled={disabled} type="submit">{submitLabel}</button>
    </form>
  );
}
