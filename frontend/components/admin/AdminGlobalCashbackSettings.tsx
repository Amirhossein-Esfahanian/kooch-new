"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochField, KoochInput, KoochSelect } from "@/components/KoochFormControls";
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

const currency = "IRR";

export function AdminGlobalCashbackSettings() {
  const [policy, setPolicy] = useState<CashbackPolicy | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requestEpoch = useRef(0);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: emptyForm });
  const { reset } = form;
  const mode = form.watch("calculationMode");

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
    void loadPolicy(currency);
  }, [loadPolicy]);

  function openSettings() {
    if (!policy || savingRef.current) return;
    reset({ ...toForm(policy), enabled: true });
    setSaveError("");
    setDialogOpen(true);
  }

  async function disable() {
    if (!policy?.enabled || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await apiRequest<CashbackPolicy>("/admin/cashback/settings", {
        method: "PUT",
        body: JSON.stringify(toUpdate(currency, { ...toForm(policy), enabled: false })),
      });
      const refreshed = await loadPolicy(currency);
      if (refreshed) toast.success("کش‌بک سراسری غیرفعال شد.");
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

  async function save(values: FormValues) {
    if (!policy || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await apiRequest<CashbackPolicy>("/admin/cashback/settings", {
        method: "PUT",
        body: JSON.stringify(toUpdate(currency, { ...values, enabled: true })),
      });
      const refreshed = await loadPolicy(currency);
      if (refreshed) {
        setDialogOpen(false);
        toast.success("تنظیمات کش‌بک ذخیره شد.");
      }
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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">کش‌بک</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">پس از پایان اقامت، اعتبار غیرقابل‌برداشت به کیف پول مهمان اضافه می‌شود.</p>
        </div>
        <div className="flex items-center gap-4">
          <KoochButton type="button" size="sm" variant="outline" disabled={!policy || loading || saving} onClick={openSettings}>تنظیمات</KoochButton>
          <label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <input type="checkbox" role="switch" aria-label="کش‌بک سراسری فعال باشد" className="h-5 w-5 accent-primary"
              checked={policy?.enabled ?? false} disabled={!policy || loading || saving}
              onChange={() => { if (policy?.enabled) void disable(); else openSettings(); }} />
            {policy?.enabled ? "روشن" : "خاموش"}
          </label>
        </div>
      </div>
      {loading && <p className="text-sm text-muted-foreground" role="status">در حال دریافت تنظیمات کش‌بک…</p>}
      {loadError && !loading && <div className="grid gap-3">
        <KoochAlert variant="destructive">دریافت تنظیمات کش‌بک انجام نشد: {loadError}</KoochAlert>
        <KoochButton type="button" variant="outline" onClick={() => void loadPolicy(currency)}>تلاش دوباره</KoochButton>
      </div>}
      {saveError && !dialogOpen && <KoochAlert variant="destructive">{saveError}</KoochAlert>}
      <KoochDialog open={dialogOpen} onOpenChange={(open) => { if (!savingRef.current) setDialogOpen(open); }}
        closeDisabled={saving} size="md" title="تنظیمات کش‌بک"
        description="نحوه محاسبه و محدودیت اعتبار کش‌بک سراسری را تعیین کنید.">
        <form className="grid gap-5" onSubmit={form.handleSubmit(save)} noValidate>
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
              <KoochField label="مبلغ هر واحد خرید" required
                error={form.formState.errors.spendUnitAmount?.message}>
                <KoochInput required type="number" min="0" step="0.01" inputMode="decimal"
                  {...form.register("spendUnitAmount")} />
              </KoochField>
              <KoochField label="مبلغ کش‌بک هر واحد" required
                error={form.formState.errors.rewardAmount?.message}>
                <KoochInput required type="number" min="0" step="0.01" inputMode="decimal"
                  {...form.register("rewardAmount")} />
              </KoochField>
            </div>}

            <div className="grid gap-4 sm:grid-cols-2">
              <KoochField label="حداکثر کش‌بک هر رزرو" required
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
          <p className="text-sm leading-6 text-muted-foreground">هزینهٔ کش‌بک بر عهدهٔ کوچ است و به‌صورت اعتبار غیرقابل‌برداشت به کیف پول مهمان اضافه می‌شود. مدت اعتبار از زمان واریز واقعی محاسبه می‌شود و کمیسیون اقامتگاه را خودکار تغییر نمی‌دهد.</p>
          {saveError && <KoochAlert variant="destructive">{saveError}</KoochAlert>}
          <div className="flex justify-end border-t border-border pt-4">
            <KoochButton type="submit" loading={saving} disabled={saving}>{policy?.enabled ? "ذخیره تنظیمات" : "ذخیره و فعال‌سازی"}</KoochButton>
          </div>
        </form>
      </KoochDialog>
    </div>
  );
}
