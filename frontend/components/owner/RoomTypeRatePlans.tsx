"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochCheckbox, KoochField, KoochInput, KoochSelect } from "@/components/KoochFormControls";
import { formatCurrency, useSiteCurrencyLabel } from "@/lib/currency";
import {
  createRoomTypeRatePlan,
  deleteRoomTypeRatePlan,
  listPropertyMealPlans,
  listRoomTypeRatePlans,
  updateRoomTypeRatePlan,
  type MealPlanOptionResponse,
  type RoomTypeRatePlanResponse,
  type RoomTypeRatePlanWriteRequest,
  type RoomTypeResponse,
} from "@/lib/owner-api";

const formSchema = z.object({
  name: z.string().trim().min(1, "نام نرخ فروش الزامی است.").max(150, "نام نباید بیشتر از ۱۵۰ نویسه باشد."),
  mealPlanId: z.string(),
  direction: z.enum(["decrease", "same", "increase"]),
  amount: z.string(),
  minimumNights: z.string(),
  isActive: z.boolean(),
}).superRefine((value, context) => {
  if (value.direction !== "same" &&
      (!/^\d+(?:\.\d{1,2})?$/.test(value.amount.trim()) ||
        Number(value.amount) <= 0 || Number(value.amount) > 9999999999999999.99)) {
    context.addIssue({ code: "custom", path: ["amount"], message: "مبلغ تعدیل باید مثبت و دارای حداکثر دو رقم اعشار باشد." });
  }
  if (value.minimumNights.trim() !== "" &&
      (!/^\d+$/.test(value.minimumNights.trim()) ||
        !Number.isSafeInteger(Number(value.minimumNights)) || Number(value.minimumNights) <= 0 ||
        Number(value.minimumNights) > 2147483647)) {
    context.addIssue({ code: "custom", path: ["minimumNights"], message: "حداقل شب‌ها باید عدد صحیح مثبت باشد." });
  }
});

type FormValues = z.infer<typeof formSchema>;
const emptyForm: FormValues = {
  name: "", mealPlanId: "", direction: "same", amount: "", minimumNights: "", isActive: true,
};

function toForm(plan: RoomTypeRatePlanResponse): FormValues {
  return {
    name: plan.name,
    mealPlanId: plan.mealPlanId?.toString() ?? "",
    direction: plan.priceModifierValue < 0 ? "decrease" : plan.priceModifierValue > 0 ? "increase" : "same",
    amount: plan.priceModifierValue === 0 ? "" : Math.abs(plan.priceModifierValue).toString(),
    minimumNights: plan.minimumNights?.toString() ?? "",
    isActive: plan.isActive,
  };
}

