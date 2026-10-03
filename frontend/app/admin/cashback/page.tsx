"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochField, KoochInput, KoochSelect } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { apiRequest } from "@/lib/owner-api";

type CalculationMode = "Percentage" | "FixedPerUnit";

type CashbackPolicy = {
  enabled: boolean;
  source: "Global" | "PropertyOverride" | "PropertyDisabled";
  currency: string;
  calculationMode: CalculationMode | null;
  percentageRate: number | null;
  spendUnitAmount: number | null;
  rewardAmount: number | null;
  maxCashbackPerReservation: number | null;
  expiryDays: number | null;
};

type CashbackUpdate = Omit<CashbackPolicy, "source">;

type FormValues = {
  enabled: boolean;
  calculationMode: CalculationMode;
  percentageRate: string;
  spendUnitAmount: string;
  rewardAmount: string;
  maxCashbackPerReservation: string;
  expiryDays: string;
};

const emptyForm: FormValues = {
  enabled: false,
  calculationMode: "Percentage",
  percentageRate: "",
  spendUnitAmount: "",
  rewardAmount: "",
  maxCashbackPerReservation: "",
  expiryDays: "",
};

function positiveMoney(value: string) {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) && number > 0 &&
    /^\d+(?:\.\d{1,2})?$/.test(value.trim());
}

const formSchema = z.object({
  enabled: z.boolean(),
  calculationMode: z.enum(["Percentage", "FixedPerUnit"]),
  percentageRate: z.string(),
  spendUnitAmount: z.string(),
  rewardAmount: z.string(),
  maxCashbackPerReservation: z.string(),
  expiryDays: z.string(),
}).superRefine((values, context) => {
  if (!values.enabled) return;
  const issue = (path: keyof FormValues, message: string) =>
    context.addIssue({ code: "custom", path: [path], message });

  if (!positiveMoney(values.maxCashbackPerReservation))
    issue("maxCashbackPerReservation", "حداکثر کش‌بک باید مبلغی بیشتر از صفر با حداکثر دو رقم اعشار باشد.");
  if (!/^\d+$/.test(values.expiryDays.trim()) || Number(values.expiryDays) <= 0 ||
      !Number.isSafeInteger(Number(values.expiryDays)))
    issue("expiryDays", "مدت اعتبار باید تعداد روز صحیح و بیشتر از صفر باشد.");

  if (values.calculationMode === "Percentage") {
    const rate = Number(values.percentageRate);
    if (!positiveMoney(values.percentageRate) || rate > 20)
      issue("percentageRate", "درصد کش‌بک باید بیشتر از صفر و حداکثر ۲۰ باشد.");
  } else {
    if (!positiveMoney(values.spendUnitAmount))
      issue("spendUnitAmount", "مبلغ هر واحد باید بیشتر از صفر و حداکثر دو رقم اعشار داشته باشد.");
    if (!positiveMoney(values.rewardAmount))
      issue("rewardAmount", "مقدار کش‌بک باید بیشتر از صفر و حداکثر دو رقم اعشار داشته باشد.");
  }
});

function toForm(policy: CashbackPolicy): FormValues {
  return {
    enabled: policy.enabled,
    calculationMode: policy.calculationMode ?? "Percentage",
    percentageRate: policy.percentageRate?.toString() ?? "",
    spendUnitAmount: policy.spendUnitAmount?.toString() ?? "",
    rewardAmount: policy.rewardAmount?.toString() ?? "",
    maxCashbackPerReservation: policy.maxCashbackPerReservation?.toString() ?? "",
    expiryDays: policy.expiryDays?.toString() ?? "",
  };
}

