"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochField,
  KoochInput,
} from "@/components/KoochFormControls";
import { KoochIcon } from "@/components/KoochIcon";
import { KoochSvgIcon } from "@/components/KoochSvgIcon";
import { KoochSvgUploader } from "@/components/KoochSvgUploader";
import { apiRequest, type BedTypeResponse } from "@/lib/owner-api";

type BedTypeFormValues = {
  name: string;
  slug: string;
  icon: string | null;
  iconUploadToken: string | null;
  removeIcon: boolean;
};

const emptyForm: BedTypeFormValues = {
  name: "",
  slug: "",
  icon: null,
  iconUploadToken: null,
  removeIcon: false,
};

export function BedTypeManagement() {
  const [bedTypes, setBedTypes] = useState<BedTypeResponse[]>([]);
  const [editingBedType, setEditingBedType] =
    useState<BedTypeResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BedTypeResponse | null>(null);
  const [form, setForm] = useState<BedTypeFormValues>(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [iconStaging, setIconStaging] = useState(false);

  const orderedBedTypes = useMemo(
    () => [...bedTypes].sort((first, second) => first.name.localeCompare(second.name, "fa")),
    [bedTypes],
  );

  const loadBedTypes = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setBedTypes(await apiRequest<BedTypeResponse[]>("/bed-types"));
    } catch (caught) {
      const message =
        caught instanceof Error && caught.message
          ? caught.message
          : "نوع‌های تخت بارگذاری نشدند.";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBedTypes();
  }, [loadBedTypes]);

  function openCreateDialog() {
    setEditingBedType(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditDialog(bedType: BedTypeResponse) {
    setEditingBedType(bedType);
    setForm({
      name: bedType.name,
      slug: bedType.slug,
      icon: bedType.icon,
      iconUploadToken: null,
      removeIcon: false,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setEditingBedType(null);
    setForm(emptyForm);
    setIconStaging(false);
  }

  async function saveBedType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);

    try {
      const iconFields = {
        iconUploadToken: form.iconUploadToken,
        removeIcon: form.removeIcon,
      };
      const payload = editingBedType
        ? {
            name: form.name.trim(),
            ...iconFields,
          }
        : {
            name: form.name.trim(),
            slug: form.slug.trim(),
            ...iconFields,
          };
      const saved = await apiRequest<BedTypeResponse>(
        editingBedType ? `/bed-types/${editingBedType.id}` : "/bed-types",
        {
          method: editingBedType ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );

      setBedTypes((current) =>
        editingBedType
          ? current.map((bedType) =>
              bedType.id === saved.id ? saved : bedType,
            )
          : [...current, saved],
      );
      toast.success(
        editingBedType ? "نوع تخت ویرایش شد." : "نوع تخت جدید افزوده شد.",
      );
      setDialogOpen(false);
      setEditingBedType(null);
      setForm(emptyForm);
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "نوع تخت ذخیره نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteBedType() {
    if (!deleteTarget) return;
    setSaving(true);

    try {
      await apiRequest<void>(`/bed-types/${deleteTarget.id}`, {
        method: "DELETE",
      });
      setBedTypes((current) =>
        current.filter((bedType) => bedType.id !== deleteTarget.id),
      );
      toast.success("نوع تخت حذف شد.");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "نوع تخت حذف نشد.",
      );
    } finally {
      setSaving(false);
      setDeleteTarget(null);
    }
  }

  return (
    <>
      <KoochCard className="min-w-0" variant="elevated">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-lg font-bold text-foreground">
              مدیریت نوع تخت
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              نام و آیکن نوع‌های تخت قابل انتخاب در مدیریت اتاق را تنظیم کنید.
            </p>
          </div>
          <KoochButton
            className="w-full sm:w-auto"
            onClick={openCreateDialog}
            variant="primary"
          >
            <KoochIcon className="size-5" name="plus" />
            افزودن نوع تخت
          </KoochButton>
        </div>

        <div className="mt-5" aria-live="polite">
          {loading ? (
            <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
              در حال بارگذاری نوع‌های تخت...
            </p>
          ) : loadError ? (
            <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-foreground">{loadError}</p>
              <KoochButton
                className="w-full sm:w-auto"
                onClick={() => void loadBedTypes()}
                size="sm"
                variant="outline"
              >
                تلاش دوباره
              </KoochButton>
            </div>
          ) : orderedBedTypes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              هنوز نوع تختی ثبت نشده است.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="hidden grid-cols-[64px_minmax(0,1.25fr)_minmax(0,1fr)_190px] gap-3 bg-muted px-4 py-3 text-xs font-bold text-muted-foreground md:grid">
                <span>آیکن</span>
                <span>نام</span>
                <span>نامک</span>
                <span className="sr-only">عملیات</span>
              </div>
              <div className="divide-y divide-border" data-testid="bed-type-list">
                {orderedBedTypes.map((bedType) => (
                  <article
                    className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] gap-3 bg-card p-4 md:grid-cols-[64px_minmax(0,1.25fr)_minmax(0,1fr)_190px] md:items-center"
                    data-testid={`bed-type-${bedType.id}`}
                    key={bedType.id}
                  >
                    <span className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
                      {bedType.icon ? (
                        <KoochSvgIcon
                          data-testid={`bed-type-icon-${bedType.id}`}
                          size="lg"
                          src={bedType.icon}
                        />
                      ) : (
                        <KoochIcon className="size-6" name="capacity" />
                      )}
                    </span>
                    <div className="min-w-0 self-center">
                      <span className="text-xs font-medium text-muted-foreground md:hidden">
                        نام
                      </span>
                      <h3 className="truncate text-sm font-bold text-foreground">
                        {bedType.name}
                      </h3>
                    </div>
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      <span className="text-xs font-medium text-muted-foreground md:hidden">
                        نامک
                      </span>
                      <p className="break-all text-sm text-muted-foreground" dir="ltr">
                        {bedType.slug}
                      </p>
                    </div>
                    <div className="col-span-2 flex flex-wrap gap-2 md:col-span-1 md:justify-end">
                      <KoochButton
                        aria-label={`ویرایش ${bedType.name}`}
                        onClick={() => openEditDialog(bedType)}
                        size="sm"
                        variant="outline"
                      >
                        <KoochIcon className="size-4" name="edit" />
                        ویرایش
                      </KoochButton>
                      <KoochButton
                        aria-label={`حذف ${bedType.name}`}
                        onClick={() => setDeleteTarget(bedType)}
                        size="sm"
                        variant="destructive"
                      >
                        <KoochIcon className="size-4" name="delete" />
                        حذف
                      </KoochButton>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </KoochCard>

      <KoochDialog
        closeDisabled={saving}
        description={
          editingBedType
            ? "نام و آیکن این نوع تخت را ویرایش کنید. نامک پس از ایجاد ثابت می‌ماند."
            : "نام، نامک و آیکن اختیاری نوع تخت جدید را وارد کنید."
        }
        footer={
          <>
            <KoochButton
              className="w-full sm:w-auto"
              disabled={iconStaging}
              form="bed-type-form"
              loading={saving}
              type="submit"
            >
              {editingBedType ? "ذخیره تغییرات" : "افزودن"}
            </KoochButton>
            <KoochButton
              className="w-full sm:w-auto"
              disabled={saving}
              onClick={closeDialog}
              variant="outline"
            >
              انصراف
            </KoochButton>
          </>
        }
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        open={dialogOpen}
        size="md"
        title={editingBedType ? "ویرایش نوع تخت" : "افزودن نوع تخت"}
      >
        <form className="grid gap-4" id="bed-type-form" onSubmit={saveBedType}>
          <KoochField label="نام" required>
            <KoochInput
              autoFocus
              maxLength={150}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              required
              value={form.name}
            />
          </KoochField>

          <KoochField
            helperText={
              editingBedType
                ? "نامک پس از ایجاد قابل تغییر نیست."
                : "با حروف انگلیسی، عدد و خط تیره وارد شود."
            }
            label="نامک"
            required={!editingBedType}
          >
            <KoochInput
              className={editingBedType ? "bg-muted text-muted-foreground" : ""}
              dir="ltr"
              maxLength={170}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: event.target.value }))
              }
              readOnly={Boolean(editingBedType)}
              required={!editingBedType}
              value={form.slug}
            />
          </KoochField>

          <KoochField
            helperText="فایل SVG پس از بررسی امن، هم‌زمان با ذخیره نوع تخت نهایی می‌شود."
            label="آیکن SVG"
          >
            <KoochSvgUploader
              disabled={saving}
              helperText="آیکن اختیاری است؛ حداکثر حجم فایل ۲۵۶ کیلوبایت است."
              key={`bed-type-icon-${dialogOpen}-${editingBedType?.id ?? "new"}`}
              onRemove={() =>
                setForm((current) => ({
                  ...current,
                  iconUploadToken: null,
                  removeIcon: Boolean(current.icon),
                }))
              }
              onRestore={() =>
                setForm((current) => ({
                  ...current,
                  iconUploadToken: null,
                  removeIcon: false,
                }))
              }
              onStaged={(uploadToken) =>
                setForm((current) => ({
                  ...current,
                  iconUploadToken: uploadToken,
                  removeIcon: false,
                }))
              }
              onUploadingChange={setIconStaging}
              pendingUploadToken={form.iconUploadToken}
              persistedValue={form.icon}
              removePending={form.removeIcon}
              stagePath="/bed-types/svg/stage"
            />
          </KoochField>
        </form>
      </KoochDialog>

      <KoochConfirmDialog
        confirmText="حذف"
        loading={saving}
        onConfirm={deleteBedType}
        onOpenChange={(open) => {
          if (!open && !saving) setDeleteTarget(null);
        }}
        open={Boolean(deleteTarget)}
        title="حذف نوع تخت"
        variant="destructive"
      >
        {deleteTarget && (
          <p>
            آیا از حذف «{deleteTarget.name}» مطمئن هستید؟ اگر این نوع تخت در اتاقی
            استفاده شده باشد، حذف انجام نمی‌شود.
          </p>
        )}
      </KoochConfirmDialog>
    </>
  );
}
