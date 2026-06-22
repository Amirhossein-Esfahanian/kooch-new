"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminPage } from "@/components/admin/AdminPage";
import { apiRequest, getToken } from "@/lib/owner-api";
import { SharedUploader } from "@/components/SharedUploader";

type SiteSettingType = "Text" | "LongText" | "ImageUrl" | "Color" | "Boolean" | "Number";

interface SiteSettingResponse {
  id: number;
  key: string;
  value: string;
  type: SiteSettingType;
  group: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAtUtc: string;
  updatedAtUtc: string | null;
}

const groupLabels: Record<string, string> = {
  Brand: "برند سایت",
  Homepage: "صفحه اصلی",
  SEO: "سئو",
  Footer: "فوتر",
  Images: "تنظیمات تصاویر",
};

const imageLabels: Record<string, string> = {
  "site.logoUrl": "لوگوی سایت",
  "home.heroBackgroundUrl": "تصویر پس‌زمینه صفحه اصلی",
};

function inputType(type: SiteSettingType) {
  if (type === "Color") return "color";
  if (type === "Number") return "number";
  return "text";
}

export default function AdminSiteSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SiteSettingResponse[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    apiRequest<SiteSettingResponse[]>("/admin/site-settings")
      .then((items) => {
        setSettings(items);
        setDrafts(Object.fromEntries(items.map((item) => [item.key, item.value])));
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [router]);

  const groupedSettings = useMemo(() => {
    return settings.reduce<Record<string, SiteSettingResponse[]>>((groups, setting) => {
      groups[setting.group] = groups[setting.group] ?? [];
      groups[setting.group].push(setting);
      return groups;
    }, {});
  }, [settings]);

  async function save(setting: SiteSettingResponse) {
    setSavingKey(setting.key);
    setMessage("");
    setError("");
    try {
      const updated = await apiRequest<SiteSettingResponse>(
        `/admin/site-settings/${encodeURIComponent(setting.key)}`,
        {
          method: "PUT",
          body: JSON.stringify({ value: drafts[setting.key] ?? "" }),
        },
      );
      setSettings((current) =>
        current.map((item) => (item.key === updated.key ? updated : item)),
      );
      setDrafts((current) => ({ ...current, [updated.key]: updated.value }));
      setMessage("تنظیمات ذخیره شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ذخیره تنظیمات ناموفق بود.");
    } finally {
      setSavingKey(null);
    }
  }

  function renderInput(setting: SiteSettingResponse) {
    const value = drafts[setting.key] ?? "";
    const commonClass =
      "w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold outline-none transition focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]";

    if (setting.type === "ImageUrl" && imageLabels[setting.key]) {
      const isLogo = setting.key === "site.logoUrl";
      const token = getToken();
      return (
        <div className="grid gap-4">
          <label className="grid gap-2 text-sm font-bold text-slate-700">
            آدرس تصویر
            <input
              className={`${commonClass} h-12`}
              dir="ltr"
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))
              }
              type="text"
              value={value}
            />
          </label>

          <SharedUploader
            accept={isLogo ? ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] : ["image/png", "image/jpeg", "image/webp"]}
            cropAspectRatio={16 / 9}
            enableCrop={!isLogo}
            enablePreview
            existingFiles={value ? [{ id: setting.key, url: value, name: imageLabels[setting.key], alt: imageLabels[setting.key] }] : []}
            extraFormFields={{ key: setting.key }}
            fieldName="file"
            headers={token ? { Authorization: `Bearer ${token}` } : undefined}
            labels={{
              title: imageLabels[setting.key],
              description: isLogo ? "لوگوی سایت را انتخاب و آپلود کنید." : "تصویر پس‌زمینه صفحه اصلی را انتخاب و آپلود کنید.",
              uploadText: "آپلود",
              uploadingText: "در حال آپلود...",
              successText: "تصویر آپلود و ذخیره شد.",
              previewText: "پیش‌نمایش",
              existingEmptyText: "تصویری ثبت نشده است.",
            }}
            maxFileSizeMb={5}
            maxFiles={1}
            multiple={false}
            onUploadError={setError}
            onUploadSuccess={(uploaded) => {
              const updated = uploaded as unknown as SiteSettingResponse;
              setSettings((current) => current.map((item) => (item.key === updated.key ? updated : item)));
              setDrafts((current) => ({ ...current, [updated.key]: updated.value }));
              setMessage("تصویر آپلود و ذخیره شد.");
            }}
            showExistingFiles
            uploadUrl="/api/backend/admin/site-settings/upload"
          />
        </div>
      );
    }

    if (setting.type === "LongText") {
      return (
        <textarea
          className={`${commonClass} min-h-28 py-3 leading-7`}
          onChange={(event) =>
            setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))
          }
          value={value}
        />
      );
    }

    if (setting.type === "Boolean") {
      return (
        <select
          className={`${commonClass} h-12`}
          onChange={(event) =>
            setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))
          }
          value={value}
        >
          <option value="true">فعال</option>
          <option value="false">غیرفعال</option>
        </select>
      );
    }

    return (
      <input
        className={`${commonClass} h-12`}
        dir={setting.type === "ImageUrl" ? "ltr" : "rtl"}
        min={setting.type === "Number" ? 1 : undefined}
        onChange={(event) =>
          setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))
        }
        type={inputType(setting.type)}
        value={value}
      />
    );
  }

  return (
    <AdminPage title="تنظیمات سایت">
      <div className="grid gap-5">
        {loading && (
          <p className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-500">
            در حال بارگذاری تنظیمات...
          </p>
        )}
        {message && <p className="rounded-xl bg-green-50 p-4 text-sm font-bold text-green-700">{message}</p>}
        {error && <p className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}

        {Object.entries(groupedSettings).map(([group, items]) => (
          <section
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]"
            key={group}
          >
            <h2 className="text-xl font-black text-slate-950">
              {groupLabels[group] ?? group}
            </h2>
            <div className="mt-5 grid gap-5">
              {items.map((setting) => (
                <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4" key={setting.key}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <label className="font-black text-slate-900" htmlFor={setting.key}>
                        {imageLabels[setting.key] ?? setting.label}
                      </label>
                      <p className="mt-1 text-xs font-semibold text-slate-400" dir="ltr">
                        {setting.key}
                      </p>
                      {setting.description && (
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          {setting.description}
                        </p>
                      )}
                    </div>
                    <button
                      className="rounded-xl bg-[var(--theme-primary)] px-4 py-2 text-sm font-black text-white transition hover:bg-[var(--theme-primary-hover)] disabled:cursor-wait disabled:opacity-60"
                      disabled={savingKey === setting.key}
                      onClick={() => save(setting)}
                      type="button"
                    >
                      {savingKey === setting.key ? "در حال ذخیره..." : "ذخیره"}
                    </button>
                  </div>
                  <div id={setting.key}>{renderInput(setting)}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AdminPage>
  );
}