function toUpdate(currency: string, values: FormValues): CashbackUpdate {
  if (!values.enabled) return {
    currency, enabled: false, calculationMode: null, percentageRate: null,
    spendUnitAmount: null, rewardAmount: null, maxCashbackPerReservation: null, expiryDays: null,
  };
  return {
    currency,
    enabled: true,
    calculationMode: values.calculationMode,
    percentageRate: values.calculationMode === "Percentage" ? Number(values.percentageRate) : null,
    spendUnitAmount: values.calculationMode === "FixedPerUnit" ? Number(values.spendUnitAmount) : null,
    rewardAmount: values.calculationMode === "FixedPerUnit" ? Number(values.rewardAmount) : null,
    maxCashbackPerReservation: Number(values.maxCashbackPerReservation),
    expiryDays: Number(values.expiryDays),
  };
}

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/currency/i.test(message)) return "کد ارز باید دقیقاً سه حرف لاتین باشد.";
  if (/percentage|calculation mode/i.test(message)) return "درصد یا شیوه محاسبه کش‌بک معتبر نیست؛ مقادیر را بررسی کنید.";
  if (/cap|expiry|amount|decimal/i.test(message)) return "مبلغ‌ها و مدت اعتبار کش‌بک را بررسی کنید.";
  return message || "درخواست انجام نشد؛ دوباره تلاش کنید.";
}