function toRequest(values: FormValues, previous: RoomTypeRatePlanResponse | null): RoomTypeRatePlanWriteRequest {
  const amount = Number(values.amount);
  return {
    name: values.name.trim(),
    mealPlanId: values.mealPlanId ? Number(values.mealPlanId) : null,
    cancellationPolicyId: previous?.cancellationPolicyId ?? null,
    priceModifierType: "FixedAmount",
    priceModifierValue: values.direction === "same" ? 0 : values.direction === "decrease" ? -amount : amount,
    minimumNights: values.minimumNights.trim() ? Number(values.minimumNights) : null,
    isActive: values.isActive,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "درخواست انجام نشد؛ دوباره تلاش کنید.";
}

export function RoomTypeRatePlans({ propertyId, roomType, onClose }: {
  propertyId: number;
  roomType: RoomTypeResponse;
  onClose: () => void;
}) {
  const [plans, setPlans] = useState<RoomTypeRatePlanResponse[]>([]);
  const [mealPlans, setMealPlans] = useState<MealPlanOptionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [editing, setEditing] = useState<RoomTypeRatePlanResponse | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<RoomTypeRatePlanResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const busyRef = useRef(false);
  const currencyLabel = useSiteCurrencyLabel();
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: emptyForm });
  const direction = form.watch("direction");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [nextPlans, nextMealPlans] = await Promise.all([
        listRoomTypeRatePlans(propertyId, roomType.id),
        listPropertyMealPlans(propertyId),
      ]);
      setPlans(nextPlans);
      setMealPlans(nextMealPlans);
    } catch (error) {
      setPlans([]);
      setMealPlans([]);
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [propertyId, roomType.id]);

  useEffect(() => { void load(); }, [load]);

  function openForm(plan: RoomTypeRatePlanResponse | null) {
    setEditing(plan);
    form.reset(plan ? toForm(plan) : emptyForm);
    setActionError("");
    setFormOpen(true);
  }

  async function refreshPlans() {
    try {
      setPlans(await listRoomTypeRatePlans(propertyId, roomType.id));
      setLoadError("");
      return true;
    } catch (error) {
      setLoadError(errorMessage(error));
      return false;
    }
  }

  async function save(values: FormValues) {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setActionError("");
    try {
      const request = toRequest(values, editing);
      if (editing) await updateRoomTypeRatePlan(propertyId, roomType.id, editing.id, request);
      else await createRoomTypeRatePlan(propertyId, roomType.id, request);
      setFormOpen(false);
      if (await refreshPlans()) toast.success("نرخ فروش ذخیره شد.");
      else toast.warning("نرخ ذخیره شد، اما دریافت فهرست تازه انجام نشد. دوباره تلاش کنید.");
    } catch (error) {
      setActionError(errorMessage(error));
      toast.error(errorMessage(error));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting || busyRef.current) return;
    busyRef.current = true;
    setDeleteBusy(true);
    setActionError("");
    try {
      await deleteRoomTypeRatePlan(propertyId, roomType.id, deleting.id);
      setDeleting(null);
      if (await refreshPlans()) toast.success("نرخ فروش حذف شد.");
      else toast.warning("نرخ حذف شد، اما دریافت فهرست تازه انجام نشد. دوباره تلاش کنید.");
    } catch (error) {
      setActionError(errorMessage(error));
      toast.error(errorMessage(error));
      throw error;
    } finally {
      busyRef.current = false;
      setDeleteBusy(false);
    }
  }

  function relationship(plan: RoomTypeRatePlanResponse) {
    if (plan.priceModifierType !== "FixedAmount") return "تعدیل درصدی قدیمی؛ ویرایش در این نسخه پشتیبانی نمی‌شود.";
    if (plan.priceModifierValue === 0) return "همان قیمت پایه";
    return `${formatCurrency(Math.abs(plan.priceModifierValue), { currencyLabel })} ${plan.priceModifierValue < 0 ? "کمتر" : "بیشتر"} از نرخ پایه`;
  }

  return <>
    <KoochDialog
      open onOpenChange={(open) => { if (!open && !busyRef.current && !deleting) onClose(); }}
      closeDisabled={saving || deleteBusy || !!deleting}
      size="md"
      contentClassName="!h-auto"
      title={`نرخ‌های فروش اتاق ${roomType.name}`}
      description="قیمت تقویم، نرخ پایه این نوع اتاق است. نرخ‌های زیر گزینه‌های جایگزین هستند."
    >
      <div className="grid gap-5">
        {!formOpen && <>
          <section className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border px-4 py-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground">نرخ استاندارد</h3>
              <p className="mt-1 text-sm text-muted-foreground">قیمت بر اساس تقویم</p>
              {roomType.defaultMealPlanName &&
                <p className="mt-1 text-sm text-muted-foreground">وعده غذایی: {roomType.defaultMealPlanName}</p>}
            </div>
            <KoochBadge variant="muted">پیش‌فرض</KoochBadge>
          </section>

          <section className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
              <h3 className="font-semibold text-foreground">نرخ‌های جایگزین</h3>
              <KoochButton disabled={loading || !!loadError} onClick={() => openForm(null)} size="sm">افزودن نرخ</KoochButton>
            </div>

            {loading && <p role="status" className="py-2 text-sm text-muted-foreground">در حال دریافت نرخ‌های فروش…</p>}
            {loadError && <div className="grid justify-items-start gap-2 py-1">
              <KoochAlert variant="destructive">دریافت نرخ‌های فروش انجام نشد: {loadError}</KoochAlert>
              <KoochButton onClick={() => void load()} variant="outline" size="sm">تلاش دوباره</KoochButton>
            </div>}

            {!loading && !loadError && plans.length === 0 &&
              <div className="py-2 text-sm text-muted-foreground">
                <p>هنوز نرخ جایگزینی تعریف نشده است.</p>
                <p className="mt-1 text-xs">برای ارائه گزینه‌هایی مثل «بدون صبحانه» یک نرخ جدید بسازید.</p>
              </div>}

            {!loading && !loadError && plans.length > 0 &&
              <div className="max-h-[42vh] divide-y divide-border overflow-y-auto pe-1">
                {plans.map((plan) => <div key={plan.id} className="grid gap-3 py-3 first:pt-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="grid min-w-0 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{plan.name}</span>
                      <KoochBadge variant={plan.isActive ? "success" : "muted"}>{plan.isActive ? "فعال" : "غیرفعال"}</KoochBadge>
                    </div>
                    {plan.mealPlanName && <p className="text-sm text-muted-foreground">وعده غذایی: {plan.mealPlanName}</p>}
                    <p className="text-sm text-foreground">{relationship(plan)}</p>
                    {plan.minimumNights != null && <p className="text-xs text-muted-foreground">حداقل اقامت: {new Intl.NumberFormat("fa-IR").format(plan.minimumNights)} شب</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-self-end">
                    <KoochButton disabled={plan.priceModifierType !== "FixedAmount"} onClick={() => openForm(plan)} size="sm" variant="outline">ویرایش</KoochButton>
                    <KoochButton onClick={() => setDeleting(plan)} size="sm" variant="ghost">حذف</KoochButton>
                  </div>
                </div>)}
              </div>}
          </section>

          {actionError && <KoochAlert variant="destructive">{actionError}</KoochAlert>}
        </>}

        {formOpen && <form noValidate className="grid gap-4" onSubmit={(event) => {
          event.stopPropagation();
          void form.handleSubmit(save)(event);
        }}>
          <h3 className="font-semibold text-foreground">{editing ? "ویرایش نرخ فروش" : "افزودن نرخ فروش"}</h3>
          <KoochField label="نام نرخ فروش" required error={form.formState.errors.name?.message}>
            <KoochInput disabled={saving} maxLength={150} placeholder="مثلاً بدون صبحانه" {...form.register("name")} />
          </KoochField>
          <KoochField label="برنامه غذایی">
            <KoochSelect disabled={saving} {...form.register("mealPlanId")}>
              <option value="">بدون برنامه غذایی مشخص</option>
              {mealPlans.map((meal) => <option key={meal.id} value={meal.id}>{meal.name}</option>)}
            </KoochSelect>
          </KoochField>
          <div className="grid gap-4 sm:grid-cols-2">
            <KoochField label="رابطه با قیمت پایه" required>
              <KoochSelect disabled={saving} {...form.register("direction")}>
                <option value="decrease">کاهش از قیمت پایه</option>
                <option value="same">بدون تغییر</option>
                <option value="increase">افزایش به قیمت پایه</option>
              </KoochSelect>
            </KoochField>
            {direction !== "same" && <KoochField label="مبلغ تعدیل" required error={form.formState.errors.amount?.message}>
              <KoochInput disabled={saving} type="number" min="0" step="0.01" inputMode="decimal" {...form.register("amount")} />
            </KoochField>}
          </div>
          <KoochField label="حداقل شب‌های اقامت" error={form.formState.errors.minimumNights?.message} helperText="اختیاری؛ اگر وارد شود، رزرو کوتاه‌تر از آن مجاز نیست.">
            <KoochInput disabled={saving} type="number" min="1" step="1" inputMode="numeric" {...form.register("minimumNights")} />
          </KoochField>
          <KoochCheckbox disabled={saving} label="نرخ فروش فعال باشد" {...form.register("isActive")} />
          {actionError && <KoochAlert variant="destructive">{actionError}</KoochAlert>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <KoochButton disabled={saving} onClick={() => setFormOpen(false)} variant="outline">بازگشت به فهرست</KoochButton>
            <KoochButton loading={saving} type="submit">ذخیره نرخ فروش</KoochButton>
          </div>
        </form>}
      </div>
    </KoochDialog>
    <KoochConfirmDialog
      open={!!deleting} onOpenChange={(open) => { if (!open && !deleteBusy) setDeleting(null); }}
      title="حذف نرخ فروش" description={`نرخ فروش «${deleting?.name ?? ""}» حذف شود؟`}
      confirmText="حذف" cancelText="انصراف" variant="destructive" loading={deleteBusy}
      onConfirm={remove}
    />
  </>;
}
