"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochCheckbox,
  KoochField,
  KoochInput,
} from "@/components/KoochFormControls";
import { KoochIcon } from "@/components/KoochIcon";
import {
  apiRequest,
  type PropertySettingResponse,
} from "@/lib/owner-api";

type PropertySettingFormValues = {
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
};

const emptyForm: PropertySettingFormValues = {
  name: "",
  slug: "",
  sortOrder: 0,
  isActive: true,
};

function sortPropertySettings(settings: PropertySettingResponse[]) {
  return [...settings].sort(
    (first, second) =>
      first.sortOrder - second.sortOrder ||
      first.name.localeCompare(second.name, "fa"),
  );
}

export function PropertySettingManagement() {
  const [settings, setSettings] = useState<PropertySettingResponse[]>([]);
  const [editingSetting, setEditingSetting] =
    useState<PropertySettingResponse | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<PropertySettingResponse | null>(null);
  const [form, setForm] = useState<PropertySettingFormValues>(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const orderedSettings = useMemo(
    () => sortPropertySettings(settings),
    [settings],
  );

  useEffect(() => {
    apiRequest<PropertySettingResponse[]>(
      "/property-settings?includeInactive=true",
    )
      .then(setSettings)
      .catch((caught: Error) =>
        toast.error(caught.message || "بافت و موقعیت‌ها بارگذاری نشدند."),
      )
      .finally(() => setLoading(false));
  }, []);

  function openCreateDialog() {
    setEditingSetting(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditDialog(setting: PropertySettingResponse) {
    setEditingSetting(setting);
    setForm({
      name: setting.name,
      slug: setting.slug,
      sortOrder: setting.sortOrder,
      isActive: setting.isActive,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setEditingSetting(null);
    setForm(emptyForm);
  }

  async function saveSetting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);

    try {
      const payload = editingSetting
        ? {
            name: form.name.trim(),
            sortOrder: form.sortOrder,
            isActive: form.isActive,
          }
        : {
            name: form.name.trim(),
            slug: form.slug.trim(),
            sortOrder: form.sortOrder,
            isActive: form.isActive,
          };
      const saved = await apiRequest<PropertySettingResponse>(
        editingSetting
          ? `/property-settings/${editingSetting.id}`
          : "/property-settings",
        {
          method: editingSetting ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );

      setSettings((current) => {
        if (editingSetting) {
          return current.map((setting) =>
            setting.id === saved.id ? saved : setting,
          );
        }

        return [...current, saved];
      });
      toast.success(
        editingSetting
          ? "بافت و موقعیت ویرایش شد."
          : "بافت و موقعیت جدید افزوده شد.",
      );
      setDialogOpen(false);
      setEditingSetting(null);
      setForm(emptyForm);
    } catch (caught) {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "بافت و موقعیت ذخیره نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteSetting() {
    if (!deleteTarget) return;
    setSaving(true);

    try {
      await apiRequest<void>(`/property-settings/${deleteTarget.id}`, {
        method: "DELETE",
      });
      setSettings((current) =>
        current.filter((setting) => setting.id !== deleteTarget.id),
      );
      toast.success("بافت و موقعیت حذف شد.");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "بافت و موقعیت حذف نشد.",
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
              مدیریت بافت و موقعیت محیطی
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              گزینه‌هایی را مدیریت کنید که برای توصیف محیط و محدوده اقامتگاه در
              فرم اقامتگاه نمایش داده می‌شوند.
            </p>
          </div>
          <KoochButton
            className="w-full sm:w-auto"
            onClick={openCreateDialog}
            variant="primary"
          >
            <KoochIcon className="h-5 w-5" name="plus" />
            افزودن بافت و موقعیت
          </KoochButton>
        </div>

        <div className="mt-5" aria-live="polite">
          {loading ? (
            <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
              در حال بارگذاری بافت و موقعیت‌ها...
            </p>
          ) : orderedSettings.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              هنوز بافت و موقعیتی ثبت نشده است.
            </p>
          ) : (
            <div
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              data-testid="property-setting-list"
            >
              {orderedSettings.map((setting) => (
                <article
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-3"
                  data-testid={`property-setting-${setting.id}`}
                  key={setting.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="min-w-0 truncate text-sm font-bold text-foreground">
                        {setting.name}
                      </h3>
                      <span
                        className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                          setting.isActive
                            ? "bg-[var(--theme-success-soft)] text-[var(--theme-success)]"
                            : "bg-[var(--theme-warning-soft)] text-[var(--theme-warning)]"
                        }`}
                      >
                        {setting.isActive ? "فعال" : "غیرفعال"}
                      </span>
                    </div>
                    <p
                      className="mt-1 truncate text-xs text-muted-foreground"
                      dir="ltr"
                      title={setting.slug}
                    >
                      {setting.slug}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <KoochButton
                      aria-label={`ویرایش ${setting.name}`}
                      onClick={() => openEditDialog(setting)}
                      size="icon"
                      title={`ویرایش ${setting.name}`}
                      variant="ghost"
                    >
                      <KoochIcon className="size-4" name="edit" />
                    </KoochButton>
                    <KoochButton
                      aria-label={`حذف ${setting.name}`}
                      onClick={() => setDeleteTarget(setting)}
                      size="icon"
                      title={`حذف ${setting.name}`}
                      variant="ghost"
                    >
                      <KoochIcon className="size-4 text-destructive" name="delete" />
                    </KoochButton>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </KoochCard>

      <KoochDialog
        closeDisabled={saving}
        description={
          editingSetting
            ? "نام، ترتیب نمایش و وضعیت این گزینه را ویرایش کنید."
            : "مشخصات گزینه جدید بافت و موقعیت محیطی را وارد کنید."
        }
        footer={
          <>
            <KoochButton
              className="w-full sm:w-auto"
              form="property-setting-form"
              loading={saving}
              type="submit"
            >
              {editingSetting ? "ذخیره تغییرات" : "افزودن"}
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
        bodyClassName="!px-5 !py-4"
        contentClassName="!h-auto max-h-[calc(100vh-2rem)] !max-w-lg"
        footerClassName="!px-5 !py-3"
        size="md"
        title={editingSetting ? "ویرایش بافت و موقعیت" : "افزودن بافت و موقعیت"}
      >
        <form className="grid gap-3" id="property-setting-form" onSubmit={saveSetting}>
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
              editingSetting
                ? "نامک پس از ایجاد قابل تغییر نیست."
                : "با حروف انگلیسی و عدد وارد شود."
            }
            label="نامک"
            required={!editingSetting}
          >
            <KoochInput
              className={editingSetting ? "bg-muted text-muted-foreground" : ""}
              dir="ltr"
              maxLength={170}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: event.target.value }))
              }
              readOnly={Boolean(editingSetting)}
              required={!editingSetting}
              value={form.slug}
            />
          </KoochField>

          <KoochField label="ترتیب نمایش" required>
            <KoochInput
              inputMode="numeric"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  sortOrder: Number(event.target.value),
                }))
              }
              required
              type="number"
              value={form.sortOrder}
            />
          </KoochField>

          <KoochCheckbox
            checked={form.isActive}
            containerBackground
            containerBorder
            containerClassName="p-3"
            label="فعال"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                isActive: event.target.checked,
              }))
            }
          />
        </form>
      </KoochDialog>

      <KoochConfirmDialog
        confirmText="حذف"
        loading={saving}
        onConfirm={deleteSetting}
        onOpenChange={(open) => {
          if (!open && !saving) setDeleteTarget(null);
        }}
        open={Boolean(deleteTarget)}
        title="حذف بافت و موقعیت"
        variant="destructive"
      >
        {deleteTarget && (
          <p>
            آیا از حذف «{deleteTarget.name}» مطمئن هستید؟ اگر این گزینه به
            اقامتگاهی اختصاص داده شده باشد، حذف انجام نمی‌شود.
          </p>
        )}
      </KoochConfirmDialog>
    </>
  );
}