function GlobalCashbackSettings() {
  const [currencyInput, setCurrencyInput] = useState("IRR");
  const currency = /^[A-Z]{3}$/.test(currencyInput) ? currencyInput : null;
  const [policy, setPolicy] = useState<CashbackPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requestEpoch = useRef(0);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: emptyForm });
  const { reset } = form;
  const enabled = form.watch("enabled");
  const mode = form.watch("calculationMode");
  const visiblePolicy = policy?.currency === currency ? policy : null;

  const loadPolicy = useCallback(async (code: string) => {
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setLoadError("");
    setPolicy(null);
    reset(emptyForm);
    try {
      const response = await apiRequest<CashbackPolicy>(
        `/admin/cashback/settings?currency=${encodeURIComponent(code)}`,
      );
      if (requestEpoch.current !== epoch) return false;
      setPolicy(response);
      reset(toForm(response));
      return true;
    } catch (error) {
      if (requestEpoch.current !== epoch) return false;
      setLoadError(errorText(error));
      return false;
    } finally {
      if (requestEpoch.current === epoch) setLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    if (currency) {
      void loadPolicy(currency);
    } else {
      requestEpoch.current++;
      setPolicy(null);
      setLoadError("");
      setLoading(false);
      reset(emptyForm);
    }
  }, [currency, loadPolicy, reset]);

  async function save(values: FormValues) {
    if (!currency || !visiblePolicy || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await apiRequest<CashbackPolicy>("/admin/cashback/settings", {
        method: "PUT",
        body: JSON.stringify(toUpdate(currency, values)),
      });
      const refreshed = await loadPolicy(currency);
      if (refreshed) toast.success("تنظیمات کش‌بک ذخیره شد.");
      else toast.warning("تنظیمات ذخیره شد، اما دریافت نسخهٔ تازه انجام نشد. دوباره بارگذاری کنید.");
    } catch (error) {
      const message = errorText(error);
      setSaveError(message);
      toast.error(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-[1480px] gap-6 px-4 pt-4 sm:px-5 sm:pt-5 lg:px-6 lg:pt-6">
      <KoochPageHeader appearance="plain" eyebrow="پنل مدیریت" title="تنظیمات کش‌بک"
        description="سیاست سراسری کش‌بک را برای هر ارز به‌صورت مستقل مدیریت کنید." />

      <KoochCard className="grid max-w-3xl gap-5" padding="md">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">سیاست سراسری</h2>
          <p className="text-sm text-muted-foreground">تغییر ارز، تنظیمات همان ارز را از سرور دریافت می‌کند.</p>
        </div>
        <KoochField label="کد ارز" helperText="کد سه‌حرفی ارز؛ مانند IRR.">
          <KoochInput aria-label="کد ارز" dir="ltr" maxLength={3} value={currencyInput}
            disabled={saving} onChange={(event) => setCurrencyInput(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))} />
        </KoochField>

        {!currency && <p className="text-sm text-muted-foreground" role="status">برای بارگذاری، کد سه‌حرفی ارز را وارد کنید.</p>}
        {loading && <p className="text-sm text-muted-foreground" role="status">در حال دریافت تنظیمات کش‌بک…</p>}
        {loadError && !loading && <div className="grid gap-3">
          <KoochAlert variant="destructive">دریافت تنظیمات این ارز انجام نشد: {loadError}</KoochAlert>
          <KoochButton variant="outline" onClick={() => currency && void loadPolicy(currency)}>تلاش دوباره</KoochButton>
        </div>}

        {visiblePolicy && !loading && !loadError && <form className="grid gap-5" onSubmit={form.handleSubmit(save)} noValidate>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2">
            <input type="checkbox" role="switch" className="h-5 w-5 accent-primary" {...form.register("enabled")} />
            <span className="text-sm font-semibold">کش‌بک سراسری فعال باشد</span>
          </label>

          {enabled ? <>
            <KoochField label="شیوه محاسبه" required>
              <KoochSelect required value={mode} onChange={(event) => {
                const nextMode = event.target.value as CalculationMode;
                form.setValue("calculationMode", nextMode, { shouldDirty: true, shouldValidate: true });
                if (nextMode === "Percentage") {
                  form.setValue("spendUnitAmount", "");
                  form.setValue("rewardAmount", "");
                } else {
                  form.setValue("percentageRate", "");
                }
                form.clearErrors();
              }}>
                <option value="Percentage">درصدی</option>
                <option value="FixedPerUnit">مبلغ ثابت به‌ازای هر واحد هزینه</option>
              </KoochSelect>
            </KoochField>

            {mode === "Percentage" ? <KoochField label="درصد کش‌بک" required
                helperText="مثلاً 10 یعنی 10٪ از مبلغ واجد شرایط؛ حداکثر ۲۰٪."
                error={form.formState.errors.percentageRate?.message}>
              <KoochInput required type="number" min="0" max="20" step="0.01" inputMode="decimal"
                {...form.register("percentageRate")} />
            </KoochField> : <div className="grid gap-4 sm:grid-cols-2">
              <KoochField label={`به‌ازای هر مبلغ (${currency})`} required
                error={form.formState.errors.spendUnitAmount?.message}>
                <KoochInput required type="number" min="0" step="0.01" inputMode="decimal"
                  {...form.register("spendUnitAmount")} />
              </KoochField>
              <KoochField label={`مقدار کش‌بک (${currency})`} required
                error={form.formState.errors.rewardAmount?.message}>
                <KoochInput required type="number" min="0" step="0.01" inputMode="decimal"
                  {...form.register("rewardAmount")} />
              </KoochField>
            </div>}

            <div className="grid gap-4 sm:grid-cols-2">
              <KoochField label={`حداکثر کش‌بک هر رزرو (${currency})`} required
                error={form.formState.errors.maxCashbackPerReservation?.message}>
                <KoochInput required type="number" min="0" step="0.01" inputMode="decimal"
                  {...form.register("maxCashbackPerReservation")} />
              </KoochField>
              <KoochField label="مدت اعتبار کش‌بک (روز)" required
                helperText="اعتبار از زمان اضافه‌شدن واقعی کش‌بک به کیف پول محاسبه می‌شود."
                error={form.formState.errors.expiryDays?.message}>
                <KoochInput required type="number" min="1" step="1" inputMode="numeric"
                  {...form.register("expiryDays")} />
              </KoochField>
            </div>
          </> : <p className="text-sm text-muted-foreground">در حالت غیرفعال، هیچ پارامتر محاسبه‌ای ارسال نمی‌شود.</p>}

          {saveError && <KoochAlert variant="destructive">{saveError}</KoochAlert>}
          <div className="flex justify-end border-t border-border pt-4">
            <KoochButton type="submit" loading={saving} disabled={saving}>ذخیره تنظیمات</KoochButton>
          </div>
        </form>}
      </KoochCard>

      <KoochCard className="max-w-3xl" padding="md">
        <h2 className="mb-2 text-sm font-semibold">دربارهٔ کش‌بک</h2>
        <p className="text-sm leading-7 text-muted-foreground">
          هزینهٔ کش‌بک بر عهدهٔ کوچ است و اعتبار آن قابل برداشت نیست. کش‌بک پس از پایان زمان اقامت،
          در صورتی که رزرو لغو نشده باشد، به کیف پول اضافه می‌شود. این تنظیم به‌طور خودکار کمیسیون اقامتگاه را
          تغییر نمی‌دهد؛ کمیسیون در صورت نیاز باید جداگانه تنظیم شود.
        </p>
      </KoochCard>
    </main>
  );
}

export default function AdminCashbackPage() {
  return <AdminLayout requiredPlatformPermission="ManageSettings"><GlobalCashbackSettings /></AdminLayout>;
}
