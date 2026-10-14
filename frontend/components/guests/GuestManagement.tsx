"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochField,
  KoochInput,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableEmpty,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";
import { apiRequest } from "@/lib/owner-api";
import { formatCurrency } from "@/lib/currency";

export type GuestResponse = {
  id: number;
  userId?: number | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  mobile: string | null;
  email: string | null;
  nationalCode: string | null;
  passportNumber: string | null;
  nationality: string | null;
  birthDate: string | null;
  gender: string | null;
  address: string | null;
  notes: string | null;
};

type AdminWalletBalance = {
  currency: string;
  balance: number;
  withdrawableBalance: number;
  nonWithdrawableBalance: number;
  heldBalance: number;
  reservedBalance: number;
};

type GuestForm = {
  id: number | null;
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  nationalCode: string;
  passportNumber: string;
  nationality: string;
  birthDate: string;
  gender: string;
  address: string;
  notes: string;
};

const emptyForm: GuestForm = {
  id: null,
  firstName: "",
  lastName: "",
  mobile: "",
  email: "",
  nationalCode: "",
  passportNumber: "",
  nationality: "",
  birthDate: "",
  gender: "",
  address: "",
  notes: "",
};

function buildQuery(basePath: string, search: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("query", search.trim());
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function toPayload(form: GuestForm) {
  return {
    firstName: form.firstName.trim() || null,
    lastName: form.lastName.trim() || null,
    mobile: form.mobile.trim() || null,
    email: form.email.trim() || null,
    nationalCode: form.nationalCode.trim() || null,
    passportNumber: form.passportNumber.trim() || null,
    nationality: form.nationality.trim() || null,
    birthDate: form.birthDate || null,
    gender: form.gender || null,
    address: form.address.trim() || null,
    notes: form.notes.trim() || null,
  };
}

function toForm(guest: GuestResponse): GuestForm {
  return {
    id: guest.id,
    firstName: guest.firstName ?? "",
    lastName: guest.lastName ?? "",
    mobile: guest.mobile ?? "",
    email: guest.email ?? "",
    nationalCode: guest.nationalCode ?? "",
    passportNumber: guest.passportNumber ?? "",
    nationality: guest.nationality ?? "",
    birthDate: guest.birthDate ?? "",
    gender: guest.gender ?? "",
    address: guest.address ?? "",
    notes: guest.notes ?? "",
  };
}

function normalizeSearch(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("fa-IR");
}

function guestMatchesSearch(guest: GuestResponse, search: string) {
  const term = normalizeSearch(search);
  if (!term) return true;

  return [
    guest.id.toString(),
    guest.firstName,
    guest.lastName,
    guest.fullName,
    guest.mobile,
    guest.email,
    guest.nationalCode,
    guest.passportNumber,
    guest.nationality,
    guest.birthDate,
    guest.gender,
    guest.address,
    guest.notes,
  ].some((value) => normalizeSearch(value).includes(term));
}

export function GuestManagement() {
  const session = useAuthSession();
  const canViewWallet = session.platformRole === "SuperAdmin" || session.platformPermissions.includes("ManagePayments");
  const [guests, setGuests] = useState<GuestResponse[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<GuestForm>(emptyForm);
  const [walletUserId, setWalletUserId] = useState<number | null>(null);
  const [walletBalances, setWalletBalances] = useState<AdminWalletBalance[]>([]);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [walletRefresh, setWalletRefresh] = useState(0);

  useEffect(() => {
    setWalletBalances([]);
    setWalletError("");
    if (!dialogOpen || !form.id || !walletUserId || !canViewWallet) {
      setWalletLoading(false);
      return;
    }
    let active = true;
    setWalletLoading(true);
    void apiRequest<AdminWalletBalance[]>(`/admin/wallet/withdrawals/users/${walletUserId}/balances`)
      .then(data => { if (active) setWalletBalances(data); })
      .catch(error => { if (active) setWalletError(error instanceof Error ? error.message : "موجودی کیف پول بارگذاری نشد."); })
      .finally(() => { if (active) setWalletLoading(false); });
    return () => { active = false; };
  }, [canViewWallet, dialogOpen, form.id, walletUserId, walletRefresh]);

  const basePath = "/admin/guests";
  const visibleGuests = useMemo(
    () => guests.filter((guest) => guestMatchesSearch(guest, search)),
    [guests, search],
  );

  async function loadGuests(nextSearch = search) {
    setLoading(true);
    try {
      const data = await apiRequest<GuestResponse[]>(
        buildQuery(basePath, nextSearch),
      );
      setGuests(data);
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "مهمان‌ها بارگذاری نشدند.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGuests("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  function openCreateDialog() {
    setForm(emptyForm);
    setWalletUserId(null);
    setDialogOpen(true);
  }

  function openEditDialog(guest: GuestResponse) {
    setForm(toForm(guest));
    setWalletUserId(guest.userId ?? null);
    setDialogOpen(true);
  }

  function updateForm(field: keyof GuestForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadGuests("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.firstName.trim() && !form.lastName.trim()) {
      toast.error("نام یا نام خانوادگی مهمان را وارد کنید.");
      return;
    }

    if (!form.mobile.trim() && !form.email.trim()) {
      toast.error("شماره موبایل یا ایمیل مهمان را وارد کنید.");
      return;
    }

    setSaving(true);
    try {
      const saved = await apiRequest<GuestResponse>(
        form.id ? `${basePath}/${form.id}` : basePath,
        {
          method: form.id ? "PUT" : "POST",
          body: JSON.stringify(toPayload(form)),
        },
      );

      setGuests((current) =>
        form.id
          ? current.map((guest) => (guest.id === saved.id ? saved : guest))
          : [saved, ...current],
      );
      setDialogOpen(false);
      toast.success(form.id ? "مهمان ویرایش شد." : "مهمان اضافه شد.");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "مهمان ذخیره نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteGuest(guest: GuestResponse) {
    setDeleteLoading(true);
    try {
      await apiRequest<void>(`${basePath}/${guest.id}`, { method: "DELETE" });
      setGuests((current) => current.filter((item) => item.id !== guest.id));
      toast.success("مهمان حذف شد.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "مهمان حذف نشد.");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="grid gap-4" dir="rtl">
      <KoochCard padding="md">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <form className="flex flex-1 flex-col gap-2 sm:flex-row" onSubmit={handleSearch}>
            <KoochInput
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جستجو بر اساس نام، موبایل، ایمیل، کد ملی یا پاسپورت"
              value={search}
            />
            <KoochButton type="submit" variant="outline">
              جستجو
            </KoochButton>
          </form>

          <KoochButton onClick={openCreateDialog}>افزودن مهمان</KoochButton>
        </div>
      </KoochCard>

      <KoochTable>
        <KoochTableHeader>
          <KoochTableRow>
            <KoochTableHead className="w-14">ردیف</KoochTableHead>
            <KoochTableHead>نام مهمان</KoochTableHead>
            <KoochTableHead>موبایل</KoochTableHead>
            <KoochTableHead>ایمیل</KoochTableHead>
            <KoochTableHead>کد ملی</KoochTableHead>
            <KoochTableHead>پاسپورت</KoochTableHead>
            <KoochTableHead>ملیت</KoochTableHead>
            <KoochTableHead>عملیات</KoochTableHead>
          </KoochTableRow>
        </KoochTableHeader>
        <KoochTableBody>
          {loading ? (
            <KoochTableEmpty colSpan={8}>در حال بارگذاری...</KoochTableEmpty>
          ) : visibleGuests.length === 0 ? (
            <KoochTableEmpty colSpan={8}>مهمانی پیدا نشد.</KoochTableEmpty>
          ) : (
            visibleGuests.map((guest, index) => (
              <KoochTableRow key={guest.id}>
                <KoochTableCell className="font-bold text-muted-foreground">
                  {(index + 1).toLocaleString("fa-IR")}
                </KoochTableCell>
                <KoochTableCell className="font-bold">
                  {guest.fullName || `${guest.firstName ?? ""} ${guest.lastName ?? ""}`.trim() || "-"}
                </KoochTableCell>
                <KoochTableCell>{guest.mobile ?? "-"}</KoochTableCell>
                <KoochTableCell>{guest.email ?? "-"}</KoochTableCell>
                <KoochTableCell>{guest.nationalCode ?? "-"}</KoochTableCell>
                <KoochTableCell>{guest.passportNumber ?? "-"}</KoochTableCell>
                <KoochTableCell>{guest.nationality ?? "-"}</KoochTableCell>
                <KoochTableCell>
                  <div className="flex flex-wrap gap-2">
                    <KoochButton
                      onClick={() => openEditDialog(guest)}
                      size="sm"
                      variant="outline"
                    >
                      ویرایش
                    </KoochButton>
                    <KoochConfirmDialog
                      cancelText="انصراف"
                      confirmText="حذف"
                      description="این مهمان به صورت نرم حذف می‌شود و از لیست فعال خارج خواهد شد."
                      loading={deleteLoading}
                      onConfirm={() => deleteGuest(guest)}
                      title="حذف مهمان"
                      trigger={
                        <KoochButton size="sm" variant="destructive">
                          حذف
                        </KoochButton>
                      }
                      variant="destructive"
                    />
                  </div>
                </KoochTableCell>
              </KoochTableRow>
            ))
          )}
        </KoochTableBody>
      </KoochTable>

      <KoochDialog
        footer={
          <>
            <KoochButton
              disabled={saving}
              onClick={() => setDialogOpen(false)}
              variant="outline"
            >
              انصراف
            </KoochButton>
            <KoochButton
              form="guest-management-form"
              loading={saving}
              type="submit"
            >
              ذخیره
            </KoochButton>
          </>
        }
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        title={form.id ? "ویرایش مهمان" : "افزودن مهمان"}
      >
        <form
          className="grid gap-4"
          id="guest-management-form"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-4 md:grid-cols-2">
              <KoochField label="نام" required>
                <KoochInput
                  onChange={(event) => updateForm("firstName", event.target.value)}
                  value={form.firstName}
                />
              </KoochField>
              <KoochField label="نام خانوادگی" required>
                <KoochInput
                  onChange={(event) => updateForm("lastName", event.target.value)}
                  value={form.lastName}
                />
              </KoochField>
              <KoochField label="موبایل">
                <KoochInput
                  inputMode="tel"
                  onChange={(event) => updateForm("mobile", event.target.value)}
                  value={form.mobile}
                />
              </KoochField>
              <KoochField label="ایمیل">
                <KoochInput
                  dir="ltr"
                  onChange={(event) => updateForm("email", event.target.value)}
                  type="email"
                  value={form.email}
                />
              </KoochField>
              <KoochField label="کد ملی">
                <KoochInput
                  onChange={(event) => updateForm("nationalCode", event.target.value)}
                  value={form.nationalCode}
                />
              </KoochField>
              <KoochField label="شماره پاسپورت">
                <KoochInput
                  dir="ltr"
                  onChange={(event) => updateForm("passportNumber", event.target.value)}
                  value={form.passportNumber}
                />
              </KoochField>
              <KoochField label="ملیت">
                <KoochInput
                  onChange={(event) => updateForm("nationality", event.target.value)}
                  value={form.nationality}
                />
              </KoochField>
              <KoochField label="تاریخ تولد">
                <KoochInput
                  onChange={(event) => updateForm("birthDate", event.target.value)}
                  type="date"
                  value={form.birthDate}
                />
              </KoochField>
              <KoochField label="جنسیت">
                <KoochSelect
                  onChange={(event) => updateForm("gender", event.target.value)}
                  value={form.gender}
                >
                  <option value="">انتخاب نشده</option>
                  <option value="Female">زن</option>
                  <option value="Male">مرد</option>
                  <option value="Other">سایر</option>
                </KoochSelect>
              </KoochField>
          </div>

            <KoochField label="آدرس">
              <KoochTextarea
                onChange={(event) => updateForm("address", event.target.value)}
                rows={3}
                value={form.address}
              />
            </KoochField>

            <KoochField label="یادداشت">
              <KoochTextarea
                onChange={(event) => updateForm("notes", event.target.value)}
                rows={3}
                value={form.notes}
              />
            </KoochField>
        </form>
        {form.id !== null && canViewWallet && (
          <section aria-label="خلاصه کیف پول" className="mt-5 space-y-3 border-t border-border pt-5">
            <h3 className="text-base font-bold text-foreground">خلاصه کیف پول</h3>
            {walletLoading ? <p role="status" className="text-sm text-muted-foreground">در حال دریافت موجودی کیف پول...</p> :
              walletError ? <p role="alert" className="text-sm text-destructive">{walletError} <KoochButton size="sm" variant="outline" onClick={() => setWalletRefresh(value => value + 1)}>تلاش دوباره</KoochButton></p> :
              walletBalances.length === 0 ? <p className="text-sm text-muted-foreground">{walletUserId ? "کیف پولی برای این کاربر ثبت نشده است." : "این مهمان به حساب کاربری متصل نیست؛ کیف پولی برای نمایش وجود ندارد."}</p> :
              <div className="grid gap-3">
                {walletBalances.map(wallet => (
                  <div key={wallet.currency} className="space-y-2 rounded-lg border border-border p-3 text-sm">
                    <h4 className="font-semibold text-foreground">واحد پول: <bdi dir="ltr">{wallet.currency}</bdi></h4>
                    <dl className="grid gap-2 sm:grid-cols-2">
                      {([
                        ["قابل استفاده", wallet.balance],
                        ["قابل برداشت", wallet.withdrawableBalance],
                        ["غیرقابل برداشت", wallet.nonWithdrawableBalance],
                        ["در نگه‌داشت", wallet.heldBalance],
                        ["رزروشده برای برداشت", wallet.reservedBalance],
                      ] as const).map(([label, value]) => (
                        <div key={label} className="flex items-baseline justify-between gap-3">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="font-semibold tabular-nums text-foreground">{formatCurrency(value, { showCurrency: false })} <bdi dir="ltr">{wallet.currency}</bdi></dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>}
          </section>
        )}
      </KoochDialog>
    </div>
  );
}
