"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AdminPage } from "@/components/admin/AdminPage";
import { apiRequest, getToken } from "@/lib/owner-api";

interface SiteSettingResponse {
  key: string;
  value: string;
}

const settingKeys = [
  "pricing.minPrice",
  "pricing.maxPrice",
  "ReservationCommissionPercent",
  "ReferralCommissionPercent",
  "CommissionType3Percent",
] as const;

type SettingKey = (typeof settingKeys)[number];
type Values = Record<SettingKey, string>;

const defaults: Values = {
  "pricing.minPrice": "0",
  "pricing.maxPrice": "1000000000",
  ReservationCommissionPercent: "0",
  ReferralCommissionPercent: "0",
  CommissionType3Percent: "0",
};

const commissionFields: { key: SettingKey; label: string }[] = [
  { key: "ReservationCommissionPercent", label: "درصد کمیسیون رزرو" },
  { key: "ReferralCommissionPercent", label: "درصد کمیسیون معرفی" },
  { key: "CommissionType3Percent", label: "درصد کمیسیون نوع سوم" },
];

export default function AdminReservationSettingsPage() {
  const router = useRouter();
  const [values, setValues] = useState<Values>(defaults);
  const [originalValues, setOriginalValues] = useState<Values>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiRequest<SiteSettingResponse[]>("/admin/site-settings")
      .then((settings) => {
        const next = { ...defaults };
        settings.forEach((setting) => {
          if (settingKeys.includes(setting.key as SettingKey)) next[setting.key as SettingKey] = setting.value;
        });
        setValues(next);
        setOriginalValues(next);
      })
      .catch((caught: Error) => toast.error(caught.message))
      .finally(() => setLoading(false));
  }, [router]);

  function update(key: SettingKey, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    const minimumPrice = Number(values["pricing.minPrice"]);
    const maximumPrice = Number(values["pricing.maxPrice"]);
    const percentages = commissionFields.map((field) => Number(values[field.key]));
    if (!Number.isFinite(minimumPrice) || !Number.isFinite(maximumPrice) || minimumPrice < 0 || maximumPrice < minimumPrice) {
      toast.error("محدوده قیمت معتبر نیست");
      return;
    }
    if (percentages.some((percent) => !Number.isFinite(percent) || percent < 0 || percent > 100)) {
      toast.error("درصد کمیسیون باید بین ۰ تا ۱۰۰ باشد");
      return;
    }

    setSaving(true);
    try {
      const oldMaximum = Number(originalValues["pricing.maxPrice"]);
      const priceKeys: SettingKey[] = minimumPrice > oldMaximum
        ? ["pricing.maxPrice", "pricing.minPrice"]
        : ["pricing.minPrice", "pricing.maxPrice"];
      for (const key of [...priceKeys, ...commissionFields.map((field) => field.key)]) {
        await apiRequest(`/admin/site-settings/${encodeURIComponent(key)}`, {
          method: "PUT",
          body: JSON.stringify({ value: values[key] }),
        });
      }
      setOriginalValues(values);
      toast.success("تنظیمات رزرو ذخیره شد");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "ذخیره تنظیمات انجام نشد");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold outline-none focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]";

  return (
    <AdminPage title="تنظیمات رزرو">
      {loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-500">در حال بارگذاری تنظیمات...</p>
      ) : (
        <div className="grid gap-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
            <h2 className="text-xl font-black">محدوده قیمت‌گذاری</h2>
            <p className="mt-1 text-sm text-slate-500">این محدوده در تمام فرم‌های قیمت‌گذاری اعمال می‌شود.</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold">حداقل نرخ اتاق<input className={inputClass} min="0" onChange={(event) => update("pricing.minPrice", event.target.value)} type="number" value={values["pricing.minPrice"]} /></label>
              <label className="grid gap-2 text-sm font-bold">حداکثر نرخ اتاق<input className={inputClass} min="0" onChange={(event) => update("pricing.maxPrice", event.target.value)} type="number" value={values["pricing.maxPrice"]} /></label>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
            <h2 className="text-xl font-black">تنظیمات کمیسیون</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {commissionFields.map((field) => (
                <label className="grid gap-2 text-sm font-bold" key={field.key}>{field.label}<input className={inputClass} max="100" min="0" onChange={(event) => update(field.key, event.target.value)} step="0.01" type="number" value={values[field.key]} /><span className="text-xs font-normal text-slate-400" dir="ltr">{field.key}</span></label>
              ))}
            </div>
          </section>

          <button className="justify-self-end rounded-xl bg-[var(--theme-primary)] px-6 py-3 font-black text-white hover:bg-[var(--theme-primary-hover)] disabled:opacity-60" disabled={saving} onClick={save} type="button">{saving ? "در حال ذخیره..." : "ذخیره تنظیمات"}</button>
        </div>
      )}
    </AdminPage>
  );
}
