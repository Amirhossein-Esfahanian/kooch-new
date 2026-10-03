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
import { apiRequest } from "@/lib/owner-api";

type PropertyCashbackState = "Inherit" | "EnabledOverride" | "Disabled";
type CalculationMode = "Percentage" | "FixedPerUnit";

type EffectivePolicy = {
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

type PropertyCashbackResponse = {
  state: PropertyCashbackState;
  effectivePolicy: EffectivePolicy;
};

type PropertyCashbackUpdate = {
  currency: string;
  state: PropertyCashbackState;
  calculationMode: CalculationMode | null;
  percentageRate: number | null;
  spendUnitAmount: number | null;
  rewardAmount: number | null;
  maxCashbackPerReservation: number | null;
  expiryDays: number | null;
};

type FormValues = {
  state: PropertyCashbackState;
  calculationMode: CalculationMode;
  percentageRate: string;
  spendUnitAmount: string;
  rewardAmount: string;
  maxCashbackPerReservation: string;
  expiryDays: string;
};

const emptyForm: FormValues = {
  state: "Inherit", calculationMode: "Percentage", percentageRate: "",
  spendUnitAmount: "", rewardAmount: "", maxCashbackPerReservation: "", expiryDays: "",
};

function positiveMoney(value: string) {
  const amount = Number(value);
  return value.trim() !== "" && Number.isFinite(amount) && amount > 0 &&
    /^\d+(?:\.\d{1,2})?$/.test(value.trim());
}

const schema = z.object({
  state: z.enum(["Inherit", "EnabledOverride", "Disabled"]),
  calculationMode: z.enum(["Percentage", "FixedPerUnit"]),
  percentageRate: z.string(),
  spendUnitAmount: z.string(),
  rewardAmount: z.string(),
  maxCashbackPerReservation: z.string(),
  expiryDays: z.string(),
}).superRefine((values, context) => {
  if (values.state !== "EnabledOverride") return;
  const issue = (path: keyof FormValues, message: string) =>
    context.addIssue({ code: "custom", path: [path], message });

  if (!positiveMoney(values.maxCashbackPerReservation))
    issue("maxCashbackPerReservation", "حداکثر کش‌بک باید بیشتر از صفر و دارای حداکثر دو رقم اعشار باشد.");
  if (!/^\d+$/.test(values.expiryDays.trim()) || Number(values.expiryDays) <= 0 ||
      !Number.isSafeInteger(Number(values.expiryDays)))
    issue("expiryDays", "مدت اعتبار باید تعداد روز صحیح و بیشتر از صفر باشد.");
  if (values.calculationMode === "Percentage") {
    if (!positiveMoney(values.percentageRate) || Number(values.percentageRate) > 20)
      issue("percentageRate", "درصد کش‌بک باید بیشتر از صفر و حداکثر ۲۰ باشد.");
  } else {
    if (!positiveMoney(values.spendUnitAmount))
      issue("spendUnitAmount", "مبلغ هر واحد باید بیشتر از صفر و دارای حداکثر دو رقم اعشار باشد.");
    if (!positiveMoney(values.rewardAmount))
      issue("rewardAmount", "مقدار کش‌بک باید بیشتر از صفر و دارای حداکثر دو رقم اعشار باشد.");
  }
});

function toForm(response: PropertyCashbackResponse): FormValues {
  if (response.state !== "EnabledOverride") return emptyFormWithState(response.state);
  const policy = response.effectivePolicy;
  return {
    state: response.state,
    calculationMode: policy.calculationMode ?? "Percentage",
    percentageRate: policy.percentageRate?.toString() ?? "",
    spendUnitAmount: policy.spendUnitAmount?.toString() ?? "",
    rewardAmount: policy.rewardAmount?.toString() ?? "",
    maxCashbackPerReservation: policy.maxCashbackPerReservation?.toString() ?? "",
    expiryDays: policy.expiryDays?.toString() ?? "",
  };
}

function emptyFormWithState(state: PropertyCashbackState): FormValues {
  return { ...emptyForm, state };
}

function toUpdate(currency: string, values: FormValues): PropertyCashbackUpdate {
  if (values.state !== "EnabledOverride") return {
    currency, state: values.state, calculationMode: null, percentageRate: null,
    spendUnitAmount: null, rewardAmount: null, maxCashbackPerReservation: null, expiryDays: null,
  };
  return {
    currency, state: "EnabledOverride", calculationMode: values.calculationMode,
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
  if (/percentage|calculation mode/i.test(message)) return "درصد یا شیوهٔ محاسبهٔ کش‌بک معتبر نیست؛ مقادیر را بررسی کنید.";
  if (/cap|expiry|amount|decimal/i.test(message)) return "مبلغ‌ها و مدت اعتبار کش‌بک را بررسی کنید.";
  return message || "درخواست انجام نشد؛ دوباره تلاش کنید.";
}

export function PropertyCashbackSettings({ propertyId }: { propertyId: number }) {
  const [currencyInput, setCurrencyInput] = useState("IRR");
  const currency = /^[A-Z]{3}$/.test(currencyInput) ? currencyInput : null;
  const [response, setResponse] = useState<PropertyCashbackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const requestEpoch = useRef(0);
  const savingRef = useRef(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: emptyForm });
  const { reset } = form;
  const state = form.watch("state");
  const mode = form.watch("calculationMode");
  const visibleResponse = response?.effectivePolicy.currency === currency ? response : null;
  const path = `/admin/properties/${propertyId}/cashback`;

  const loadPolicy = useCallback(async (code: string) => {
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setLoadError("");
    setResponse(null);
    reset(emptyForm);
    try {
      const result = await apiRequest<PropertyCashbackResponse>(`${path}?currency=${encodeURIComponent(code)}`);
      if (requestEpoch.current !== epoch) return false;
      setResponse(result);
      reset(toForm(result));
      return true;
    } catch (error) {
      if (requestEpoch.current !== epoch) return false;
      setLoadError(errorText(error));
      return false;
    } finally {
      if (requestEpoch.current === epoch) setLoading(false);
    }
  }, [path, reset]);

  useEffect(() => {
    if (currency) {
      void loadPolicy(currency);
    } else {
      requestEpoch.current++;
      setResponse(null);
      setLoadError("");
      setLoading(false);
      reset(emptyForm);
    }
  }, [currency, loadPolicy, reset]);

  async function save(values: FormValues) {
    if (!currency || !visibleResponse || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await apiRequest<PropertyCashbackResponse>(path, {
        method: "PUT", body: JSON.stringify(toUpdate(currency, values)),
      });
      const refreshed = await loadPolicy(currency);
      if (refreshed) toast.success("تنظیمات کش‌بک این اقامتگاه ذخیره شد.");
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

  function changeState(next: PropertyCashbackState) {
    if (next === state) return;
    reset(emptyFormWithState(next), { keepErrors: false });
  }

  return <KoochCard className="grid gap-5" padding="md" aria-labelledby="property-cashback-heading">
    <div className="grid gap-1">
      <h2 id="property-cashback-heading" className="text-base font-semibold">کش‌بک این اقامتگاه</h2>
      <p className="text-sm text-muted-foreground">این تنظیم فقط سیاست این اقامتگاه را برای ارز انتخاب‌شده مشخص می‌کند.</p>
    </div>
    <div className="max-w-xs">
      <KoochField label="کد ارز" helperText="کد سه‌حرفی ارز؛ مانند IRR.">
        <KoochInput dir="ltr" maxLength={3} value={currencyInput} disabled={saving}
          onChange={(event) => setCurrencyInput(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))} />
      </KoochField>
    </div>

    {!currency && <p className="text-sm text-muted-foreground" role="status">برای بارگذاری، کد سه‌حرفی ارز را وارد کنید.</p>}
    {loading && <p className="text-sm text-muted-foreground" role="status">در حال دریافت تنظیمات کش‌بک این اقامتگاه…</p>}
    {loadError && !loading && <div className="grid justify-items-start gap-3">
      <KoochAlert variant="destructive">دریافت تنظیمات این ارز انجام نشد: {loadError}</KoochAlert>
      <KoochButton variant="outline" onClick={() => currency && void loadPolicy(currency)}>تلاش دوباره</KoochButton>
    </div>}

    {visibleResponse && !loading && !loadError && <form className="grid max-w-3xl gap-5" noValidate
      onSubmit={form.handleSubmit(save)}>
      <KoochField label="رفتار کش‌بک برای این اقامتگاه" required>
        <KoochSelect required value={state} disabled={saving}
          onChange={(event) => changeState(event.target.value as PropertyCashbackState)}>
          <option value="Inherit">استفاده از تنظیمات سراسری</option>
          <option value="EnabledOverride">تنظیم اختصاصی برای این اقامتگاه</option>
          <option value="Disabled">غیرفعال برای این اقامتگاه</option>
        </KoochSelect>
      </KoochField>

      {state === "Inherit" && <p className="text-sm text-muted-foreground">
        این اقامتگاه از سیاست سراسری همین ارز پیروی می‌کند؛ سیاست اختصاصی ثبت نمی‌شود.
        {visibleResponse.state === "Inherit" &&
          ` وضعیت مؤثر فعلی: ${visibleResponse.effectivePolicy.enabled ? "فعال" : "غیرفعال"} (منبع: سراسری).`}
      </p>}
      {state === "Disabled" && <p className="text-sm text-muted-foreground">
        کش‌بک برای این اقامتگاه صراحتاً غیرفعال است، حتی اگر سیاست سراسری فعال باشد.
      </p>}

      {state === "EnabledOverride" && <>
        <KoochField label="شیوه محاسبه" required>
          <KoochSelect required value={mode} disabled={saving} onChange={(event) => {
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
          <KoochInput required disabled={saving} type="number" min="0" max="20" step="0.01" inputMode="decimal"
            {...form.register("percentageRate")} />
        </KoochField> : <div className="grid gap-4 sm:grid-cols-2">
          <KoochField label={`به‌ازای هر مبلغ (${currency})`} required error={form.formState.errors.spendUnitAmount?.message}>
            <KoochInput required disabled={saving} type="number" min="0" step="0.01" inputMode="decimal"
              {...form.register("spendUnitAmount")} />
          </KoochField>
          <KoochField label={`مقدار کش‌بک (${currency})`} required error={form.formState.errors.rewardAmount?.message}>
            <KoochInput required disabled={saving} type="number" min="0" step="0.01" inputMode="decimal"
              {...form.register("rewardAmount")} />
          </KoochField>
        </div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <KoochField label={`حداکثر کش‌بک هر رزرو (${currency})`} required
            error={form.formState.errors.maxCashbackPerReservation?.message}>
            <KoochInput required disabled={saving} type="number" min="0" step="0.01" inputMode="decimal"
              {...form.register("maxCashbackPerReservation")} />
          </KoochField>
          <KoochField label="مدت اعتبار کش‌بک (روز)" required
            helperText="اعتبار از زمان اضافه‌شدن واقعی کش‌بک به کیف پول محاسبه می‌شود."
            error={form.formState.errors.expiryDays?.message}>
            <KoochInput required disabled={saving} type="number" min="1" step="1" inputMode="numeric"
              {...form.register("expiryDays")} />
          </KoochField>
        </div>
      </>}

      {saveError && <KoochAlert variant="destructive">{saveError}</KoochAlert>}
      <div className="flex justify-end border-t border-border pt-4">
        <KoochButton type="submit" loading={saving} disabled={saving}>ذخیره تنظیمات کش‌بک</KoochButton>
      </div>
    </form>}

    <p className="max-w-3xl text-xs leading-6 text-muted-foreground">
      تغییر این سیاست فقط بر تصمیم‌های آینده اثر دارد؛ کش‌بک رزروهای قبلی و اعتبارهای ثبت‌شده دوباره محاسبه نمی‌شوند.
      کش‌بک این اقامتگاه کمیسیون آن را به‌طور خودکار تغییر نمی‌دهد.
    </p>
  </KoochCard>;
}
